'use strict';

// Replays the SenseFace 2A's confirmed ADMS exchange against a running listener,
// so you can verify capture end-to-end WITHOUT the hardware (spec §3.2–§3.5).
//
// Usage:
//   node tools/simulate-device.js [baseUrl] [SN]
//   BASE=http://127.0.0.1:8081 SN=NYU7253801246 node tools/simulate-device.js
//
// It performs the handshake, posts a FACE and a FINGERPRINT punch (timestamped
// "now"), sends a heartbeat with an INFO string, and prints each reply.

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:8081';
const SN = process.argv[3] || process.env.SN || 'NYU7253801246';

function nowLocal() {
  // 'YYYY-MM-DD HH:MM:SS' in the host's local time — shape matches the device.
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

async function show(label, res) {
  const body = await res.text();
  console.log(`\n# ${label}\n  ${res.status} ${res.statusText}\n  ${body.replace(/\n/g, '\n  ')}`);
}

async function main() {
  console.log(`Simulating device SN=${SN} against ${BASE}`);

  await show(
    'handshake  GET /iclock/cdata?options=all',
    await fetch(`${BASE}/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1&DeviceType=att`)
  );

  const t = nowLocal();
  const attlog = [
    `2\t${t}\t255\t15\t0\t0\t0\t0\t901`, // FACE (verify 15)
    `2\t${t}\t255\t1\t0\t0\t0\t0\t902`, //  FINGERPRINT (verify 1) — same second, deduped downstream
  ].join('\r\n');

  await show(
    'punches    POST /iclock/cdata?table=ATTLOG',
    await fetch(`${BASE}/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'iClock Proxy/1.09' },
      body: attlog,
    })
  );

  const info = 'ZAM70-NF24HA-Ver3.3.12,27,73,283,192.168.1.201,13,40,12,3,11110,0,25,0';
  await show(
    'heartbeat  GET /iclock/getrequest?INFO=...',
    await fetch(`${BASE}/iclock/getrequest?SN=${SN}&INFO=${encodeURIComponent(info)}`)
  );

  await show('health     GET /healthz', await fetch(`${BASE}/healthz`));
  console.log('\nDone. Check the listener logs and (if configured) raw_punches in Supabase.');
}

main().catch((e) => {
  console.error('simulator error:', e.message);
  process.exit(1);
});
