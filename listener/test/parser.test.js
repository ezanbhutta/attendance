'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAttlog, toTimestamptz, parseInfo } = require('../src/parser');

test('parseAttlog: confirmed TAB form, FACE punch (spec §3.3)', () => {
  const line = '2\t2026-06-20 11:49:05\t255\t15\t0\t0\t0\t0\t283';
  assert.deepEqual(parseAttlog(line), {
    pin: '2',
    punch_time: '2026-06-20 11:49:05',
    status: 255,
    verify_mode: 15,
    raw_line: line,
  });
});

test('parseAttlog: confirmed TAB form, FINGERPRINT punch (spec §3.3)', () => {
  const line = '2\t2026-06-20 11:54:32\t255\t1\t0\t0\t0\t0\t285';
  const p = parseAttlog(line);
  assert.equal(p.verify_mode, 1);
  assert.equal(p.status, 255);
  assert.equal(p.punch_time, '2026-06-20 11:54:32');
});

test('parseAttlog: tolerant space-separated form (date and time split)', () => {
  const p = parseAttlog('2 2026-06-20 11:49:05 255 15 0 0 0 0 283');
  assert.equal(p.pin, '2');
  assert.equal(p.punch_time, '2026-06-20 11:49:05');
  assert.equal(p.status, 255);
  assert.equal(p.verify_mode, 15);
});

test('parseAttlog: rejects junk / short lines', () => {
  assert.equal(parseAttlog(''), null);
  assert.equal(parseAttlog('   '), null);
  assert.equal(parseAttlog('2\t2026-06-20 11:49:05'), null); // too few tab fields
  assert.equal(parseAttlog('only two'), null); // too few space fields
  assert.equal(parseAttlog(null), null);
});

test('toTimestamptz: attaches the device offset to make the instant unambiguous', () => {
  assert.equal(toTimestamptz('2026-06-20 11:49:05', '+05:00'), '2026-06-20T11:49:05+05:00');
});

test('toTimestamptz: falls back to +05:00 on a bad offset, null on a bad datetime', () => {
  assert.equal(toTimestamptz('2026-06-20 11:49:05', 'nonsense'), '2026-06-20T11:49:05+05:00');
  assert.equal(toTimestamptz('not-a-date', '+05:00'), null);
  assert.equal(toTimestamptz('2026-13-99 99:99:99', '+05:00'), '2026-13-99T99:99:99+05:00'); // shape only; PG validates value
});

test('parseInfo: pulls firmware and IP from the heartbeat string (spec §3.5)', () => {
  const info = parseInfo('ZAM70-NF24HA-Ver3.3.12,27,73,283,192.168.1.201,13,40,12,3,11110,0,25,0');
  assert.equal(info.firmware, 'ZAM70-NF24HA-Ver3.3.12');
  assert.equal(info.ip, '192.168.1.201');
  assert.equal(info.recordCount, 283);
});

test('parseInfo: empty / non-string returns null', () => {
  assert.equal(parseInfo(''), null);
  assert.equal(parseInfo(undefined), null);
});
