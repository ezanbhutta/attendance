'use strict';

// Route-level tests. Requires `npm install` (express). The parser/buffer tests
// are dependency-free and cover the core logic without an install.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { DurableBuffer } = require('../src/buffer');

const SN = 'NYU7253801246';

function makeFakeStore() {
  const byKey = new Map();
  const state = { down: false };
  const key = (r) => `${r.device_sn}|${r.pin}|${r.punch_time}`;
  return {
    state,
    rows: byKey,
    deviceUpdates: [],
    async insertPunches(rows) {
      if (state.down) throw new Error('simulated outage');
      for (const r of rows) if (!byKey.has(key(r))) byKey.set(key(r), r);
    },
    async updateDeviceStatus(sn, info) {
      this.deviceUpdates.push({ sn, info });
    },
  };
}

// Start the app on an ephemeral port; return its base URL and a closer.
function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attapp-'));
  const store = makeFakeStore();
  const buffer = new DurableBuffer(dir);
  const config = { deviceSn: SN, deviceTzOffset: '+05:00' };
  const app = createApp({ config, store, buffer });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        store,
        buffer,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('handshake returns the confirmed GET OPTION reply', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.url}/iclock/cdata?SN=${SN}&options=all`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, new RegExp(`^GET OPTION FROM:${SN}`));
    assert.match(body, /Realtime=1/);
    assert.match(body, /TimeZone=5/);
  } finally {
    await app.close();
  }
});

test('ATTLOG punch is stored and acked OK', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.url}/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '2\t2026-06-20 11:49:05\t255\t15\t0\t0\t0\t0\t283',
    });
    assert.equal(await res.text(), 'OK');
    assert.equal(app.store.rows.size, 1);
    const [row] = [...app.store.rows.values()];
    assert.equal(row.pin, '2');
    assert.equal(row.verify_mode, 15);
    assert.equal(row.punch_time, '2026-06-20T11:49:05+05:00'); // normalized with offset
  } finally {
    await app.close();
  }
});

test('ATTLOG during an outage is buffered, still acked OK (no loss)', async () => {
  const app = await startApp();
  try {
    app.store.state.down = true;
    const res = await fetch(`${app.url}/iclock/cdata?SN=${SN}&table=ATTLOG`, {
      method: 'POST',
      body: '2\t2026-06-20 11:49:05\t255\t15\t0\t0\t0\t0\t283',
    });
    assert.equal(await res.text(), 'OK', 'device is acked even though the DB is down');
    assert.equal(app.store.rows.size, 0);
    assert.equal(app.buffer.pendingCount(), 1, 'punch is safe in the buffer');
  } finally {
    await app.close();
  }
});

test('wrong SN is rejected: acked OK but nothing stored', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.url}/iclock/cdata?SN=WRONG&table=ATTLOG`, {
      method: 'POST',
      body: '2\t2026-06-20 11:49:05\t255\t15\t0\t0\t0\t0\t283',
    });
    assert.equal(await res.text(), 'OK');
    assert.equal(app.store.rows.size, 0);
    assert.equal(app.buffer.pendingCount(), 0);
  } finally {
    await app.close();
  }
});

test('heartbeat with INFO updates device status and acks OK', async () => {
  const app = await startApp();
  try {
    const info = 'ZAM70-NF24HA-Ver3.3.12,27,73,283,192.168.1.201,13,40,12,3,11110,0,25,0';
    const res = await fetch(`${app.url}/iclock/getrequest?SN=${SN}&INFO=${encodeURIComponent(info)}`);
    assert.equal(await res.text(), 'OK');
    assert.equal(app.store.deviceUpdates.length, 1);
    assert.equal(app.store.deviceUpdates[0].info.firmware, 'ZAM70-NF24HA-Ver3.3.12');
  } finally {
    await app.close();
  }
});

test('plain heartbeat without INFO still marks the device seen (online badge fix)', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.url}/iclock/getrequest?SN=${SN}`);
    assert.equal(await res.text(), 'OK');
    // Before the fix last_seen only moved on INFO heartbeats, so a connected
    // device reading no INFO showed "offline". Now any contact refreshes it.
    assert.equal(app.store.deviceUpdates.length, 1);
    assert.equal(app.store.deviceUpdates[0].info, null);
  } finally {
    await app.close();
  }
});

test('ping and unknown paths ack OK', async () => {
  const app = await startApp();
  try {
    assert.equal(await (await fetch(`${app.url}/iclock/ping?SN=${SN}`)).text(), 'OK');
    assert.equal(await (await fetch(`${app.url}/anything/else`)).text(), 'OK');
  } finally {
    await app.close();
  }
});
