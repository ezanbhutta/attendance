'use strict';

// Fetch-on-open sync (the "pull" path the user asked for).
//
// Connects to the ZKTeco device over its SDK port (TCP 4370), reads the
// attendance records it has stored internally, and upserts them into Supabase
// raw_punches. Idempotent via the unique key (device_sn, pin, punch_time), so
// pulling the full log on every open never creates duplicates — only new
// punches land, and the DB triggers recompute attendance automatically.
//
// node-zklib decodes each record's time into a Date built from the device's
// local wall-clock components (parseTimeToDate uses `new Date(y,mo,d,h,mi,s)`).
// Local getters reverse that exactly, regardless of the PC's timezone, so we
// recover the device's Pakistan wall-clock and attach +05:00 — matching how the
// listener stores push punches.

const CHUNK = 500;

const pad = (n) => String(n).padStart(2, '0');

// Date (or date-like) -> 'YYYY-MM-DDTHH:MM:SS+05:00' using the device offset.
function toIsoWithOffset(value, offset = '+05:00') {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const off = /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '+05:00';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off}`;
}

// One device attendance record -> a raw_punches row (or null if unusable).
// Pulled records carry no verify method, so verify_mode is null (it's only used
// for reporting; the push path fills it in when available).
function recordToRow(rec, cfg) {
  if (!rec) return null;
  const pin = String(rec.deviceUserId ?? rec.userId ?? rec.uid ?? '').trim();
  const iso = toIsoWithOffset(rec.recordTime ?? rec.timestamp ?? rec.time, cfg.tzOffset);
  if (!pin || !iso) return null;
  return {
    device_sn: cfg.deviceSn,
    pin,
    punch_time: iso,
    status: 255,
    verify_mode: null,
    raw_line: `PULL ${JSON.stringify(rec)}`,
  };
}

// Connect, pull, and (unless dryRun) upsert. Dependencies are injectable so the
// logic is unit-testable without a device or a live database.
//   cfg: { deviceIp, devicePort, deviceSn, tzOffset, supabaseUrl, serviceKey, dryRun }
//   deps: { makeZk, makeSupabase, log }
async function syncFromDevice(cfg, deps = {}) {
  const log = deps.log || (() => {});
  const makeZk = deps.makeZk || (() => {
    const ZKLib = require('node-zklib');
    return new ZKLib(cfg.deviceIp, cfg.devicePort || 4370, cfg.timeout || 10000, cfg.inport || 4000);
  });

  // node-zklib sometimes rejects with a bare object (no .message); normalize it.
  const reason = (e) => (e && (e.message || e.err?.message)) || (e && typeof e === 'object' ? JSON.stringify(e) : String(e)) || 'no response from device';

  const zk = makeZk();
  log(`connecting to device ${cfg.deviceIp}:${cfg.devicePort || 4370}`);
  try {
    await zk.createSocket();
  } catch (e) {
    throw new Error(`could not connect to device at ${cfg.deviceIp}:${cfg.devicePort || 4370} — ${reason(e)}`);
  }

  let pulled = 0;
  let skipped = 0;
  const rows = [];
  try {
    let res;
    try {
      res = await zk.getAttendances();
    } catch (e) {
      throw new Error(`device connected but would not return attendance logs — ${reason(e)}`);
    }
    const records = res && Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
    pulled = records.length;
    for (const r of records) {
      const row = recordToRow(r, cfg);
      if (row) rows.push(row); else skipped++;
    }
    log(`pulled ${pulled} record(s), ${rows.length} usable`);
  } finally {
    try { await zk.disconnect(); } catch { /* ignore */ }
  }

  if (cfg.dryRun) {
    return { pulled, usable: rows.length, skipped, stored: 0, dryRun: true, sample: rows.slice(0, 5) };
  }

  const supabase = deps.makeSupabase
    ? deps.makeSupabase()
    : require('@supabase/supabase-js').createClient(cfg.supabaseUrl, cfg.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

  let stored = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('raw_punches')
      .upsert(chunk, { onConflict: 'device_sn,pin,punch_time', ignoreDuplicates: true });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);
    stored += chunk.length;
  }
  log(`sent ${stored} row(s) to raw_punches (duplicates ignored by the DB)`);

  return { pulled, usable: rows.length, skipped, stored, dryRun: false };
}

module.exports = { syncFromDevice, recordToRow, toIsoWithOffset };
