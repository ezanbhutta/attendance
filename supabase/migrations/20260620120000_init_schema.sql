-- Attendance OS — core schema (build spec §6).
-- raw_punches is the immutable source of truth; everything else derives from it.
-- Access-control columns on raw_punches are nullable and reserved for Phase 2.

-- ─── ORG ────────────────────────────────────────────────────────────────────
create table if not exists departments (
  id bigint generated always as identity primary key,
  name text not null,
  parent_id bigint references departments(id) on delete set null,
  brand text,
  created_at timestamptz default now());

create table if not exists groups (
  id bigint generated always as identity primary key,
  name text not null);

create table if not exists employees (
  id bigint generated always as identity primary key,
  emp_code text unique not null,
  first_name text not null,
  last_name text,
  department_id bigint references departments(id) on delete set null,
  group_id bigint references groups(id) on delete set null,
  active boolean default true,
  hire_date date,
  created_at timestamptz default now());

-- ─── DEVICES ────────────────────────────────────────────────────────────────
create table if not exists devices (
  sn text primary key,
  name text,
  mac text,
  ip text,
  firmware text,
  last_seen timestamptz);

create table if not exists device_user_map (
  device_sn text references devices(sn),
  pin text not null,
  employee_id bigint references employees(id),
  primary key (device_sn, pin));

-- ─── RAW PUNCHES (immutable, append-only) ───────────────────────────────────
-- CONFIRMED: status always 255 on this device; verify_mode 15=face, 1=fingerprint.
create table if not exists raw_punches (
  id bigint generated always as identity primary key,
  device_sn text not null,
  pin text not null,
  punch_time timestamptz not null,          -- stored as an instant (listener attaches +05:00)
  status smallint,                          -- 255 on this device
  verify_mode smallint,                     -- 15=face, 1=fingerprint
  raw_line text,
  inserted_at timestamptz default now(),
  -- Phase 2 (door-access log) — nullable now:
  card_no text, door_id text, event_code smallint, in_out_state smallint, access_granted boolean,
  unique (device_sn, pin, punch_time));     -- dedup boundary (listener upsert onConflict)

-- Enforce "immutable, append-only" (spec §1 non-negotiable) at the DB level.
-- Listener inserts via ON CONFLICT DO NOTHING (no UPDATE), so this never blocks
-- normal capture or idempotent backfill. Corrections go through manual_logs.
create or replace function raw_punches_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'raw_punches is append-only; corrections go through manual_logs (spec §1)';
end;
$$;

drop trigger if exists raw_punches_no_update_delete on raw_punches;
create trigger raw_punches_no_update_delete
  before update or delete on raw_punches
  for each row execute function raw_punches_block_mutation();

-- ─── TIMETABLES / SHIFTS ────────────────────────────────────────────────────
create table if not exists timetables (
  id bigint generated always as identity primary key,
  name text not null,
  check_in time not null,
  check_out time not null,
  work_minutes int,
  late_grace_min int default 0,
  early_leave_grace_min int default 0,
  check_in_start time, check_in_end time, check_out_start time, check_out_end time,
  day_change_time time default '00:00:00',
  is_overnight boolean default false);

create table if not exists breaks (
  id bigint generated always as identity primary key,
  timetable_id bigint references timetables(id),
  start_time time, end_time time,
  paid boolean default false,
  auto_deduct boolean default true);

create table if not exists shifts (
  id bigint generated always as identity primary key,
  name text not null);

create table if not exists shift_details (
  id bigint generated always as identity primary key,
  shift_id bigint references shifts(id),
  timetable_id bigint references timetables(id),
  day_index int);                            -- 0=Sunday .. 6=Saturday (matches extract(dow))

-- ─── SCHEDULES (priority: temporary > employee > group > department > global) ─
create table if not exists employee_schedules (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id), shift_id bigint references shifts(id),
  start_date date, end_date date);

create table if not exists group_schedules (
  id bigint generated always as identity primary key,
  group_id bigint references groups(id) on delete cascade, shift_id bigint references shifts(id),
  start_date date, end_date date);

create table if not exists department_schedules (
  id bigint generated always as identity primary key,
  department_id bigint references departments(id) on delete cascade, shift_id bigint references shifts(id),
  start_date date, end_date date);

create table if not exists temporary_schedules (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id), shift_id bigint references shifts(id),
  the_date date);

-- ─── CALENDAR / EXCEPTIONS ──────────────────────────────────────────────────
create table if not exists holidays (
  id bigint generated always as identity primary key,
  the_date date, name text, pay_multiplier numeric default 1);

create table if not exists leaves (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id),
  leave_type text, start_date date, end_date date,
  status text default 'approved');

create table if not exists manual_logs (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id),
  punch_time timestamptz, status smallint, reason text,
  created_by text, created_at timestamptz default now());

-- ─── DERIVED DAILY ATTENDANCE ───────────────────────────────────────────────
create table if not exists attendance_daily (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id),
  work_date date not null,
  first_in timestamptz, last_out timestamptz,
  scheduled_in timestamptz, scheduled_out timestamptz,
  worked_minutes int default 0, late_minutes int default 0, early_leave_minutes int default 0,
  overtime_minutes int default 0, break_minutes int default 0,
  first_in_method smallint, last_out_method smallint,     -- 15=face, 1=fp (reporting)
  status text, computed_at timestamptz default now(),
  unique (employee_id, work_date));

-- ─── CONFIG ─────────────────────────────────────────────────────────────────
create table if not exists app_config (
  key text primary key,
  value jsonb not null);

-- ─── SUPPORTING INDEXES ─────────────────────────────────────────────────────
create index if not exists idx_raw_punches_pin_time      on raw_punches (pin, punch_time);
create index if not exists idx_raw_punches_device        on raw_punches (device_sn);
create index if not exists idx_employees_department      on employees (department_id);
create index if not exists idx_employees_group           on employees (group_id);
create index if not exists idx_device_user_map_employee  on device_user_map (employee_id);
create index if not exists idx_attendance_daily_date     on attendance_daily (work_date);
create index if not exists idx_leaves_employee           on leaves (employee_id);
create index if not exists idx_emp_sched_employee        on employee_schedules (employee_id);
create index if not exists idx_temp_sched_emp_date       on temporary_schedules (employee_id, the_date);
create index if not exists idx_holidays_date             on holidays (the_date);

-- ─── ROW-LEVEL SECURITY (spec §6/§11) ───────────────────────────────────────
-- Dashboard connects with the anon (publishable) key; after login, requests run
-- as `authenticated`. The listener/compute use the service-role key, which
-- BYPASSes RLS, so they can write raw_punches/attendance_daily regardless.
--
-- Model: any authenticated (logged-in) user is an admin of this single-office
-- system. raw_punches & attendance_daily are READ-ONLY to the dashboard
-- (writes come only from the listener/compute). All other tables are full CRUD.
-- `anon` (not logged in) gets NO policy => no access. Secure by default.
do $$
declare
  t text;
  rw_tables text[] := array[
    'departments','groups','employees','devices','device_user_map',
    'timetables','breaks','shifts','shift_details',
    'employee_schedules','group_schedules','department_schedules','temporary_schedules',
    'holidays','leaves','manual_logs','app_config'];
  ro_tables text[] := array['raw_punches','attendance_daily'];
begin
  foreach t in array rw_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t);
  end loop;

  foreach t in array ro_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_authenticated_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_authenticated_read', t);
  end loop;
end $$;
