-- Dev/test seed (runs on `supabase db reset`, NOT in production migrations).
-- Creates one test employee mapped to device PIN 2 (the spec's test user) plus a
-- standard 09:00–18:00 shift with a lunch break, so attendance computes end-to-end.
-- Idempotent: bails if the test employee already exists.
do $$
declare dep_id bigint; grp_id bigint; emp_id bigint; tt_id bigint; sh_id bigint;
begin
  if exists (select 1 from employees where emp_code = 'EMP001') then
    raise notice 'seed already applied (EMP001 exists); skipping';
    return;
  end if;

  insert into departments (name, brand) values ('Head Office', 'Default') returning id into dep_id;
  insert into groups (name) values ('General') returning id into grp_id;

  insert into employees (emp_code, first_name, last_name, department_id, group_id, hire_date)
    values ('EMP001', 'Test', 'User', dep_id, grp_id, date '2026-01-01')
    returning id into emp_id;

  -- Device PIN 2 -> this employee (spec §13.2: "PIN 2 is the test user").
  insert into device_user_map (device_sn, pin, employee_id)
    values ('NYU7253801246', '2', emp_id)
    on conflict (device_sn, pin) do update set employee_id = excluded.employee_id;

  insert into timetables (name, check_in, check_out, work_minutes, late_grace_min, early_leave_grace_min)
    values ('General 09:00–18:00', '09:00', '18:00', 540, 10, 10) returning id into tt_id;

  insert into breaks (timetable_id, start_time, end_time, paid, auto_deduct)
    values (tt_id, '13:00', '14:00', false, true);

  insert into shifts (name) values ('General') returning id into sh_id;
  -- Same timetable every weekday (0=Sun .. 6=Sat); drop 0/6 rows for a 5-day week.
  insert into shift_details (shift_id, timetable_id, day_index)
    select sh_id, tt_id, gs from generate_series(0, 6) gs;

  insert into employee_schedules (employee_id, shift_id, start_date)
    values (emp_id, sh_id, date '2026-01-01');

  raise notice 'seed applied: EMP001 mapped to PIN 2 on General shift';
end $$;
