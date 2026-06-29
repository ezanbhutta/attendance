'use strict';

const express = require('express');
const crypto = require('crypto');
const log = require('./log');
const { parseAttlog, toTimestamptz, parseInfo, parseUserinfo } = require('./parser');

const ipOf = (req) => String(req.ip || '').replace(/^::ffff:/, '');
const isLoopback = (req) => ['127.0.0.1', '::1'].includes(ipOf(req));
// Constant-time token compare (avoids timing oracles); both sides bytes.
function tokenEq(got, want) {
  if (!want) return true;                       // no token configured -> not enforced
  const a = Buffer.from(String(got || '')), b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
  // Never JSON-parse the device body; it is plain text (spec §5). Bounded so an
  // unauthenticated caller can't push a huge body before the guard runs.
  app.use(express.raw({ type: '*/*', limit: config.maxBodyBytes || '512kb' }));

  const SN = config.deviceSn;
  const TOKEN = config.token || null;                  // LISTENER_TOKEN (shared secret)
  const ALLOW_IPS = config.allowIps && config.allowIps.length ? config.allowIps : null; // LISTENER_ALLOW_IPS

  // Defence-in-depth: a simple per-IP fixed-window rate limit (no extra deps). The
  // single real device polls a few dozen times a minute; the cap only bites floods.
  const rl = new Map();
  const RL_MAX = config.rateLimitPerMin || 1200;
  function rateLimited(req, res) {
    const ip = ipOf(req), now = Date.now(), slot = Math.floor(now / 60000);
    const e = rl.get(ip);
    if (!e || e.slot !== slot) { rl.set(ip, { slot, n: 1 }); if (rl.size > 5000) rl.clear(); return false; }
    if (++e.n > RL_MAX) { res.status(429).type('text/plain').send('SLOW DOWN'); return true; }
    return false;
  }

  // Ingress guard for the device protocol. Layers (any configured layer must pass):
  //  • IP allow-list (LISTENER_ALLOW_IPS) — the practical control for device firmware
  //    that can't present a secret; only the device's LAN IP gets through.
  //  • shared token (LISTENER_TOKEN) via X-Auth-Token header or ?token= — fail-closed.
  //  • the device serial (routing, NOT a security boundary — it is not secret).
  // When neither token nor allow-list is set, behaviour is unchanged (SN only) and a
  // loud warning is logged at startup so the operator knows the path is open.
  function guard(req, res) {
    if (rateLimited(req, res)) return false;
    if (ALLOW_IPS && !ALLOW_IPS.includes(ipOf(req))) {
      log.warn(`blocked request from non-allowed IP ${ipOf(req)}`);
      res.status(403).type('text/plain').send('FORBIDDEN'); return false;
    }
    if (TOKEN && !tokenEq(req.get('x-auth-token') || req.query.token, TOKEN)) {
      log.warn(`blocked request with bad/absent token from ${ipOf(req)}`);
      res.status(401).type('text/plain').send('UNAUTHORIZED'); return false;
    }
    if ((req.query.SN || '') !== SN) {
      log.warn(`rejected request SN='${req.query.SN || ''}' from ${ipOf(req)}`);
      res.status(200).type('text/plain').send('OK');
      return false;
    }
    return true;
  }

  // Operator routes (/admin, /healthz internals): loopback, or a valid token.
  function adminAllowed(req) { return isLoopback(req) || (TOKEN && tokenEq(req.get('x-auth-token') || req.query.token, TOKEN)); }

  if (!TOKEN && !ALLOW_IPS) {
    log.warn('SECURITY: listener ingress is gated only by the (non-secret) device serial. '
      + 'Set LISTENER_ALLOW_IPS=<device-ip> and/or LISTENER_TOKEN=<secret>, bind to the LAN '
      + 'interface, and firewall the port to the device. Never expose this port to the internet.');
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
      lastTouchAt = now;                          // throttle optimistically...
      // ...but if the write fails, clear the throttle so the next contact retries
      // immediately instead of staying suppressed (which could flip to "offline").
      store.updateDeviceStatus(SN, info || null).then((ok) => { if (ok === false) lastTouchAt = 0; });
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

  // Reconcile a full Sync: collect the PINs the device uploads across a sync, and
  // a few seconds after the last batch, archive anyone mapped to this device who
  // was NOT in the upload (removed on the device). Debounced so a multi-part
  // upload counts as one set; only ever acts on a non-empty set.
  const reconcileOn = config.reconcileOnSync !== false;
  const reconcileDelay = config.reconcileDelayMs || 8000;
  let seenPins = null, reconcileTimer = null;
  function noteSyncUsers(pins) {
    if (!reconcileOn) return;
    if (!seenPins) seenPins = new Set();
    for (const p of pins) seenPins.add(String(p));
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(async () => {
      const seen = [...seenPins]; seenPins = null;
      const n = await store.archiveMissingUsers(SN, seen);
      if (n) log.info(`sync reconcile: archived ${n} user(s) no longer on the device`);
    }, reconcileDelay);
    if (reconcileTimer.unref) reconcileTimer.unref();
  }

  // Parse + import any user records in an uploaded body, stamp the sync time, and
  // feed the PINs into the reconcile set so removals on the device are mirrored.
  async function importUsers(body, source) {
    const users = parseUserinfo(body);
    if (!users.length) return false;
    try {
      const r = await store.importDeviceUsers(SN, users);
      await store.recordUserSync(SN, r.seen);
      log.info(`${source}: ${r.seen} device user(s) received, ${r.added} new, ${r.updated || 0} renamed`);
      noteSyncUsers(users.map((u) => u.pin));
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
    const lines = body.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const MAX = config.maxAttlogLines || 5000;
    if (lines.length > MAX) {           // cap work per request; dead-letter the overflow
      for (const line of lines.splice(MAX)) bad.push({ line, reason: 'over-line-cap' });
    }
    lines
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

  // Operator/dashboard health. Liveness is public; operational internals (serial,
  // queue depths) only to loopback or a valid token, so they don't leak anonymously.
  app.get('/healthz', (req, res) => {
    const base = { ok: true, time: new Date().toISOString() };
    const full = adminAllowed(req)
      ? { device_sn: SN, buffered_punches: buffer.pendingCount(), pending_commands: cmdQueue.length }
      : {};
    res.type('application/json').send(JSON.stringify({ ...base, ...full }));
  });

  // Manually re-pull the device's users / stored attendance (the device does the
  // upload on its next poll). POST + loopback-or-token: a custom header forces a
  // CORS preflight, and the token/loopback check stops anonymous/CSRF triggers.
  app.post('/admin/sync-users', (req, res) => {
    if (!adminAllowed(req)) return res.status(401).type('text/plain').send('UNAUTHORIZED');
    const id = enqueueCommand(config.userSyncCommand || 'DATA QUERY USERINFO');
    res.type('application/json').send(JSON.stringify({ queued: true, command_id: id }));
  });
  app.post('/admin/sync-history', (req, res) => {
    if (!adminAllowed(req)) return res.status(401).type('text/plain').send('UNAUTHORIZED');
    const id = enqueueCommand(config.attlogSyncCommand || 'DATA QUERY ATTLOG');
    res.type('application/json').send(JSON.stringify({ queued: true, command_id: id }));
  });

  // Called on startup so every catcher start re-imports everyone and re-pulls
  // the attendance the device has stored. Both uploads dedup, so re-pulling is
  // safe. The device performs the work on its next poll.
  app.requestUserSync = () => enqueueCommand(config.userSyncCommand || 'DATA QUERY USERINFO');
  app.requestHistorySync = () => enqueueCommand(config.attlogSyncCommand || 'DATA QUERY ATTLOG');

  // Enroll or update one person on the device: name, PIN, card, role and (when
  // given) password. For an existing PIN this overwrites those fields, so a change
  // on the dashboard is pushed onto the device. Role (Pri) is always sent so a
  // demotion to Normal User takes effect; password (PWD) is sent only when set, so
  // a blank never wipes the device password. Group, face and fingerprint are left
  // out so they are never touched — biometrics are captured at the device anyway.
  // (spec §3.6, DATA UPDATE USERINFO; omitted fields keep their current value.)
  app.pushUser = ({ pin, name, card, privilege, password }) => {
    const clean = (s) => String(s == null ? '' : s).replace(/[\t\r\n]/g, ' ').trim();
    const fields = [`PIN=${clean(pin)}`, `Name=${clean(name)}`];
    const c = clean(card);
    if (c) fields.push(`Card=${c}`);
    // Only 0 (Normal) and 14 (Super Admin) are valid roles; anything else -> Normal.
    if (privilege != null && privilege !== '') fields.push(`Pri=${parseInt(privilege, 10) === 14 ? 14 : 0}`);
    const pw = clean(password);
    // Device PIN/password is numeric; reject anything else so we never push junk.
    if (pw && /^\d{1,10}$/.test(pw)) fields.push(`PWD=${pw}`);
    return enqueueCommand(`DATA UPDATE USERINFO ${fields.join('\t')}`);
  };

  // Remove one person from the device by PIN (used when an employee is deleted on
  // the dashboard). The device drops the user record and their templates.
  // (spec §3.6, DATA DELETE USERINFO.)
  app.deleteUser = ({ pin }) => {
    const clean = (s) => String(s == null ? '' : s).replace(/[\t\r\n]/g, ' ').trim();
    return enqueueCommand(`DATA DELETE USERINFO PIN=${clean(pin)}`);
  };

  // Express 5 catch-all (spec gotcha: '/{*splat}', not '*'). Ack anything else.
  app.all('/{*splat}', (_req, res) => res.type('text/plain').send('OK'));

  return app;
}

module.exports = { createApp, HANDSHAKE };
