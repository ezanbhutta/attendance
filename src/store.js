'use strict';

const { createClient } = require('@supabase/supabase-js');
const log = require('./log');

// Supabase sink for the listener. Writes with the service-role key (server-side
// only). `insertPunches` is the single write path for attendance and is
// idempotent via the raw_punches unique key (device_sn, pin, punch_time).

function createStore(config) {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // rows: DB-ready punch rows (punch_time already normalized to an ISO instant).
  // Throws on any failure so the caller can buffer and retry. ignoreDuplicates
  // keeps raw_punches immutable (INSERT ... ON CONFLICT DO NOTHING).
  async function insertPunches(rows) {
    if (!rows || !rows.length) return;
    const { error } = await supabase
      .from('raw_punches')
      .upsert(rows, { onConflict: 'device_sn,pin,punch_time', ignoreDuplicates: true });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);
  }

  // Best-effort device heartbeat / firmware update (spec §3.5). Never throws —
  // device status is non-critical and must not interfere with the OK ack.
  async function updateDeviceStatus(sn, info) {
    try {
      const patch = { sn, last_seen: new Date().toISOString() };
      if (info && info.firmware) patch.firmware = info.firmware;
      if (info && info.ip) patch.ip = info.ip;
      const { error } = await supabase.from('devices').upsert(patch, { onConflict: 'sn' });
      if (error) throw new Error(error.message);
    } catch (e) {
      log.warn('device status update skipped:', e.message);
    }
  }

  return { insertPunches, updateDeviceStatus };
}

module.exports = { createStore };
