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
      return true;
    } catch (e) {
      log.warn('device status update skipped:', e.message);
      return false;
    }
  }

  // Split a device name string into first/last.
  function splitName(raw, pin) {
    const name = (raw || '').trim() || `User ${pin}`;
    const sp = name.indexOf(' ');
    return { first_name: sp > 0 ? name.slice(0, sp) : name, last_name: sp > 0 ? name.slice(sp + 1) : null };
  }

  // Import the users the device uploaded (from a DATA QUERY USERINFO response).
  // Creates an employee for any new PIN, and — because the scanner wins on Sync —
  // updates the name of an existing PIN when the device actually sent one (a blank
  // device name never clobbers a dashboard name). Returns { seen, added, updated }.
  async function importDeviceUsers(deviceSn, users) {
    if (!users || !users.length) return { seen: 0, added: 0, updated: 0 };
    await supabase.from('devices').upsert({ sn: deviceSn }, { onConflict: 'sn' });

    const codes = users.map((u) => String(u.pin));
    const { data: existing } = await supabase.from('employees')
      .select('id,emp_code,first_name,last_name').in('emp_code', codes);
    const byCode = new Map((existing || []).map((e) => [e.emp_code, e]));

    // Insert PINs we have never seen.
    const toInsert = users.filter((u) => !byCode.has(String(u.pin)))
      .map((u) => ({ emp_code: String(u.pin), ...splitName(u.name, u.pin) }));
    let added = 0;
    if (toInsert.length) {
      const { data: ins, error } = await supabase.from('employees').insert(toInsert).select('id,emp_code');
      if (error) throw new Error(`employee import failed: ${error.message}`);
      for (const e of ins) byCode.set(e.emp_code, { id: e.id, _new: true });
      added = ins.length;
    }

    // Scanner wins: update an existing person's name when the device sent a real
    // name that differs. Skip the rows we just inserted, and skip blank names.
    let updated = 0;
    for (const u of users) {
      const ex = byCode.get(String(u.pin));
      if (!ex || ex._new || !(u.name || '').trim()) continue;
      const nm = splitName(u.name, u.pin);
      if (nm.first_name !== ex.first_name || (nm.last_name ?? null) !== (ex.last_name ?? null)) {
        const { error } = await supabase.from('employees').update(nm).eq('id', ex.id);
        if (!error) updated++;
      }
    }

    // Map each PIN -> employee (existing mappings are preserved).
    const mapRows = users.map((u) => ({
      device_sn: deviceSn, pin: String(u.pin), employee_id: byCode.get(String(u.pin))?.id,
    }));
    const { error: mErr } = await supabase
      .from('device_user_map')
      .upsert(mapRows, { onConflict: 'device_sn,pin', ignoreDuplicates: true });
    if (mErr) throw new Error(`PIN mapping failed: ${mErr.message}`);

    return { seen: users.length, added, updated };
  }

  // Reconcile a full Sync: archive any active employee mapped to this device whose
  // PIN was NOT in the device's uploaded list (they were removed on the device).
  // History is kept; they can be restored. Never deletes. `seenPins` must be the
  // COMPLETE set from the sync, and is only acted on when non-empty.
  async function archiveMissingUsers(deviceSn, seenPins) {
    try {
      if (!seenPins || !seenPins.length) return 0;
      const seen = new Set(seenPins.map(String));
      const { data: maps, error } = await supabase
        .from('device_user_map').select('employee_id,pin').eq('device_sn', deviceSn);
      if (error) throw new Error(error.message);
      const goneIds = (maps || []).filter((m) => !seen.has(String(m.pin)) && m.employee_id)
        .map((m) => m.employee_id);
      if (!goneIds.length) return 0;
      const { data: upd, error: uErr } = await supabase.from('employees')
        .update({ active: false }).in('id', goneIds).neq('active', false).select('id');
      if (uErr) throw new Error(uErr.message);
      return (upd || []).length;
    } catch (e) {
      log.warn('archive-missing skipped:', e.message);
      return 0;
    }
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

  // Claim pending web "Sync now" requests for this device (created by the
  // dashboard's Sync button, which can't reach the LAN device directly). Marks
  // them done and returns how many were pending so the server can ask the device
  // to re-upload. Best-effort; never throws.
  async function claimSyncRequests(deviceSn) {
    try {
      const { data, error } = await supabase
        .from('device_sync_requests')
        .select('id')
        .is('done_at', null)
        .eq('device_sn', deviceSn)
        .limit(20);
      if (error) throw new Error(error.message);
      if (!data || !data.length) return 0;
      const ids = data.map((r) => r.id);
      const now = new Date().toISOString();
      await supabase.from('device_sync_requests')
        .update({ picked_up_at: now, done_at: now })
        .in('id', ids);
      return ids.length;
    } catch (e) {
      log.warn('sync-request poll skipped:', e.message);
      return 0;
    }
  }

  // Claim pending "push to device" rows (created by the dashboard's "To device"
  // button). Marks them done and returns the people to enroll, so the server can
  // ask the device to set each one's name, PIN and card. Best-effort; never throws.
  async function claimUserPushes(deviceSn) {
    try {
      const { data, error } = await supabase
        .from('device_user_pushes')
        .select('id,pin,name,card_no')
        .is('done_at', null)
        .eq('device_sn', deviceSn)
        .limit(50);
      if (error) throw new Error(error.message);
      if (!data || !data.length) return [];
      const ids = data.map((r) => r.id);
      const now = new Date().toISOString();
      await supabase.from('device_user_pushes')
        .update({ picked_up_at: now, done_at: now })
        .in('id', ids);
      return data.map((r) => ({ pin: r.pin, name: r.name, card: r.card_no }));
    } catch (e) {
      log.warn('user-push poll skipped:', e.message);
      return [];
    }
  }

  // Claim pending "remove from device" rows (created when an employee is deleted
  // on the dashboard). Marks them done and returns the PINs to delete from the
  // device. Best-effort; never throws.
  async function claimUserDeletes(deviceSn) {
    try {
      const { data, error } = await supabase
        .from('device_user_deletes')
        .select('id,pin')
        .is('done_at', null)
        .eq('device_sn', deviceSn)
        .limit(50);
      if (error) throw new Error(error.message);
      if (!data || !data.length) return [];
      const ids = data.map((r) => r.id);
      const now = new Date().toISOString();
      await supabase.from('device_user_deletes')
        .update({ picked_up_at: now, done_at: now })
        .in('id', ids);
      return data.map((r) => ({ pin: r.pin }));
    } catch (e) {
      log.warn('user-delete poll skipped:', e.message);
      return [];
    }
  }

  return { insertPunches, updateDeviceStatus, importDeviceUsers, recordUserSync,
           archiveMissingUsers, claimSyncRequests, claimUserPushes, claimUserDeletes };
}

module.exports = { createStore };
