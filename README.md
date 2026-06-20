# Attendance OS

Self-hosted biometric attendance + door system for a **ZKTeco SenseFace 2A**,
replacing ZKBio Time. Protocol behaviour is hardware-confirmed on firmware
`ZAM70-NF24HA-Ver3.3.12`.

```
ZKTeco SenseFace 2A ──ADMS push (HTTP, LAN)──▶ listener ──HTTPS──▶ Supabase ◀── dashboard
   face / fingerprint                          (Node/Express)      Postgres        (React/Vite)
   (cards open gate only,                      :8081              raw_punches →    reports, admin
    never counted)                                                attendance_daily
```

**Why it's robust:** punches are immutable and append-only; the listener only
acks the device after durable storage (with an on-disk buffer for Supabase
outages); cards never reach the attendance feed, so buddy-punching is impossible
by design; and check-in/out are derived by time (the device sends no direction).

## Repository layout

| Path | What | README |
|---|---|---|
| [`listener/`](listener/) | Always-on LAN service that captures ADMS punches → Supabase. Durable buffer + dedup. | [listener/README.md](listener/README.md) |
| [`supabase/`](supabase/) | Schema, RLS, immutability, attendance compute (functions + triggers), report views. | [supabase/README.md](supabase/README.md) |
| [`dashboard/`](dashboard/) | React/Vite admin UI: live feed, employees/PINs, shifts, schedules, reports, corrections, leave/holidays, help. | [dashboard/README.md](dashboard/README.md) |

## Build status (per spec §13)

| Stage | Status |
|---|---|
| 1. Listener (handshake, ATTLOG parse, dedup, durable buffer + drain) | ✅ built, **19 tests pass**, live smoke-tested |
| 2. Schema (§6) + RLS + immutability + seed | ✅ built, **validated on Postgres 16** |
| 3. Compute (§7): shift resolution, attendance fn, recompute triggers, pg_cron, report views | ✅ built, validated across Present/Incomplete/Holiday/Absent/Leave |
| 4. Dashboard (§8) | ✅ built, **production build passes** |
| 5. Phase 2 door-access log (§9) / Phase 3 push-to-device (§3.6) | ⏳ deferred (endpoints stubbed) |

## End-to-end setup

1. **Database** — apply `supabase/migrations/*` (Supabase CLI `db push` or the SQL editor). Optionally `seed.sql` for a test employee on PIN 2.
2. **Listener** — on the office LAN machine: `cd listener && cp .env.example .env` (fill Supabase URL + **service-role** key), `npm install`, `npm start` (or pm2/systemd). The device already targets `192.168.1.202:8081`.
3. **Dashboard** — `cd dashboard && cp .env.example .env` (Supabase URL + **anon** key), `npm install`, `npm run dev` (or `npm run build`). Create an admin user in Supabase Auth.

Verify capture without the hardware: `cd listener && npm run simulate`.

## Security (§11)

ADMS is plain, unauthenticated HTTP → keep the device + listener on a trusted/
segmented LAN, bind to the LAN interface, validate `SN`, never expose port 8081.
The **service-role key lives only in the listener's env**; the browser uses the
**anon key + RLS**. `raw_punches` is append-only (DB-enforced).

## The four confirmed facts that drive everything

1. Feed = **ATTLOG** (plain text, tab-separated); every row is a real attendance punch.
2. **Cards never appear** in ATTLOG — exclusion is hardware-enforced.
3. **Status is always `255`** (no in/out) → derive in/out by time.
4. **VerifyMode `15` = face, `1` = fingerprint** (stored for reporting only).
