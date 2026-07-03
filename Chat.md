# Attendance OS — Development Discussion Log

A record of the conversation behind **Attendance OS** (HaseebMadeit) — the
biometric attendance and payroll-inputs system built around the ZKTeco
SenseFace 2A device for a Pakistan office. Each section is a request from the
office and what was delivered in response. Commit hashes are given so any
change can be traced in git history.

> A guiding rule set early and kept throughout: **no salary is ever calculated
> by the system — HR records the inputs, the system only organises them.** And
> for every new function, the logic is confirmed with the office first, because
> the logic is what matters.

---

## 1. The one-click branded PDF (Statement)

**Ask:** A single button that produces a branded PDF for any employee, shift or
department — with a clear reason next to every day off (holiday name, leave and
its approval state, weekly off), sensible data-driven filenames, and everything
in one document. No browser print dialog, no link to click.

**Delivered:** A self-contained PDF generator (jsPDF + autotable) with the
HaseebMadeit letterhead, embedded Inter typography, and a why-off remark on each
day. Filenames are built from the actual selection (person / shift / department
+ date range).

- `681b7da` Proper branded PDF: HaseebMadeit letterhead, clean layout, summary
- `d139027` Statement: one-click branded PDF for any employee, shift or department

## 2. "Make it feel like a branding agency made it"

**Ask:** The PDF still didn't feel professional, beautiful and modern. It should
feel like a design agency handed it over — something employees and designers
would be proud of. From three directions offered, the office chose **Minimal
Swiss** (Inter typography, generous whitespace, hairline rules, restrained
colour).

**Delivered:** The Statement PDF was art-directed in that Minimal Swiss
language, in real Inter type.

- `09e976a` Statement PDF: art-directed "Minimal Swiss" redesign in real Inter type

## 3. "Nothing changed — PR, merge and deploy"

**Ask:** The new design wasn't showing up live.

**Finding:** The repository has a single branch which is already the default, so
nothing was blocked on a merge — the stale view was a Vercel build/cache issue.
A fresh production deploy was triggered and the guidance was: hard-refresh to get
past the cached bundle.

- `574b99a` chore: trigger fresh production deploy

## 4. Same treatment for Reports and CEO View

**Ask:** Apply the same one-click branded PDF — same header, logo, footer — to
**Reports** and the **CEO View** too. No browser print, no URL link anywhere.

**Delivered:** Both pages got the same one-click branded export path as
Statement.

- `51d0484` Reports + CEO View: one-click branded PDF (no browser print)

## 5. "Too simple — I need a top-notch PDF" + a written summary

**Ask:** The PDF was still too plain. It needed a genuinely premium style, and a
short narrative — *a general summary of how this person is*.

**Delivered:** A premium redesign: a violet hero panel, an attendance ring,
tinted stat cards, a distribution bar, status chips, and a prose summary card
that reads as a short human paragraph about the person.

- `1481fa5` PDF: premium redesign — hero panel, attendance ring, cards, narrative summary

## 6. PDF corrections

**Ask, in sequence:**
1. The ring was sitting on top of the date.
2. The day of week was missing — write the weekday together with the date.
3. The document didn't clearly state the employee name, department and shift.

**Delivered:** Fixed the ring/date overlap, wrote the weekday alongside every
date, and put the employee name, department and shift explicitly on the page.

- `67c1ee4` PDF: fix ring/date overlap, write weekday with date, explicit name/dept/shift

## 7. Night-shift logic for holidays and leave

**Ask:** A night shift is worked across midnight and counts under the **previous**
day. So a holiday set on a calendar date should land on the previous work-date
for night-shift workers (a holiday on 26 June belongs to the 25 June work-date
they worked that morning). **And their leaves follow the same rule.**

**Delivered:** Holiday and approved-leave lookups now resolve on the physical day
worked (`coalesce(shift_date, p_date)`), so both fall on the correct work-date
for night shifts.

- `cd6c41c` Night shift: a holiday falls on the work-date worked that morning
- `bae68b2` Night shift: approved leave also falls on the work-date worked that morning

## 8. Salary-report inputs — recorded by HR, never calculated

**Ask:** Add the payroll input functions, confirming the logic at each step:
- **No salary is ever calculated by the system.**
- **Half-day entry:** employee, date, the absent window (from-time → to-time),
  a reason note, and marked **Paid** or **Unpaid**. The day stays **Present**
  but also carries a **Half Day** status and reduced working hours.
- **Leave Paid / Unpaid:** two buttons when recording a leave, with the reason
  note kept.
- All of these appear on the **Leave & Holidays** page, and the new columns are
  added to the **Reports** as well (with working hours, overtime and days).

**Delivered:** A `half_days` table and a `paid` flag on leaves; Paid/Unpaid
controls on the Leave & Holidays page; the half-day overlay that keeps the day
Present, tags it Half Day, and reduces the worked hours by the absent window;
and the matching columns across Reports.

- `2df83e3` Leave: HR marks each leave Paid or Unpaid (recorded, not calculated)
- `6589469` Half days: HR records a part-day absence (recorded, not calculated)
- `823726c` Reports: half-day and paid/unpaid-leave columns (recorded, not calculated)

## 9. Carry the same inputs into CEO View and Statement

**Ask:** Drop the same figures into CEO View and Statement too — **but do not
disturb the existing hierarchy or formatting.**

**Delivered:** The per-person table in CEO View and the figures block in
Statement gained Half days / Paid leave / Unpaid leave, leaving the tiles,
donut and department/shift tables untouched.

- `a873469` Statement + CEO View: half-day and paid/unpaid-leave figures

## 10. Security review — "to the level of Google or banking"

**Ask:** Treat this like three award-winning cybersecurity firms auditing the
system together: test everything, fix what can be fixed automatically, and get
the security to a banking / Google standard.

**Delivered:** A multi-dimension adversarial audit of the whole system
(dashboard, database, and the office listener), with each finding verified
before acting. Every safe fix was applied and pushed:

- **Web** — a full Content-Security-Policy and security-header set
  (anti-clickjacking, HSTS, tight `connect-src`), and a CSV formula-injection
  guard so exported names/reasons can't execute in a spreadsheet.
- **Database** — locked down the elevated (`SECURITY DEFINER`) functions so they
  are no longer callable by ordinary logged-in users; only the server-side
  service role can run them. Verified the dashboard never calls them, so nothing
  breaks.
- **Listener** (the office catcher that writes with the service-role key) — this
  was the most serious finding: it was gated only by the device serial, which is
  not a secret. Added IP allow-listing and a shared-token check, rate limiting,
  request-size and line caps, privilege clamping, a device-password wipe after
  hand-off, and a log-injection guard.

The report also handed the office a clear **operator checklist** — the things
only they can do from a console: run the database lockdown in Supabase, **turn
off public sign-up / anonymous sign-in** (the single highest-leverage control,
since access is otherwise open to anyone who can log in), lock the listener to
the LAN, rotate keys, and plan the desktop-app framework upgrade.

- `5d3a3f5` security: SPA security headers + CSV formula-injection guard
- `8b892f7` security: lock down SECURITY DEFINER RPCs (revoke anon/authenticated EXECUTE)
- `b846e25` security: harden the ADMS listener (auth, limits, privilege, logs)

## 11. Remove the architecture note on the login screen

**Ask:** Remove the small helper note under the sign-in form.

**Delivered:** Removed it. It also disclosed the auth architecture on the public
login page, so dropping it is a small security win too.

- `384f775` Login: remove the Supabase/RLS architecture note

## 12. Always show full employee names

**Ask:** In the tables, always show the full name (not just the first name), and
keep all the spaces in a name intact.

**Delivered:** Leaves and Half days (Calendar), Corrections, and Schedules now
render the complete name (first + last, every internal space preserved) via a
shared `fullName` helper, fetching `last_name` where the query didn't already.

- `9b78b73` Tables: show full employee name, not just first name

## 13. Show 50–100 live punches in the Overview

**Ask:** The Overview should show at least 50–100 punches, and keep them live.

**Delivered:** The Live punch feed fetched 60 but rendered only 14 — now it
fetches 100 and renders them all inside a viewport-capped scroll panel, while the
existing realtime subscription keeps it updating the instant anyone scans.

- `6d45fb5` Overview: show up to 100 live punches, not 14

---

## Principles that held throughout

- **The system records; it does not decide pay.** Half-days, paid/unpaid leave
  and overtime are HR inputs — the system never computes a salary.
- **Confirm the logic first.** Every new behaviour (especially the night-shift
  work-date rule) was agreed before it was built.
- **The service-role key stays server-side.** It lives only in the office
  listener / desktop app — never in the browser bundle.
- **Pakistan time, no DST.** Punch instants are stored against a fixed `+05:00`
  offset.
- **One-click, branded, self-contained.** Every export is a single button that
  produces a HaseebMadeit-branded PDF — no browser print, no external link.
