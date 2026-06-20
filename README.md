# Attendance OS

Self-hosted biometric attendance + door system for a **ZKTeco SenseFace 2A**,
replacing ZKBio Time. Protocol behaviour is hardware-confirmed on firmware
`ZAM70-NF24HA-Ver3.3.12`.

**Recommended: the desktop app** (`desktop/`) — one Mac/Windows/Linux app you
open to fetch punches and view reports. It supports two capture modes:

- **(A) Fetch-on-open (pull):** open the app on the office Wi-Fi → it reads the punches the device has stored internally → saves them to Supabase. No always-on machine.
- **(B) Always-on catcher (push, hardware-proven):** a background listener receives ADMS pushes in real time. Bundled as the backup.

```
device         ──(A) fetch on open  /  (B) ADMS push──▶  app / listener  ──▶  Supabase  ──▶  reports
SenseFace 2A      face / fingerprint                                          Postgres       (app or web)
                  (cards open gate only, never counted)
```

**Why it's robust:** punches are immutable and append-only; pull and push dedup
on the same key, so re-syncing never doubles; cards never reach the attendance
feed, so buddy-punching is impossible by design; check-in/out are derived by
time (the device sends no direction).

## Repository layout

| Path | What | README |
|---|---|---|
| [`desktop/`](desktop/) | **The app.** Electron: fetch-on-open (pull) + bundled push backup + the dashboard as its window + auto-update. | [desktop/README.md](desktop/README.md) |
| [`dashboard/`](dashboard/) | React/Vite admin UI (also the desktop window): live feed, employees/PINs, shifts, schedules, reports, corrections, leave/holidays, help. | [dashboard/README.md](dashboard/README.md) |
| [`supabase/`](supabase/) | Schema, RLS, immutability, attendance compute (functions + triggers), report views. | [supabase/README.md](supabase/README.md) |
| [`listener/`](listener/) | Standalone always-on ADMS capture service (also bundled into the app as the push backup). Durable buffer + dedup. | [listener/README.md](listener/README.md) |

## Build status (per spec §13)

| Stage | Status |
|---|---|
| 1. Listener (handshake, ATTLOG parse, dedup, durable buffer + drain) | ✅ built, **19 tests pass**, live smoke-tested |
| 2. Schema (§6) + RLS + immutability + seed | ✅ built, **validated on Postgres 16** |
| 3. Compute (§7): shift resolution, attendance fn, recompute triggers, pg_cron, report views | ✅ built, validated across Present/Incomplete/Holiday/Absent/Leave |
| 4. Dashboard (§8) | ✅ built, **production build passes** |
| 5. Desktop app: fetch-on-open (pull) + bundled push backup + auto-update | ✅ built — **sync logic tested, app boots, packaging validated**; device-pull needs a test on real hardware |
| 6. Phase 2 door-access log (§9) / Phase 3 push-to-device (§3.6) | ⏳ deferred (endpoints stubbed) |

## End-to-end setup

> **New here?** Follow **[SETUP.md](SETUP.md)** — plain, click-by-click steps. The summary below is for those who already know Supabase + Node.

**Recommended (the desktop app):**
1. **Database** — apply `supabase/setup.sql` (one paste in the Supabase SQL editor). Optionally `seed.sql` for a test employee on PIN 2.
2. **Test the device fetch** on the office PC (same Wi-Fi as the device): `cd desktop && npm install && npm run sync -- --dry-run`.
3. **Run the app:** `cd desktop && npm run bundle:renderer && npm start` → first-run **Settings** → paste your Supabase keys + device IP. (Installers: push a `v*` tag → GitHub Actions builds Mac/Win/Linux + enables auto-update.)

**Advanced (run the pieces separately):** `listener/` (push capture, pm2/systemd) + `dashboard/` (web UI with `VITE_*` env). Verify capture without hardware: `cd listener && npm run simulate`.

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
