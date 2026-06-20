'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DurableBuffer } = require('../src/buffer');

// A fake Supabase that enforces the same unique key as raw_punches and can be
// toggled "down" to simulate an outage. Lets us prove the Stage-2 gate without
// a live database.
function makeFakeStore() {
  const byKey = new Map();
  const state = { down: false };
  const key = (r) => `${r.device_sn}|${r.pin}|${r.punch_time}`;
  return {
    state,
    rows: byKey,
    async insertPunches(rows) {
      if (state.down) throw new Error('simulated supabase outage');
      for (const r of rows) {
        if (!byKey.has(key(r))) byKey.set(key(r), r); // ON CONFLICT DO NOTHING
      }
    },
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'attbuf-'));
}

function punch(pin, t) {
  return { device_sn: 'NYU7253801246', pin, punch_time: t, status: 255, verify_mode: 15 };
}

test('STAGE-2 GATE: punches survive a Supabase outage and are drained on recovery', async () => {
  const dir = tmpDir();
  const store = makeFakeStore();
  const buf = new DurableBuffer(dir);

  // Outage: a punch arrives while the DB is down -> it must be spooled durably.
  store.state.down = true;
  try {
    await store.insertPunches([punch('2', '2026-06-20T11:49:05+05:00')]);
    assert.fail('insert should have thrown during outage');
  } catch {
    buf.append([punch('2', '2026-06-20T11:49:05+05:00')]);
  }
  assert.equal(buf.pendingCount(), 1, 'punch is held in the buffer during the outage');

  // A drain attempt while still down re-queues, losing nothing.
  let r = await buf.drainOnce((rows) => store.insertPunches(rows));
  assert.equal(r.requeued, 1);
  assert.equal(store.rows.size, 0);
  assert.equal(buf.pendingCount(), 1);

  // Recovery: the worker flushes the spool.
  store.state.down = false;
  r = await buf.drainOnce((rows) => store.insertPunches(rows));
  assert.equal(r.drained, 1);
  assert.equal(store.rows.size, 1, 'punch reached the store after recovery');
  assert.equal(buf.pendingCount(), 0, 'buffer is empty after a successful drain');
});

test('STAGE-2 GATE: duplicates never appear (idempotent retries)', async () => {
  const dir = tmpDir();
  const store = makeFakeStore();
  const buf = new DurableBuffer(dir);

  // Same punch buffered twice (e.g. device resent, then we also spooled it).
  buf.append([punch('2', '2026-06-20T11:49:05+05:00')]);
  buf.append([punch('2', '2026-06-20T11:49:05+05:00')]);
  assert.equal(buf.pendingCount(), 2);

  const r = await buf.drainOnce((rows) => store.insertPunches(rows));
  assert.equal(r.drained, 2, 'both lines were processed');
  assert.equal(store.rows.size, 1, 'but only ONE row exists in the store (dedup)');
});

test('punches appended DURING an outage drain are not lost', async () => {
  const dir = tmpDir();
  const store = makeFakeStore();
  const buf = new DurableBuffer(dir);

  store.state.down = true;
  buf.append([punch('2', '2026-06-20T11:49:05+05:00')]);
  await buf.drainOnce((rows) => store.insertPunches(rows)); // fails, re-queues #1
  buf.append([punch('3', '2026-06-20T11:50:00+05:00')]); // arrives during the outage
  assert.equal(buf.pendingCount(), 2);

  store.state.down = false;
  await buf.drainOnce((rows) => store.insertPunches(rows));
  assert.equal(store.rows.size, 2, 'both punches stored');
  assert.equal(buf.pendingCount(), 0);
});

test('crash recovery: an in-flight batch is merged back on restart', async () => {
  const dir = tmpDir();
  const store = makeFakeStore();

  // Simulate a crash mid-drain by hand-writing a leftover processing file.
  fs.writeFileSync(
    path.join(dir, 'pending.processing.jsonl'),
    JSON.stringify(punch('9', '2026-06-20T08:00:00+05:00')) + '\n'
  );

  const buf = new DurableBuffer(dir); // constructor runs recover()
  assert.equal(buf.pendingCount(), 1, 'leftover batch recovered into pending');

  const r = await buf.drainOnce((rows) => store.insertPunches(rows));
  assert.equal(r.drained, 1);
  assert.equal(store.rows.size, 1);
});

test('dead-letter: bad items are parked, not spooled for retry', () => {
  const dir = tmpDir();
  const buf = new DurableBuffer(dir);
  buf.deadLetter([{ line: 'garbage', reason: 'unparseable' }], 'attlog-normalize');
  assert.equal(buf.pendingCount(), 0, 'dead-lettered items do not enter the retry spool');
  assert.ok(fs.existsSync(path.join(dir, 'dead-letter.jsonl')));
});
