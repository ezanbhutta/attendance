// Generates build/icon.png — a simple placeholder app icon (blue with a white
// clock ring). Replace build/icon.png with real branding any time.
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const W = 512, H = 512;
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'build', 'icon.png');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const raw = Buffer.alloc((W * 3 + 1) * H);
const cx = W / 2, cy = H / 2;
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter byte
  for (let x = 0; x < W; x++) {
    const o = y * (W * 3 + 1) + 1 + x * 3;
    let r = 31, g = 95, b = 214; // brand blue
    const d = Math.hypot(x - cx, y - cy);
    const ang = Math.atan2(y - cy, x - cx);
    const onHand = (d < 120 && (Math.abs(ang + Math.PI / 2) < 0.06 || Math.abs(ang) < 0.06));
    if ((d < 165 && d > 130) || onHand) { r = 255; g = 255; b = 255; } // ring + hands
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
