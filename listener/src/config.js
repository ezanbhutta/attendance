'use strict';

// Loads and validates the listener configuration from environment variables.
// server.js calls this on boot; tests construct config objects directly.

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function intOpt(name, fallback) {
  const n = parseInt(optional(name, String(fallback)), 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadConfig() {
  return {
    deviceSn: required('DEVICE_SN'),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
    port: intOpt('PORT', 8081),
    bindAddr: optional('BIND_ADDR', '0.0.0.0'),
    deviceTzOffset: optional('DEVICE_TZ_OFFSET', '+05:00'),
    bufferDir: optional('BUFFER_DIR', '.buffer'),
    drainIntervalMs: intOpt('DRAIN_INTERVAL_MS', 15000),
    // On startup, ask the device to upload all its users so we import everyone
    // enrolled while the catcher was away. Set AUTO_SYNC_USERS=false to disable.
    autoSyncUsers: optional('AUTO_SYNC_USERS', 'true') !== 'false',
    userSyncCommand: optional('USER_SYNC_COMMAND', 'DATA QUERY USERINFO'),
  };
}

module.exports = { loadConfig };
