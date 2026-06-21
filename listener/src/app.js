'use strict';

const express = require('express');
const log = require('./log');
const { parseAttlog, toTimestamptz, parseInfo, parseUserinfo } = require('./parser');

// CONFIRMED working handshake reply (spec §3.2). Stamp=0 requests all buffered
// records; the rest configures realtime per-punch upload in Pakistan time.
const HANDSHAKE = (sn) => `GET OPTION FROM:${sn}
ATTLOGStamp=0
OPERLOGStamp=0
ErrorDelay=10
Delay=5
TimeZone=5
Realtime=1
ServerVer=3.0.1
PushProtVer=2.4.1
TransFlag=111111111111
TransInterval=1
`;

// Build the Express app. Dependencies (store, buffer) are injected so the routes
// can be exercised in tests with fakes — no live Supabase required.
function createApp({ config, store, buffer }) {
  const app = express();
  app.disable('x-powered-by');
  // Never JSON-parse the device body; it is plain text (spec §5).
  app.use(express.raw({ type: '*/*', limit: '10mb' }));

  const SN = config.deviceSn;

  // SN guard (spec §5). Unknown device: ack OK so it stops retrying, store nothing.
  function guard(req, res) {
    if ((req.query.SN || '') !== SN) {
      log.warn(`rejected request SN='${req.query.SN || ''}' from ${req.ip}`);
      res.status(200).type('text/plain').send('OK');
      return false;
    }
    return true;
  }

  // Refresh devices.last_seen on EVERY device contact (handshake, poll, punch,
  // ping) so the dashboard's online/offline badge reflects real connectivity —
  // not just the device's infrequent INFO heartbeat (which left it reading
  // "offline" while connected). Throttled so a chatty poll loop doesn't write on
  // every request; an INFO payload always writes (it carries firmware/IP).
  let lastTouchAt = 0;
  function touchDevice(info) {
    const now = Date.now();
    if (info || now - lastTouchAt >= 30000) {
      lastTouchAt = now;
      store.updateDeviceStatus(SN, info || null); // fire-and-forget; never throws
    }
  }

  // ── Device command queue (ADMS server commands, spec §3.6) ──────────────────
  // We answer the device's getrequest poll with 'C:<id>:<cmd>' to ask it to do
  // something. We use it to pull the device's user list: 'DATA QUERY USERINFO'
  // makes the device upload all its users to POST /iclock/cdata, which we then
  // import. Commands are served once (FIFO); the device reports completion to
  // /iclock/devicecmd.
  let cmdSeq = 0;
  const cmdQueue = [];
  function enqueueCommand(cmd) {
    cmdSeq += 1;
    cmdQueue.push({ id: cmdSeq, cmd });
    log.info(`queued device command #${cmdSeq}: ${cmd}`);
    return cmdSeq;
  }

  // Parse + import any user records in an uploaded body, and stamp the sync time.
  async function importUsers(body, source) {
    const users = parseUserinfo(body);
    if (!users.length) return false;
    try {
      const r = await store.importDeviceUsers(SN, users);
      await store.recordUserSync(SN, r.seen);
      log.info(`${source}: ${r.seen} device user(s) received, ${r.added} new imported`);
    } catch (e) {
      log.error(`user import (${source}) failed:`, e.message);
    }
    return true;
  }

  // Turn an ATTLOG body into DB-ready rows. Each row's punch_time is normalized
  // to an ISO instant here (single normalization point). Lines we can't parse or
  // whose timestamp is malformed are separated out for dead-lettering so they
  // never enter the DB batch or the retry spool.
  function normalizeAttlog(body, deviceSn) {
    const valid = [];
    const bad = [];
    body
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((line) => {
        const p = parseAttlog(line);
        if (!p) return bad.push({ line, reason: 'unparseable' });
        const tz = toTimestamptz(p.punch_time, config.deviceTzOffset);
        if (!tz) return bad.push({ line, reason: 'bad-timestamp' });
        valid.push({
          device_sn: deviceSn,
          pin: p.pin,
          punch_time: tz,
          status: p.status,
          verify_mode: p.verify_mode,
          raw_line: p.raw_line,
        });
      });
    return { valid, bad };
  }

  // Handshake / init.
  app.get('/iclock/cdata', (req, res) => {
    if (!guard(req, res)) return;
    touchDevice();
    log.info(`handshake from SN=${req.query.SN}`);
    res.type('text/plain').send(HANDSHAKE(SN));
  });

  // The core: attendance punches (ATTLOG) and operation logs (OPERLOG).
  app.post('/iclock/cdata', async (req, res) => {
    if (!guard(req, res)) return;
    touchDevice();
    const table = (req.query.table || '').toUpperCase();
    const body = req.body ? req.body.toString('utf8') : '';

    if (table === 'ATTLOG') {
      const { valid, bad } = normalizeAttlog(body, req.query.SN);

      if (bad.length) {
        buffer.deadLetter(bad, 'attlog-normalize');
        log.warn(`${bad.length} ATTLOG line(s) dead-lettered`);
      }

      if (valid.length) {
        let stored;
        try {
          await store.insertPunches(valid);
          stored = 'db';
        } catch (dbErr) {
          // DB down -> spool durably BEFORE acking. If even the spool fails,
          // do NOT ack OK; the device will resend (spec §5 non-negotiable).
          try {
            buffer.append(valid);
            stored = 'buffer';
            log.warn(`supabase down; buffered ${valid.length} punch(es):`, dbErr.message);
          } catch (bufErr) {
            log.error('CRITICAL: db AND buffer failed; asking device to resend:', bufErr.message);
            return res.status(500).type('text/plain').send('ERROR');
          }
        }
        log.info(`ATTLOG: ${valid.length} punch(es) -> ${stored}`);
      }
    } else if (table === 'USERINFO') {
      // The device's reply to DATA QUERY USERINFO: its full user list.
      if (!(await importUsers(body, 'USERINFO'))) log.info('USERINFO push had no users');
    } else if (table === 'OPERLOG') {
      // OPERLOG carries operation logs; some firmware also returns USER records
      // here after a user query. Import any users present; otherwise ignore
      // (card taps / access events are Phase 2, spec §9).
      if (!(await importUsers(body, 'OPERLOG'))) log.info('OPERLOG received (no user records)');
    } else {
      log.info(`POST /iclock/cdata table='${table}' (no-op)`);
    }

    res.type('text/plain').send('OK'); // ack AFTER durable storage (db or buffer)
  });

  // Heartbeat (+ periodic device status) + command queue.
  app.get('/iclock/getrequest', (req, res) => {
    if (!guard(req, res)) return;
    touchDevice(req.query.INFO ? parseInfo(req.query.INFO) : null);
    if (cmdQueue.length) {
      const { id, cmd } = cmdQueue.shift();
      log.info(`sending command #${id} to device: ${cmd}`);
      return res.type('text/plain').send(`C:${id}:${cmd}\n`);
    }
    res.type('text/plain').send('OK');
  });

  // Device reports command results here. Log them (useful when diagnosing a sync)
  // and ack so the device clears the command.
  app.post('/iclock/devicecmd', (req, res) => {
    if (!guard(req, res)) return;
    const body = req.body ? req.body.toString('utf8').trim() : '';
    if (body) log.info(`devicecmd result: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
    res.type('text/plain').send('OK');
  });

  // Backup heartbeat.
  app.get('/iclock/ping', (req, res) => {
    if (!guard(req, res)) return;
    touchDevice();
    res.type('text/plain').send('OK');
  });

  // Operator/dashboard health (NOT part of the device protocol; no SN guard).
  app.get('/healthz', (_req, res) => {
    res.type('application/json').send(
      JSON.stringify({
        ok: true,
        device_sn: SN,
        buffered_punches: buffer.pendingCount(),
        pending_commands: cmdQueue.length,
        time: new Date().toISOString(),
      })
    );
  });

  // Manually re-pull the device's users (LAN-only; the device does the upload on
  // its next poll). Handy for a "Sync now" button or a quick test.
  app.get('/admin/sync-users', (_req, res) => {
    const id = enqueueCommand(config.userSyncCommand || 'DATA QUERY USERINFO');
    res.type('application/json').send(JSON.stringify({ queued: true, command_id: id }));
  });

  // Ask the device to upload all its users on its next poll. Called on startup
  // so every catcher start re-imports everyone (spec: auto-sync on start).
  app.requestUserSync = () => enqueueCommand(config.userSyncCommand || 'DATA QUERY USERINFO');

  // Express 5 catch-all (spec gotcha: '/{*splat}', not '*'). Ack anything else.
  app.all('/{*splat}', (_req, res) => res.type('text/plain').send('OK'));

  return app;
}

module.exports = { createApp, HANDSHAKE };
