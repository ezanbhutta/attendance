'use strict';

// Parsers for the CONFIRMED SenseFace 2A ADMS feed (spec §3.3 / §3.5).
// Transport is plain text: TAB-separated records, CRLF-separated rows. The
// device sometimes emits space-separated rows, so the ATTLOG parser is tolerant.

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

// Parse one ATTLOG line into a raw punch.
//   Tab form  : PIN \t 'YYYY-MM-DD HH:MM:SS' \t Status \t VerifyMode \t ...
//   Space form: PIN   YYYY-MM-DD   HH:MM:SS   Status   VerifyMode ...
// Returns { pin, punch_time (device-local string), status, verify_mode, raw_line }
// or null if the line can't be understood.
function parseAttlog(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (line.includes('\t')) {
    const f = line.split('\t');
    if (f.length < 4) return null;
    const pin = f[0].trim();
    const punch_time = f[1].trim();
    if (!pin || !punch_time) return null;
    return { pin, punch_time, status: toInt(f[2]), verify_mode: toInt(f[3]), raw_line: line };
  }

  const f = trimmed.split(/\s+/);
  if (f.length < 5) return null;
  return {
    pin: f[0],
    punch_time: `${f[1]} ${f[2]}`,
    status: toInt(f[3]),
    verify_mode: toInt(f[4]),
    raw_line: line,
  };
}

const DT_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

// Convert a device-local 'YYYY-MM-DD HH:MM:SS' string into an unambiguous ISO
// instant by attaching the known device UTC offset (default +05:00, TimeZone=5).
//
// Why: punch_time is a `timestamptz`. Inserting a naive local string makes
// Postgres apply the *connection's* timezone, silently shifting the instant.
// Attaching the device offset here makes storage deterministic regardless of
// where the listener runs. Returns null if the input isn't the confirmed shape.
function toTimestamptz(localDateTime, offset) {
  if (typeof localDateTime !== 'string') return null;
  const m = localDateTime.trim().match(DT_RE);
  if (!m) return null;
  const off = OFFSET_RE.test(offset) ? offset : '+05:00';
  return `${m[1]}T${m[2]}${off}`;
}

// Parse the periodic heartbeat INFO string (spec §3.5), e.g.
//   ZAM70-NF24HA-Ver3.3.12,27,73,283,192.168.1.201,13,40,12,3,11110,0,25,0
// Field 0 is firmware; an IPv4 appears among the fields; field 3 is the device's
// record high-water mark. Best-effort — returns whatever it can identify.
function parseInfo(info) {
  if (typeof info !== 'string' || !info.trim()) return null;
  const parts = info.split(',').map((s) => s.trim());
  return {
    firmware: parts[0] || null,
    ip: parts.find((p) => /^\d{1,3}(\.\d{1,3}){3}$/.test(p)) || null,
    recordCount: parts[3] && /^\d+$/.test(parts[3]) ? parseInt(parts[3], 10) : null,
    raw: info,
  };
}

// Parse USERINFO records the device uploads in response to a
// `DATA QUERY USERINFO` command (spec §3.6). Each record is one line, either
//   USER PIN=1<TAB>Name=Ezan<TAB>Pri=0<TAB>Card=123<TAB>...
// or (some firmware) without the leading "USER ". Fields are TAB-separated
// key=value pairs; names may contain spaces, so we never split on spaces.
// Returns [{ pin, name, card, privilege }] — best-effort, ignores non-user lines.
function parseUserinfo(body) {
  if (typeof body !== 'string') return [];
  const users = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isUser = /^USER\s/i.test(line);
    const stripped = line.replace(/^USER\s+/i, '');
    // Qualify a line as a user record: explicit USER prefix, or it carries both
    // PIN= and Name= (so generic OPERLOG lines aren't mistaken for users).
    if (!isUser && !(/\bPIN=/i.test(stripped) && /\bName=/i.test(stripped))) continue;
    const f = {};
    for (const part of stripped.split('\t')) {
      const eq = part.indexOf('=');
      if (eq > 0) f[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
    if (!f.pin) continue;
    users.push({
      pin: f.pin,
      name: f.name || '',
      card: f.card && f.card !== '0' ? f.card : null,
      privilege: f.pri !== undefined && f.pri !== '' ? (parseInt(f.pri, 10) || 0) : null,
    });
  }
  return users;
}

module.exports = { parseAttlog, toTimestamptz, parseInfo, parseUserinfo };
