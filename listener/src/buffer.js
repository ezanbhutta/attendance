'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./log');

// Durable local buffer + drain worker (spec §5, the Stage-2 gate).
//
// Goal: a punch is NEVER lost and NEVER duplicated, even if Supabase is down
// when it arrives. Punches that can't be written to the DB are appended to an
// on-disk JSONL spool *before* the device is acked. A background worker retries
// the spool until the DB accepts it; the unique key makes retries idempotent.
//
// Crash-safety uses an atomic rename: a drain "claims" the current spool by
// renaming it aside, so new punches keep appending to a fresh file while the
// claimed batch is in flight. If the process dies mid-drain, recover() merges
// the claimed file back on the next boot.

class DurableBuffer {
  constructor(dir) {
    this.dir = dir;
    this.pendingFile = path.join(dir, 'pending.jsonl');
    this.processingFile = path.join(dir, 'pending.processing.jsonl');
    this.deadLetterFile = path.join(dir, 'dead-letter.jsonl');
    this.draining = false;
    this.timer = null;
    fs.mkdirSync(dir, { recursive: true });
    this.recover();
  }

  // Merge a leftover in-flight batch (from a crash mid-drain) back into pending.
  recover() {
    if (!fs.existsSync(this.processingFile)) return;
    const data = fs.readFileSync(this.processingFile, 'utf8');
    if (data) fs.appendFileSync(this.pendingFile, data);
    fs.rmSync(this.processingFile, { force: true });
    log.warn('recovered an in-flight buffer batch from a previous run');
  }

  // Spool rows durably. Synchronous append so the bytes are on disk before the
  // caller acks the device. Returns the number of rows spooled.
  append(rows) {
    if (!rows || !rows.length) return 0;
    fs.appendFileSync(this.pendingFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return rows.length;
  }

  // Park rows we will never be able to store (e.g. an unparseable line) so they
  // can't poison the retry spool, while still keeping them for forensic review.
  deadLetter(items, reason) {
    if (!items || !items.length) return;
    const at = new Date().toISOString();
    const data = items.map((it) => JSON.stringify({ reason, at, item: it })).join('\n') + '\n';
    fs.appendFileSync(this.deadLetterFile, data);
  }

  pendingCount() {
    return this._countLines(this.pendingFile);
  }

  _countLines(file) {
    if (!fs.existsSync(file)) return 0;
    const data = fs.readFileSync(file, 'utf8');
    return data ? data.split('\n').filter((l) => l.trim()).length : 0;
  }

  // Attempt to flush the current spool to the store exactly once.
  // insertFn(rows) must throw on failure. Returns a small result summary.
  async drainOnce(insertFn) {
    if (this.draining) return { skipped: true };
    if (this._countLines(this.pendingFile) === 0) return { drained: 0 };

    this.draining = true;
    try {
      // Atomically claim the batch; new punches now append to a fresh pending file.
      fs.renameSync(this.pendingFile, this.processingFile);
      const data = fs.readFileSync(this.processingFile, 'utf8');
      const rows = data.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

      if (!rows.length) {
        fs.rmSync(this.processingFile, { force: true });
        return { drained: 0 };
      }

      try {
        await insertFn(rows);
        fs.rmSync(this.processingFile, { force: true });
        log.info(`drained ${rows.length} buffered punch(es) to the store`);
        return { drained: rows.length };
      } catch (e) {
        // Re-queue the whole batch and release the claim. Idempotent on retry.
        fs.appendFileSync(this.pendingFile, data);
        fs.rmSync(this.processingFile, { force: true });
        log.warn(`drain failed; re-queued ${rows.length} punch(es):`, e.message);
        return { drained: 0, requeued: rows.length, error: e.message };
      }
    } finally {
      this.draining = false;
    }
  }

  // Start the background drain worker. Unref'd so it never holds the process open.
  start(insertFn, intervalMs) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.drainOnce(insertFn).catch((e) => log.error('drain worker error:', e.message));
    }, intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { DurableBuffer };
