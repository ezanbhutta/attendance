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

  // Import the users the device uploaded (from a DATA QUERY USERINFO response).
  // Idempotent and non-destructive: creates an employee for any PIN we haven't
  // seen (emp_code = PIN, name from the device) and maps the PIN to it. Existing
  // employees and PIN mappings are left untouched, so a manual rename on the
  // dashboard is never overwritten on the next sync. Returns { seen, added }.
  async function importDeviceUsers(deviceSn, users) {
    if (!users || !users.length) return { seen: 0, added: 0 };
    // Make sure the device row exists (FK target for device_user_map).
    await supabase.from('devices').upsert({ sn: deviceSn }, { onConflict: 'sn' });

    const codes = users.map((u) => String(u.pin));
    const { data: existing } = await supabase.from('employees').select('id,emp_code').in('emp_code', codes);
    const byCode = new Map((existing || []).map((e) => [e.emp_code, e.id]));

    const toInsert = users
      .filter((u) => !byCode.has(String(u.pin)))
      .map((u) => {
        const name = (u.name || '').trim() || `User ${u.pin}`;
        const sp = name.indexOf(' ');
        return {
          emp_code: String(u.pin),
          first_name: sp > 0 ? name.slice(0, sp) : name,
          last_name: sp > 0 ? name.slice(sp + 1) : null,
        };
      });

    let added = 0;
    if (toInsert.length) {
      const { data: ins, error } = await supabase.from('employees').insert(toInsert).select('id,emp_code');
      if (error) throw new Error(`employee import failed: ${error.message}`);
      for (const e of ins) byCode.set(e.emp_code, e.id);
      added = ins.length;
    }

    // Map each PIN -> employee, but DO NOTHING on an existing (device_sn, pin)
    // so a manual mapping is preserved.
    const mapRows = users.map((u) => ({
      device_sn: deviceSn, pin: String(u.pin), employee_id: byCode.get(String(u.pin)),
    }));
    const { error: mErr } = await supabase
      .from('device_user_map')
      .upsert(mapRows, { onConflict: 'device_sn,pin', ignoreDuplicates: true });
    if (mErr) throw new Error(`PIN mapping failed: ${mErr.message}`);

    return { seen: users.length, added };
  }

  // Stamp when we last pulled users from the device (shown on the dashboard).
  async function recordUserSync(deviceSn, count) {
    try {
      await supabase.from('devices')
        .update({ last_user_sync: new Date().toISOString(), last_user_sync_count: count })
        .eq('sn', deviceSn);
    } catch (e) {
      log.warn('record sync time skipped:', e.message);
    }
  }

  return { insertPunches, updateDeviceStatus, importDeviceUsers, recordUserSync };
}

module.exports = { createStore };
