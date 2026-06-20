'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncFromDevice, recordToRow, toIsoWithOffset } = require('../src/sync');

const CFG = { deviceSn: 'NYU7253801246', tzOffset: '+05:00' };

test('toIsoWithOffset: recovers device wall-clock + offset, timezone-independent', () => {
  // node-zklib builds this with new Date(y,mo,d,h,mi,s) (local). Local getters
  // reverse it to the same components no matter the host TZ.
  const d = new Date(2026, 5, 20, 11, 49, 5); // 2026-06-20 11:49:05 local
  assert.equal(toIsoWithOffset(d, '+05:00'), '2026-06-20T11:49:05+05:00');
});

test('toIsoWithOffset: bad offset falls back to +05:00; bad date -> null', () => {
  assert.equal(toIsoWithOffset(new Date(2026, 0, 1, 9, 0, 0), 'nope'), '2026-01-01T09:00:00+05:00');
  assert.equal(toIsoWithOffset('not-a-date'), null);
});

test('recordToRow: maps a device record to a raw_punches row', () => {
  const rec = { userSn: 1, deviceUserId: '2', recordTime: new Date(2026, 5, 20, 11, 49, 5) };
  assert.deepEqual(recordToRow(rec, CFG), {
    device_sn: 'NYU7253801246',
    pin: '2',
    punch_time: '2026-06-20T11:49:05+05:00',
    status: 255,
    verify_mode: null, // pull carries no method
    raw_line: `PULL ${JSON.stringify(rec)}`,
  });
});

test('recordToRow: rejects records with no PIN or no time', () => {
  assert.equal(recordToRow({ deviceUserId: '', recordTime: new Date() }, CFG), null);
  assert.equal(recordToRow({ deviceUserId: '2', recordTime: 'x' }, CFG), null);
  assert.equal(recordToRow(null, CFG), null);
});

// ── fakes ──
function fakeZk(records, hooks = {}) {
  return {
    createSocket: async () => { hooks.connected = true; },
    getAttendances: async () => ({ data: records }),
    disconnect: async () => { hooks.disconnected = true; },
  };
}
function fakeSupabase(capture) {
  return {
    from() {
      return {
        upsert(rows, opts) { capture.calls.push({ rows, opts }); return Promise.resolve({ error: null }); },
      };
    },
  };
}

test('syncFromDevice: pulls and upserts with the dedup key', async () => {
  const records = [
    { deviceUserId: '2', recordTime: new Date(2026, 5, 20, 9, 0, 0) },
    { deviceUserId: '2', recordTime: new Date(2026, 5, 20, 18, 0, 0) },
    { deviceUserId: '', recordTime: new Date() }, // unusable -> skipped
  ];
  const hooks = {};
  const capture = { calls: [] };
  const r = await syncFromDevice(CFG, { makeZk: () => fakeZk(records, hooks), makeSupabase: () => fakeSupabase(capture) });

  assert.equal(r.pulled, 3);
  assert.equal(r.usable, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.stored, 2);
  assert.ok(hooks.connected && hooks.disconnected, 'opens and closes the socket');
  assert.equal(capture.calls[0].opts.onConflict, 'device_sn,pin,punch_time');
  assert.equal(capture.calls[0].opts.ignoreDuplicates, true);
  assert.equal(capture.calls[0].rows[0].pin, '2');
});

test('syncFromDevice: dry run reads but never touches the database', async () => {
  const records = [{ deviceUserId: '7', recordTime: new Date(2026, 5, 20, 8, 30, 0) }];
  let supabaseMade = false;
  const r = await syncFromDevice(
    { ...CFG, dryRun: true },
    { makeZk: () => fakeZk(records), makeSupabase: () => { supabaseMade = true; return fakeSupabase({ calls: [] }); } }
  );
  assert.equal(r.dryRun, true);
  assert.equal(r.pulled, 1);
  assert.equal(r.stored, 0);
  assert.equal(supabaseMade, false, 'no DB client created in dry run');
  assert.equal(r.sample[0].pin, '7');
});
