-- =============================================================
-- Attendance OS — combined database setup (schema + compute + reports).
-- GENERATED from supabase/migrations/*.  Paste this whole file into the
-- Supabase SQL Editor and click Run.  (Re-generate after editing migrations:
--   cat migrations/2026*.sql > setup.sql )
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- migrations/20260620120000_init_schema.sql
-- ─────────────────────────────────────────────────────────────
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
  last_seen timestamptz,
  last_user_sync timestamptz,
  last_user_sync_count int);

create table if not exists device_user_map (
  device_sn text references devices(sn),
  pin text not null,
  employee_id bigint references employees(id) on delete cascade,
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
  employee_id bigint references employees(id) on delete cascade, shift_id bigint references shifts(id),
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
  employee_id bigint references employees(id) on delete cascade, shift_id bigint references shifts(id),
  the_date date);

-- ─── CALENDAR / EXCEPTIONS ──────────────────────────────────────────────────
create table if not exists holidays (
  id bigint generated always as identity primary key,
  the_date date, name text, pay_multiplier numeric default 1);

create table if not exists leaves (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id) on delete cascade,
  leave_type text, start_date date, end_date date,
  status text default 'approved');

create table if not exists manual_logs (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id) on delete cascade,
  punch_time timestamptz, status smallint, reason text,
  created_by text, created_at timestamptz default now());

-- ─── DERIVED DAILY ATTENDANCE ───────────────────────────────────────────────
create table if not exists attendance_daily (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id) on delete cascade,
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

-- ─────────────────────────────────────────────────────────────
-- migrations/20260620120100_seed_device_and_config.sql
-- ─────────────────────────────────────────────────────────────
-- Production seed: the real device (spec §2) and default config knobs (§7/§13.2).
-- Safe to re-run (on conflict do nothing). Employee/PIN mapping is dev-only and
-- lives in supabase/seed.sql instead.

insert into devices (sn, name, mac, ip, firmware) values
  ('NYU7253801246', 'SenseFace 2A — Main Gate', '00:17:61:12:7a:a2', '192.168.1.201', 'ZAM70-NF24HA-Ver3.3.12')
on conflict (sn) do nothing;

-- Config knobs consumed by the attendance compute (spec §7) and reporting.
insert into app_config (key, value) values
  ('timezone',                 '"Asia/Karachi"'::jsonb),   -- device-local zone (TimeZone=5)
  ('dedup_window_seconds',     '60'::jsonb),                -- collapse repeat scans within N s
  ('overtime_mode',            '"after_scheduled_end"'::jsonb),
  ('overtime_min_minutes',     '0'::jsonb),                 -- ignore OT below this many minutes
  ('absent_rule',              '"no_punch_is_absent"'::jsonb),
  ('default_late_grace_min',   '0'::jsonb),
  ('default_early_leave_grace_min', '0'::jsonb),
  ('week_start',               '1'::jsonb),                 -- 1=Monday for weekly reports
  ('global_shift_id',          'null'::jsonb)               -- fallback shift when nothing else matches
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- migrations/20260620120200_compute_and_reports.sql
-- ─────────────────────────────────────────────────────────────
-- Attendance computation + report views (build spec §7).
-- Status is always 255 on this device, so check-in/out are DERIVED by time:
-- first punch of the shift-day = in, last = out. All functions are SECURITY
-- DEFINER so the recompute triggers can write attendance_daily regardless of
-- which role inserted the punch.

-- ─── config helpers ─────────────────────────────────────────────────────────
create or replace function attendance_config_text(p_key text, p_default text)
returns text language sql stable as $$
  select coalesce((select value #>> '{}' from app_config where key = p_key), p_default);
$$;

create or replace function attendance_config_int(p_key text, p_default int)
returns int language sql stable as $$
  select coalesce((select (value #>> '{}')::int from app_config where key = p_key), p_default);
$$;

create or replace function attendance_tz()
returns text language sql stable as $$
  select attendance_config_text('timezone', 'Asia/Karachi');
$$;

-- ─── shift resolution (priority: temporary > employee > group > dept > global) ─
create or replace function resolve_shift_id(p_emp bigint, p_date date)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare v bigint; v_group bigint; v_dept bigint;
begin
  select shift_id into v from temporary_schedules
    where employee_id = p_emp and the_date = p_date order by id desc limit 1;
  if v is not null then return v; end if;

  select shift_id into v from employee_schedules
    where employee_id = p_emp and p_date between start_date and coalesce(end_date, 'infinity'::date)
    order by start_date desc nulls last, id desc limit 1;
  if v is not null then return v; end if;

  select group_id, department_id into v_group, v_dept from employees where id = p_emp;

  if v_group is not null then
    select shift_id into v from group_schedules
      where group_id = v_group and p_date between start_date and coalesce(end_date, 'infinity'::date)
      order by start_date desc nulls last, id desc limit 1;
    if v is not null then return v; end if;
  end if;

  if v_dept is not null then
    select shift_id into v from department_schedules
      where department_id = v_dept and p_date between start_date and coalesce(end_date, 'infinity'::date)
      order by start_date desc nulls last, id desc limit 1;
    if v is not null then return v; end if;
  end if;

  select (value #>> '{}')::bigint into v from app_config where key = 'global_shift_id';
  return v;
end $$;

-- ─── the core: compute one employee's attendance for one shift-day ───────────
create or replace function compute_attendance_for(p_emp bigint, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  tz       text := attendance_tz();
  dedup_s  int  := attendance_config_int('dedup_window_seconds', 60);
  ot_mode  text := attendance_config_text('overtime_mode', 'after_scheduled_end');
  ot_min   int  := attendance_config_int('overtime_min_minutes', 0);
  v_shift  bigint;
  v_tt     timetables%rowtype;
  has_tt   boolean := false;
  overnight boolean := false;
  v_cnt    int;
  v_first  timestamptz; v_last timestamptz;
  v_first_m smallint;   v_last_m smallint;
  v_sched_in timestamptz; v_sched_out timestamptz;
  v_late int := 0; v_early int := 0; v_ot int := 0; v_worked int := 0; v_break int := 0;
  v_status text;
begin
  -- resolve the applicable timetable for this weekday (if any)
  v_shift := resolve_shift_id(p_emp, p_date);
  if v_shift is not null then
    select t.* into v_tt
      from shift_details sd join timetables t on t.id = sd.timetable_id
      where sd.shift_id = v_shift and sd.day_index = extract(dow from p_date)::int
      limit 1;
    has_tt := found;
  end if;

  -- gather biometric punches (mapped via device_user_map) + manual corrections,
  -- then collapse repeats inside the dedup window
  with src as (
    select rp.punch_time as t, rp.verify_mode::smallint as m
      from raw_punches rp
      join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
     where dum.employee_id = p_emp and (rp.punch_time at time zone tz)::date = p_date
    union all
    select ml.punch_time, null::smallint
      from manual_logs ml
     where ml.employee_id = p_emp and (ml.punch_time at time zone tz)::date = p_date
  ),
  ordered as (select t, m, lag(t) over (order by t) as prev from src),
  deduped as (select t, m from ordered where prev is null or t - prev > make_interval(secs => dedup_s))
  select count(*), min(t), max(t),
         (array_agg(m order by t))[1], (array_agg(m order by t desc))[1]
    into v_cnt, v_first, v_last, v_first_m, v_last_m
    from deduped;

  if has_tt then
    overnight   := v_tt.is_overnight or v_tt.check_out <= v_tt.check_in;
    v_sched_in  := ((p_date + v_tt.check_in)::timestamp) at time zone tz;
    v_sched_out := ((p_date + v_tt.check_out + (case when overnight then interval '1 day' else interval '0' end))::timestamp) at time zone tz;
  end if;

  if coalesce(v_cnt, 0) = 0 then
    -- no punches: holiday > approved leave > weekly-off (no timetable) > absent
    if exists (select 1 from holidays where the_date = p_date) then
      v_status := 'Holiday';
    elsif exists (select 1 from leaves where employee_id = p_emp and status = 'approved'
                    and p_date between start_date and coalesce(end_date, start_date)) then
      v_status := 'Leave';
    elsif not has_tt then
      v_status := 'WeeklyOff';
    else
      v_status := 'Absent';
    end if;
  else
    if has_tt then
      v_late := greatest(0, ceil(extract(epoch from
                  (v_first - (v_sched_in + make_interval(mins => coalesce(v_tt.late_grace_min, 0))))) / 60))::int;
      if v_cnt >= 2 then
        v_early := greatest(0, ceil(extract(epoch from
                     ((v_sched_out - make_interval(mins => coalesce(v_tt.early_leave_grace_min, 0))) - v_last)) / 60))::int;
        select coalesce(sum(extract(epoch from (end_time - start_time)) / 60) filter (where auto_deduct), 0)::int
          into v_break from breaks where timetable_id = v_tt.id;
        v_worked := greatest(0, floor(extract(epoch from (v_last - v_first)) / 60)::int - v_break);
        if ot_mode = 'after_scheduled_end' then
          v_ot := greatest(0, floor(extract(epoch from (v_last - v_sched_out)) / 60))::int;
          if v_ot < ot_min then v_ot := 0; end if;
        end if;
      end if;
    elsif v_cnt >= 2 then
      v_worked := floor(extract(epoch from (v_last - v_first)) / 60)::int;  -- worked on a day off
    end if;
    v_status := case when v_cnt = 1 then 'Incomplete' else 'Present' end;
  end if;

  insert into attendance_daily as ad (
    employee_id, work_date, first_in, last_out, scheduled_in, scheduled_out,
    worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, break_minutes,
    first_in_method, last_out_method, status, computed_at)
  values (
    p_emp, p_date, v_first, v_last, v_sched_in, v_sched_out,
    coalesce(v_worked,0), coalesce(v_late,0), coalesce(v_early,0), coalesce(v_ot,0), coalesce(v_break,0),
    v_first_m, v_last_m, v_status, now())
  on conflict (employee_id, work_date) do update set
    first_in = excluded.first_in, last_out = excluded.last_out,
    scheduled_in = excluded.scheduled_in, scheduled_out = excluded.scheduled_out,
    worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes,
    early_leave_minutes = excluded.early_leave_minutes, overtime_minutes = excluded.overtime_minutes,
    break_minutes = excluded.break_minutes, first_in_method = excluded.first_in_method,
    last_out_method = excluded.last_out_method, status = excluded.status, computed_at = now();
end $$;

-- ─── bulk / range recompute (spec §7: recompute on any change) ───────────────
create or replace function recompute_attendance_for_date(p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select id from employees where active loop
    perform compute_attendance_for(r.id, p_date); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function recompute_employee_range(p_emp bigint, p_from date, p_to date)
returns void language plpgsql security definer set search_path = public as $$
declare d date := p_from;
begin
  while d <= p_to loop perform compute_attendance_for(p_emp, d); d := d + 1; end loop;
end $$;

create or replace function recompute_attendance_range(p_from date, p_to date)
returns void language plpgsql security definer set search_path = public as $$
declare d date := p_from;
begin
  while d <= p_to loop perform recompute_attendance_for_date(d); d := d + 1; end loop;
end $$;

-- ─── triggers: recompute on any new punch / manual log / leave ───────────────
create or replace function trg_recompute_on_punch()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp bigint;
begin
  select employee_id into v_emp from device_user_map where device_sn = new.device_sn and pin = new.pin;
  if v_emp is not null then
    perform compute_attendance_for(v_emp, (new.punch_time at time zone attendance_tz())::date);
  end if;
  return null;
end $$;
drop trigger if exists raw_punches_recompute on raw_punches;
create trigger raw_punches_recompute after insert on raw_punches
  for each row execute function trg_recompute_on_punch();

create or replace function trg_recompute_on_manual()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null then
    perform compute_attendance_for(new.employee_id,
      (coalesce(new.punch_time, now()) at time zone attendance_tz())::date);
  end if;
  return null;
end $$;
drop trigger if exists manual_logs_recompute on manual_logs;
create trigger manual_logs_recompute after insert on manual_logs
  for each row execute function trg_recompute_on_manual();

create or replace function trg_recompute_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null then
    perform recompute_employee_range(new.employee_id, new.start_date, coalesce(new.end_date, new.start_date));
  end if;
  return null;
end $$;
drop trigger if exists leaves_recompute on leaves;
create trigger leaves_recompute after insert or update on leaves
  for each row execute function trg_recompute_on_leave();

-- ─── REPORT VIEWS (spec §7) ─────────────────────────────────────────────────
-- security_invoker => the caller's RLS applies, so anon sees nothing and the
-- service-role/authenticated dashboard sees the data. (Supabase best practice.)

create or replace view v_report_daily with (security_invoker = true) as
  select ad.work_date, e.id as employee_id, e.emp_code, e.first_name, e.last_name,
         d.name as department, d.brand,
         ad.first_in, ad.last_out, ad.scheduled_in, ad.scheduled_out,
         ad.worked_minutes, ad.late_minutes, ad.early_leave_minutes,
         ad.overtime_minutes, ad.break_minutes,
         ad.first_in_method, ad.last_out_method, ad.status
    from attendance_daily ad
    join employees e on e.id = ad.employee_id
    left join departments d on d.id = e.department_id;

create or replace view v_total_time_card with (security_invoker = true) as
  select ad.work_date, e.id as employee_id, e.emp_code,
         (e.first_name || ' ' || coalesce(e.last_name, '')) as employee,
         d.name as department, d.brand,
         ad.first_in, ad.last_out,
         case ad.first_in_method when 15 then 'face' when 1 then 'fingerprint' end as in_method,
         case ad.last_out_method when 15 then 'face' when 1 then 'fingerprint' end as out_method,
         ad.worked_minutes, round(ad.worked_minutes / 60.0, 2) as worked_hours,
         ad.late_minutes, ad.early_leave_minutes, ad.overtime_minutes, ad.break_minutes, ad.status
    from attendance_daily ad
    join employees e on e.id = ad.employee_id
    left join departments d on d.id = e.department_id;

create or replace view v_report_weekly with (security_invoker = true) as
  select e.id as employee_id, e.emp_code,
         (e.first_name || ' ' || coalesce(e.last_name, '')) as employee, d.name as department, d.brand,
         date_trunc('week', ad.work_date)::date as week_start,
         count(*) filter (where ad.status = 'Present')    as present_days,
         count(*) filter (where ad.status = 'Absent')     as absent_days,
         count(*) filter (where ad.status = 'Leave')      as leave_days,
         count(*) filter (where ad.status = 'Incomplete') as incomplete_days,
         sum(ad.worked_minutes) as worked_minutes, sum(ad.late_minutes) as late_minutes,
         sum(ad.overtime_minutes) as overtime_minutes
    from attendance_daily ad
    join employees e on e.id = ad.employee_id
    left join departments d on d.id = e.department_id
   group by 1, 2, 3, 4, 5, 6;

create or replace view v_report_monthly with (security_invoker = true) as
  select e.id as employee_id, e.emp_code,
         (e.first_name || ' ' || coalesce(e.last_name, '')) as employee, d.name as department, d.brand,
         to_char(ad.work_date, 'YYYY-MM') as month,
         count(*) filter (where ad.status = 'Present')    as present_days,
         count(*) filter (where ad.status = 'Absent')     as absent_days,
         count(*) filter (where ad.status = 'Leave')      as leave_days,
         count(*) filter (where ad.status = 'Incomplete') as incomplete_days,
         sum(ad.worked_minutes) as worked_minutes, sum(ad.late_minutes) as late_minutes,
         sum(ad.overtime_minutes) as overtime_minutes
    from attendance_daily ad
    join employees e on e.id = ad.employee_id
    left join departments d on d.id = e.department_id
   group by 1, 2, 3, 4, 5, 6;

create or replace view v_live_punches with (security_invoker = true) as
  select rp.id, rp.punch_time, rp.device_sn, rp.pin, rp.verify_mode,
         case rp.verify_mode when 15 then 'face' when 1 then 'fingerprint' else 'other' end as method,
         dum.employee_id, e.emp_code,
         (e.first_name || ' ' || coalesce(e.last_name, '')) as employee
    from raw_punches rp
    left join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
    left join employees e on e.id = dum.employee_id
   order by rp.punch_time desc;

create or replace view v_unknown_pins with (security_invoker = true) as
  select rp.device_sn, rp.pin, count(*) as punches,
         min(rp.punch_time) as first_seen, max(rp.punch_time) as last_seen
    from raw_punches rp
    left join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
   where dum.employee_id is null
   group by 1, 2;

create or replace view v_device_health with (security_invoker = true) as
  select sn, name, ip, firmware, last_seen, last_user_sync, last_user_sync_count,
         extract(epoch from (now() - last_seen))::int as seconds_since_seen,
         (last_seen is not null and now() - last_seen < interval '2 minutes') as online
    from devices;

grant select on v_report_daily, v_total_time_card, v_report_weekly, v_report_monthly,
                v_live_punches, v_unknown_pins, v_device_health to authenticated;

-- ─────────────────────────────────────────────────────────────
-- migrations/20260620120300_pg_cron.sql
-- ─────────────────────────────────────────────────────────────
-- Nightly recompute via pg_cron (spec §7). Guarded so it is a no-op where
-- pg_cron isn't available (e.g. local Postgres). On Supabase, enable pg_cron
-- once under Database → Extensions (or it auto-creates here if available).
--
-- Recomputes the trailing 3 days every night to absorb late manual logs / leave
-- approvals. Realtime per-punch recompute is already handled by triggers.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 19:30 UTC == 00:30 Asia/Karachi (UTC+5)
    perform cron.schedule(
      'attendance-nightly-recompute',
      '30 19 * * *',
      $cron$ select recompute_attendance_range((current_date - 2), current_date); $cron$
    );
  else
    raise notice 'pg_cron not available; skipping nightly schedule (triggers still recompute in realtime)';
  end if;
end $$;

