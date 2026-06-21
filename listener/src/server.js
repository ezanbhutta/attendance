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

  function shutdown(sig) {
    log.info(`${sig} received; shutting down`);
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
