-- ════════════════════════════════════════════════════════════════════════════
-- Your simple structure: per-employee shift + "gate-only" flag, your real
-- departments and shifts, and your named people matched in by name.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Two columns on employees:
--    shift_id          — the one shift this person works (the simple model;
--                        no more multi-level schedules to think about)
--    track_attendance  — false = "gate-only": scans open the gate but are never
--                        counted (your CEO / Ezan / Zubair)
alter table employees add column if not exists shift_id bigint references shifts(id) on delete set null;
alter table employees add column if not exists track_attendance boolean not null default true;

-- 2) Your departments (skips any that already exist).
insert into departments (name)
  select x from unnest(array['CEO','Admin','Project Manager','Human Resource','CSR']) as x
  where not exists (select 1 from departments d where d.name = x);

-- 3) Your shifts, each with a 15-minute check-in grace, applied to every day.
--    (CSR Evening runs past midnight, so it's flagged overnight.)
do $$
declare
  r record; v_tt bigint; v_shift bigint; d int;
  defs jsonb := '[
    {"name":"Office 9-5",  "in":"09:00", "out":"17:00", "overnight":false},
    {"name":"HR 11-7",     "in":"11:00", "out":"19:00", "overnight":false},
    {"name":"CSR Morning", "in":"09:00", "out":"17:00", "overnight":false},
    {"name":"CSR Evening", "in":"17:00", "out":"01:00", "overnight":true},
    {"name":"CSR Night",   "in":"01:00", "out":"09:00", "overnight":false}
  ]';
begin
  for r in select value as j from jsonb_array_elements(defs) loop
    if exists (select 1 from shifts where name = (r.j->>'name')) then continue; end if;
    insert into timetables (name, check_in, check_out, late_grace_min, early_leave_grace_min, is_overnight)
      values (r.j->>'name', (r.j->>'in')::time, (r.j->>'out')::time, 15, 15, (r.j->>'overnight')::boolean)
      returning id into v_tt;
    insert into shifts (name) values (r.j->>'name') returning id into v_shift;
    for d in 0..6 loop
      insert into shift_details (shift_id, timetable_id, day_index) values (v_shift, v_tt, d);
    end loop;
  end loop;
end $$;

-- 4) Match your named people into the system by name (spelling-tolerant), and
--    set their department, shift, and whether they're counted.
--    (Your CEO has no name on the device, so set that one in the dashboard.)
update employees set track_attendance = false, shift_id = null,
  department_id = (select id from departments where name = 'Admin')
  where (first_name || ' ' || coalesce(last_name,'')) ilike '%ezan%'
     or (first_name || ' ' || coalesce(last_name,'')) ilike '%zubair%'
     or (first_name || ' ' || coalesce(last_name,'')) ilike '%zubear%';

update employees set track_attendance = true,
  department_id = (select id from departments where name = 'Project Manager'),
  shift_id      = (select id from shifts where name = 'Office 9-5')
  where (first_name || ' ' || coalesce(last_name,'')) ilike '%zainab%'
     or (first_name || ' ' || coalesce(last_name,'')) ilike '%zenab%';

update employees set track_attendance = true,
  department_id = (select id from departments where name = 'Human Resource'),
  shift_id      = (select id from shifts where name = 'HR 11-7')
  where (first_name || ' ' || coalesce(last_name,'')) ilike '%urooj%'
     or (first_name || ' ' || coalesce(last_name,'')) ilike '%uroj%';

-- 5) Shift resolution now starts with the employee's own shift (the simple
--    model). Older schedule tables remain as fallbacks but you won't need them.
create or replace function resolve_shift_id(p_emp bigint, p_date date)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare v bigint; v_group bigint; v_dept bigint;
begin
  select shift_id into v from employees where id = p_emp;          -- direct (simple model)
  if v is not null then return v; end if;

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

-- 6) The compute now skips "gate-only" people entirely — they're never marked
--    late/absent and never appear in attendance reports (their scans still open
--    the gate and are stored).
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
  -- gate-only (CEO / Admin): never counted. Remove any stale row and stop.
  if not coalesce((select track_attendance from employees where id = p_emp), true) then
    delete from attendance_daily where employee_id = p_emp and work_date = p_date;
    return;
  end if;

  v_shift := resolve_shift_id(p_emp, p_date);
  if v_shift is not null then
    select t.* into v_tt
      from shift_details sd join timetables t on t.id = sd.timetable_id
      where sd.shift_id = v_shift and sd.day_index = extract(dow from p_date)::int
      limit 1;
    has_tt := found;
  end if;

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
      v_worked := floor(extract(epoch from (v_last - v_first)) / 60)::int;
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

-- 7) Apply the new shifts/flags to the punches already collected (last 2 days).
select recompute_attendance_range((current_date - 1), current_date);
