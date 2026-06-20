# Attendance OS — Dashboard (React/Vite)

The admin UI (build spec §8). Reads/writes Supabase with the **anon
(publishable) key** + RLS; the service-role key never touches the browser.

## Run

```bash
cp .env.example .env     # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:5173
npm run build            # production bundle -> dist/
```

Create at least one admin login under **Supabase → Authentication → Users**
(email/password). Any logged-in user is an admin of this single-office system
(see the RLS note in `../supabase/README.md`).

## Pages

| Page | What it does |
|---|---|
| **Overview** | Today's present/late/incomplete/absent, device health, live punch feed (realtime) |
| **Employees** | Employee CRUD, device **PIN → employee** mapping, unmapped-PIN list |
| **Departments & Groups** | Org CRUD (brand per department) |
| **Shifts & Timetables** | Timetables (hours + grace), shifts, per-weekday timetable map |
| **Schedules** | Assign shifts with the **temporary → employee → group → department** priority chain |
| **Reports** | Total Time Card / Daily / Weekly / Monthly, date-range + department/brand filters, **CSV** + **Print/PDF** |
| **Corrections** | Manual logs (audit-tracked); never edits `raw_punches` |
| **Leave & Holidays** | Leave + holiday admin (drives absent detection) |
| **Help** | The operating guide (staff / admin / operator), printable |

## Notes

- **Realtime live feed** needs the `raw_punches` table added to the
  `supabase_realtime` publication (Supabase → Database → Replication). Without
  it, the feed still loads and has a Refresh button.
- **Reports** query the `v_*` views; **PDF** = browser Print (print CSS hides the
  chrome), so there's no heavy PDF dependency.
- Times are rendered in `Asia/Karachi` (override with `VITE_APP_TZ`).

## Stack

React 18, Vite 5, React Router 6, `@supabase/supabase-js`. Styling is plain CSS
with semantic design tokens (light/dark, 4.5:1 contrast, 44px targets,
mobile-first) — no UI dependency.
