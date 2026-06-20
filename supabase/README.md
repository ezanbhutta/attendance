# Attendance OS — Supabase (schema + compute + reports)

Stages 3 & "compute + reports" of the build spec (§6, §7). This is the database
the listener writes to and the dashboard reads from.

## Layout

```
supabase/
  migrations/
    20260620120000_init_schema.sql           tables, indexes, append-only trigger, RLS
    20260620120100_seed_device_and_config.sql real device + default config knobs
    20260620120200_compute_and_reports.sql    shift resolution, attendance compute, triggers, report views
    20260620120300_pg_cron.sql                nightly recompute (guarded; no-op if pg_cron absent)
  seed.sql                                    DEV seed: test employee mapped to PIN 2 + sample shift
```

## Apply it

**Supabase CLI (recommended):**
```bash
supabase link --project-ref <your-ref>
supabase db push          # applies migrations/
# optional dev data:
supabase db reset         # re-applies migrations + seed.sql (LOCAL/dev only)
```

**Or the SQL editor:** paste each `migrations/*.sql` in filename order, then
optionally `seed.sql`. Everything is idempotent (`if not exists`, `create or
replace`, `on conflict do nothing`), so re-running is safe.

> After applying, the listener (Stage 1) will land punches in `raw_punches` and
> attendance will compute automatically (see triggers below).

## Security model (RLS)

- **Listener / compute** use the **service-role key** → BYPASS RLS → can write `raw_punches` and `attendance_daily`.
- **Dashboard** uses the **anon (publishable) key**; after login, requests run as `authenticated`.
- **`raw_punches` & `attendance_daily` are read-only** to the dashboard (writes only from the listener/compute).
- All other tables are full CRUD for `authenticated`. `anon` (not logged in) gets **nothing**.
- Report views use `security_invoker = true`, so the caller's RLS applies (anon → empty).

> **Assumption to confirm when building auth:** "any logged-in user is an admin"
> (single-office system, no per-user row isolation). If you want public read or
> finer roles, adjust the policies in `init_schema.sql`. This is the one place
> the spec's "anon key + RLS" line left a real choice — flagged here on purpose.

## Immutability

`raw_punches` is append-only, enforced by a DB trigger: **UPDATE/DELETE raise an
exception for everyone** (even the table owner). The listener inserts via
`ON CONFLICT DO NOTHING`, so capture and idempotent backfill are unaffected.
Corrections go through `manual_logs`, never by editing `raw_punches`.

## Attendance computation (§7)

Status is always `255` on this device, so check-in/out are **derived by time**:
first punch of the shift-day = in, last = out (repeats inside
`dedup_window_seconds` collapsed). The applicable timetable is resolved by the
priority chain **temporary > employee > group > department > global**, then
late / early-leave / overtime / worked / break minutes are computed and
`attendance_daily` is upserted.

Key functions:

| Function | Use |
|---|---|
| `compute_attendance_for(emp_id, date)` | compute one employee, one day |
| `recompute_attendance_for_date(date)` | all active employees for a date → row count |
| `recompute_employee_range(emp, from, to)` | one employee over a range |
| `recompute_attendance_range(from, to)` | everyone over a range |

**Recompute happens automatically** via triggers on `raw_punches` (insert),
`manual_logs` (insert), and `leaves` (insert/update); plus the nightly pg_cron
job for the trailing 3 days.

## Report views (dashboard reads these)

`v_total_time_card` (primary), `v_report_daily`, `v_report_weekly`,
`v_report_monthly`, plus `v_live_punches` (feed), `v_unknown_pins` (PINs with no
employee mapping), and `v_device_health` (online/last-seen).

## Verified

Applied against PostgreSQL 16 with the Supabase roles. Confirmed: RLS
(authenticated read / anon blocked / service_role write), append-only trigger,
dedup, and the compute across **Present / Incomplete / Holiday / Absent / Leave**
(e.g. 09:25 in + 18:30 out with a 1h lunch → late 15, break 60, worked 485,
OT 30, face-in/fp-out).

## Status values

`Present`, `Incomplete` (one punch, no check-out), `Absent`, `Leave`, `Holiday`,
`WeeklyOff` (no timetable that weekday). Lateness/OT live in the minute columns,
not the status.
