'use strict';

// Minimal timestamped logger. Keeps output greppable in pm2/systemd journals
// without pulling in a logging dependency.

// Device-controlled values (SN, names, raw lines) end up in log messages. Strip
// control bytes — CR/LF/ESC and other C0/C1 — and bound length so an attacker
// can't forge log lines or smuggle terminal escapes (log injection).
function clean(v) {
  if (typeof v !== 'string') return v;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  return s.length > 1000 ? `${s.slice(0, 1000)}…` : s;
}

function line(level, args) {
  return [`[${new Date().toISOString()}]`, `[${level}]`, ...args.map(clean)];
}

module.exports = {
  info: (...a) => console.log(...line('INFO', a)),
  warn: (...a) => console.warn(...line('WARN', a)),
  error: (...a) => console.error(...line('ERROR', a)),
};
