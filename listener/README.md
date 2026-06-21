# Attendance OS — ADMS Listener (Stage 1)

Always-on LAN listener that captures biometric punches pushed by a **ZKTeco
SenseFace 2A** over the ADMS protocol and forwards them to **Supabase**. This is
Stage 1 (§13.1) of the [build spec](#how-this-maps-to-the-spec) — the capture
spine that everything else (compute, reports, dashboard) reads from.

```
ZKTeco SenseFace 2A ──ADMS push (HTTP, LAN)──▶ this listener ──HTTPS──▶ Supabase ◀── React dashboard (later stage)
   192.168.1.201                                :8081                  raw_punches
```

The protocol behaviour here is **hardware-confirmed** on firmware
`ZAM70-NF24HA-Ver3.3.12` (spec §0). Every record on the `ATTLOG` feed is a face
(`verify_mode=15`) or fingerprint (`verify_mode=1`) punch; NFC cards never reach
this feed, so buddy-punching by card is impossible by design.

## What's implemented

- **Handshake** — the confirmed `GET OPTION FROM:` reply (§3.2), realtime per-punch upload, Pakistan time.
- **ATTLOG capture** — tolerant tab/space parser (§3.3); punch times normalized to an unambiguous instant.
- **Durable local buffer + drain worker** — if Supabase is down, punches are spooled to disk **before** the device is acked, then retried until they land. This is the Stage-2 gate: **no lost punches, zero duplicates.**
- **Dedup** — idempotent upsert on `raw_punches (device_sn, pin, punch_time)`.
- **SN guard** — only the configured device's records are accepted (§5/§11).
- **Heartbeat / INFO** — updates `devices.last_seen` + `firmware` (§3.5), best-effort.
- **`/healthz`** — JSON health (buffered-punch count) for the operator/dashboard.
- **Keep-alive** — pm2 and systemd units (§5).

> **Not in this stage:** the Supabase schema (§6, Stage 3), attendance compute &
> reports (§7), and the dashboard (§8). OPERLOG/card parsing is Phase 2 (§9);
> server→device commands are Phase 3 (§3.6). Those endpoints currently ack and
> no-op, exactly as the spec sequences them.

## Quick start

```bash
cp .env.example .env          # fill in SUPABASE_URL + SUPABASE_SERVICE_KEY
npm install                   # express + @supabase/supabase-js
npm start                     # listener on :8081
```

In another terminal, simulate the device end-to-end (no hardware needed):

```bash
npm run simulate              # handshake + a face & fingerprint punch + heartbeat
curl localhost:8081/healthz   # {"ok":true,...,"buffered_punches":0}
```

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `DEVICE_SN` | `NYU7253801246` | Listener accepts **only** this SN. |
| `SUPABASE_URL` | — | Required. |
| `SUPABASE_SERVICE_KEY` | — | Required. **Service-role key, server-side only.** |
| `PORT` / `BIND_ADDR` | `8081` / `0.0.0.0` | Bind to the LAN interface in production. |
| `DEVICE_TZ_OFFSET` | `+05:00` | Device-local offset (TimeZone=5 → Pakistan). |
| `BUFFER_DIR` | `.buffer` | Durable spool location. |
| `DRAIN_INTERVAL_MS` | `15000` | How often the drain worker retries. |

## Tests

```bash
npm run test:core   # parser + buffer/outage logic — NO install needed (pure Node)
npm test            # also runs route tests (needs `npm install` for express)
```

`test/buffer.test.js` is the **Stage-2 gate**: it simulates a Supabase outage,
proves punches are held and later drained, that retries never create duplicates,
that punches arriving *during* an outage aren't lost, and that an interrupted
drain is recovered on restart.

## How the durable buffer works

1. A punch arrives → try `insertPunches` (Supabase).
2. On failure → append it to `.buffer/pending.jsonl` (synchronous, durable) → **then** ack `OK`. If even the spool write fails, the device is **not** acked (HTTP 500) so it resends.
3. The drain worker periodically **atomically renames** the spool aside, tries to flush it, and on failure re-queues it. New punches keep landing in a fresh spool meanwhile.
4. A crash mid-flush leaves a `*.processing` file; it's merged back on the next boot. Retried rows are idempotent via the unique key.

## Deploy (keep-alive)

**macOS (launchd)** — the agent machine in this deployment is a Mac. Run from `listener/`:
```bash
bash deploy/install-macos.sh     # auto-start at login + restart on crash
tail -f catcher.log              # watch it
bash deploy/uninstall-macos.sh   # remove
```
For an unattended restart after a reboot, also enable **System Settings → Users &
Groups → Automatic login** (requires FileVault off).

**pm2 (cross-platform):**
```bash
pm2 start ecosystem.config.js && pm2 startup && pm2 save
```

**systemd (Linux):** see the header of [`deploy/attendance-listener.service`](deploy/attendance-listener.service).

Give the agent machine a static IP `192.168.1.22` (or a DHCP reservation) on
SSID `Haseebmadeit` so the device's configured target stays valid (§12). The
device already points at `192.168.1.22:8081` — no device change needed.

## Project layout

```
src/
  server.js   entry: wires everything, starts HTTP + drain worker, clean shutdown
  app.js      express app (routes, SN guard, ATTLOG normalize, ack-after-storage)
  parser.js   parseAttlog / toTimestamptz / parseInfo  (confirmed formats)
  store.js    supabase sink: insertPunches (idempotent), updateDeviceStatus
  buffer.js   DurableBuffer: spool + drain + crash recovery
  config.js   env load/validate
  log.js      timestamped logger
test/         parser, buffer (Stage-2 gate), route tests
tools/        simulate-device.js  (replay the device exchange)
deploy/       systemd unit; install-macos.sh / uninstall-macos.sh (launchd); ecosystem.config.js (pm2)
```

## Security (§11)

ADMS is **plain HTTP, unauthenticated**. Keep device + listener on a trusted/
segmented LAN, bind to the LAN interface, validate `SN`, and **never expose port
8081 to the internet**. The service-role key lives only in the agent's env; the
dashboard (later stage) uses the anon key + RLS.

## How this maps to the spec

| Spec | Here |
|---|---|
| §3.2 handshake | `app.js` `HANDSHAKE` |
| §3.3 ATTLOG format | `parser.js` `parseAttlog` + tests |
| §3.5 heartbeat/INFO | `parser.js` `parseInfo`, `store.updateDeviceStatus` |
| §5 listener + buffer | `app.js`, `buffer.js` |
| §5 dedup key | `store.insertPunches` upsert `onConflict` |
| §13.1 Stage-2 gate | `test/buffer.test.js` |
| Appendix B gotchas | Express 5 `/{*splat}`, raw body, ack-after-storage, SN guard |
