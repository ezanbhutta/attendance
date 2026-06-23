'use strict';

const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { DurableBuffer } = require('./buffer');
const { createApp } = require('./app');
const log = require('./log');

// Entry point: wire config + store + buffer + app, start the HTTP listener and
// the background drain worker, and shut down cleanly on signals.

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    log.error(e.message);
    process.exit(1);
  }

  const store = createStore(config);
  const buffer = new DurableBuffer(config.bufferDir);
  const app = createApp({ config, store, buffer });

  const drain = (rows) => store.insertPunches(rows);
  buffer.start(drain, config.drainIntervalMs);
  // Kick a drain shortly after boot in case we restarted with a non-empty spool.
  setTimeout(() => buffer.drainOnce(drain).catch(() => {}), 2000).unref();

  const server = app.listen(config.port, config.bindAddr, () => {
    log.info(`ADMS listener on ${config.bindAddr}:${config.port} (device SN=${config.deviceSn})`);
    log.info(
      `tz=${config.deviceTzOffset} buffer=${config.bufferDir} drain=${config.drainIntervalMs}ms`
    );
    const pending = buffer.pendingCount();
    if (pending) log.warn(`${pending} punch(es) waiting in the local buffer`);
    // Auto-sync: pull every user the device knows about on each start, so people
    // enrolled while the catcher was away get imported. The device performs the
    // upload on its next poll (within seconds).
    if (config.autoSyncUsers) {
      app.requestUserSync();
      log.info('user-sync queued; device will upload its users on next poll');
    }
    if (config.autoSyncHistory) {
      app.requestHistorySync();
      log.info('history-sync queued; device will re-upload its stored attendance');
    }
  });

  // Web "Sync" button → device re-upload. The dashboard can't reach the LAN
  // device, so it drops a row in device_sync_requests; we poll for it here and
  // ask the device to re-upload its users + stored attendance on its next poll.
  const syncPollMs = Number(process.env.SYNC_POLL_MS) || 5000;
  const syncTimer = setInterval(async () => {
    const n = await store.claimSyncRequests(config.deviceSn);
    if (n > 0) {
      log.info(`web sync requested (${n}); queuing device re-upload`);
      app.requestUserSync();
      app.requestHistorySync();
    }
    // "To device" button → enroll name/PIN/card on the device.
    const pushes = await store.claimUserPushes(config.deviceSn);
    if (pushes.length) {
      log.info(`web push requested (${pushes.length}); queuing device enroll`);
      for (const u of pushes) app.pushUser(u);
    }
    // Employee deleted on the dashboard → remove them from the device.
    const deletes = await store.claimUserDeletes(config.deviceSn);
    if (deletes.length) {
      log.info(`web delete requested (${deletes.length}); queuing device removal`);
      for (const u of deletes) app.deleteUser(u);
    }
  }, syncPollMs);
  syncTimer.unref();

  // Mark absences as shifts pass. compute_attendance_for only runs when someone
  // punches (or on a manual recompute), so a person who never scans has NO row and
  // is invisible to the dashboard — making the attendance rate read falsely high.
  // Recompute yesterday + today for EVERYONE on a timer so no-shows get an Absent
  // row once their shift has started. Yesterday is included for night shifts that
  // count for the previous day. Cheap (a few dozen rows) and idempotent.
  const tzOffset = config.deviceTzOffset || '+05:00';
  const localDate = (back) => {
    const m = /([+-])(\d{2}):(\d{2})/.exec(tzOffset);
    const offMin = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
    return new Date(Date.now() + offMin * 60000 - back * 86400000).toISOString().slice(0, 10);
  };
  const recomputeEveryMs = Number(process.env.RECOMPUTE_EVERY_MS) || 5 * 60000;
  const doRecompute = () => store.recomputeRange(localDate(1), localDate(0))
    .then((ok) => { if (ok) log.info(`recomputed ${localDate(1)}..${localDate(0)} for absences`); });
  setTimeout(doRecompute, 20000).unref();             // shortly after boot
  const recomputeTimer = setInterval(doRecompute, recomputeEveryMs);
  recomputeTimer.unref();

  function shutdown(sig) {
    log.info(`${sig} received; shutting down`);
    clearInterval(syncTimer);
    clearInterval(recomputeTimer);
    buffer.stop();
    server.close(() => {
      log.info('listener stopped');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
