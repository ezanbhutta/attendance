'use strict';

// Minimal timestamped logger. Keeps output greppable in pm2/systemd journals
// without pulling in a logging dependency.

function line(level, args) {
  return [`[${new Date().toISOString()}]`, `[${level}]`, ...args];
}

module.exports = {
  info: (...a) => console.log(...line('INFO', a)),
  warn: (...a) => console.warn(...line('WARN', a)),
  error: (...a) => console.error(...line('ERROR', a)),
};
