-- ════════════════════════════════════════════════════════════════════════════
-- Holiday work exceptions (bonus day).
--
-- A holiday is a paid day off for everyone. Some people volunteer to work it for
-- a one-day salary bonus. Add them to holiday_workers for that date; when such a
-- person scans on the holiday, their day is marked 'HolidayWorked' (worked, bonus-
-- eligible) instead of plain 'Holiday', so the report and the PDF show and count
-- the bonus. The bonus pay itself is counted by you — the system only marks it.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists holiday_workers (
  the_date    date   not null,
  employee_id bigint not null references employees(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (the_date, employee_id)
);
alter table holiday_workers enable row level security;
drop policy if exists "auth manages holiday workers" on holiday_workers;
create policy "auth manages holiday workers" on holiday_workers
  for all to authenticated using (true) with check (true);
grant select, insert, delete on holiday_workers to authenticated;

create or replace function compute_attendance_for(p_emp bigint, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  tz       text := attendance_tz();
  dedup_s  int  := attendance_config_int('dedup_window_seconds', 60);
  ot_mode  text := attendance_config_text('overtime_mode', 'after_scheduled_end');
  ot_min   int  := attendance_config_int('overtime_min_minutes', 0);
  v_track  boolean; v_weekoff int;
  v_shift  bigint;
  v_tt     timetables%rowtype;
  has_tt   boolean := false;
  overnight boolean := false;
  nextday  boolean := false;
  windowed boolean := false;
  shift_date date;
  -- previous-day shift, used only to find the morning cutoff for p_date
  v_pshift  bigint;
  v_ptt     timetables%rowtype;
  p_overnight boolean;
  p_nextday   boolean;
  p_sched_out timestamptz;
  v_prev_cutoff timestamptz;
  v_cnt    int;
  v_first  timestamptz; v_last timestamptz;
  v_first_m smallint;   v_last_m smallint;
  v_last_any timestamptz; v_last_any_m smallint;
  v_chk timestamptz;      v_chk_m smallint;
  v_sched_in timestamptz; v_sched_out timestamptz;
  win_lo   timestamptz; win_hi timestamptz;
  v_late int := 0; v_early int := 0; v_ot int := 0; v_worked int := 0; v_break int := 0;
  v_off    text;
  v_status text;
begin
  select track_attendance, weekly_off into v_track, v_weekoff from employees where id = p_emp;
  if not coalesce(v_track, true) then
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
  if v_weekoff is not null and extract(dow from p_date)::int = v_weekoff then
    has_tt := false;
  end if;

  if has_tt then
    overnight := v_tt.is_overnight or v_tt.check_out <= v_tt.check_in;
    nextday   := (not overnight) and (coalesce(v_tt.next_day, false) or v_tt.check_in < time '06:00');
    shift_date := p_date + (case when nextday then 1 else 0 end);
    v_sched_in  := ((shift_date + v_tt.check_in)::timestamp) at time zone tz;
    v_sched_out := ((shift_date + v_tt.check_out + (case when overnight then interval '1 day' else interval '0' end))::timestamp) at time zone tz;
    windowed := overnight or nextday;
    if windowed then
      win_lo := v_sched_in  - interval '4 hours';
      win_hi := v_sched_out + interval '4 hours';
    end if;
  end if;

  -- Morning cutoff: if the PREVIOUS day ran a shift across midnight, its checkout
  -- window reaches into this morning. Default is the start of p_date (no cutoff).
  -- Skipped when the previous day was the person's weekly off (they did not work).
  v_prev_cutoff := (p_date::timestamp) at time zone tz;
  if v_weekoff is null or extract(dow from (p_date - 1))::int <> v_weekoff then
    v_pshift := resolve_shift_id(p_emp, p_date - 1);
    if v_pshift is not null then
      select t.* into v_ptt
        from shift_details sd join timetables t on t.id = sd.timetable_id
        where sd.shift_id = v_pshift and sd.day_index = extract(dow from (p_date - 1))::int
        limit 1;
      if found then
        p_overnight := v_ptt.is_overnight or v_ptt.check_out <= v_ptt.check_in;
        p_nextday   := (not p_overnight) and (coalesce(v_ptt.next_day, false) or v_ptt.check_in < time '06:00');
        if p_overnight or p_nextday then
          p_sched_out := (((p_date - 1) + (case when p_nextday then 1 else 0 end)
                            + v_ptt.check_out
                            + (case when p_overnight then interval '1 day' else interval '0' end))::timestamp) at time zone tz;
          v_prev_cutoff := greatest(v_prev_cutoff, p_sched_out + interval '4 hours');
        end if;
      end if;
    end if;
  end if;

  with src as (
    select rp.punch_time as t, rp.verify_mode::smallint as m
      from raw_punches rp
      join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
     where dum.employee_id = p_emp
       and case when (has_tt and windowed)
                then rp.punch_time >= win_lo and rp.punch_time < win_hi
                else (rp.punch_time at time zone tz)::date = p_date and rp.punch_time >= v_prev_cutoff end
    union all
    select ml.punch_time, null::smallint
      from manual_logs ml
     where ml.employee_id = p_emp
       and case when (has_tt and windowed)
                then ml.punch_time >= win_lo and ml.punch_time < win_hi
                else (ml.punch_time at time zone tz)::date = p_date and ml.punch_time >= v_prev_cutoff end
  ),
  ordered as (select t, m, lag(t) over (order by t) as prev from src),
  deduped as (select t, m from ordered where prev is null or t - prev > make_interval(secs => dedup_s))
  select count(*),
         min(t),
         (array_agg(m order by t))[1],
         max(t),
         (array_agg(m order by t desc))[1],
         max(t) filter (where t >= v_sched_out),
         (array_agg(m order by t desc) filter (where t >= v_sched_out))[1]
    into v_cnt, v_first, v_first_m, v_last_any, v_last_any_m, v_chk, v_chk_m
    from deduped;

  -- Off-day reason, decided independently of any scans.
  v_off := case
    when exists (select 1 from holidays where the_date = p_date) then 'Holiday'
    when exists (select 1 from leaves where employee_id = p_emp and status = 'approved'
                   and p_date between start_date and coalesce(end_date, start_date)) then 'Leave'
    when not has_tt then 'WeeklyOff'
    else null
  end;

  if v_off is not null then
    -- Day off: keep the off label; still record the scans so the report shows them.
    v_status := v_off;
    if coalesce(v_cnt, 0) >= 1 then
      v_last := v_last_any; v_last_m := v_last_any_m;
      if v_cnt >= 2 then v_worked := greatest(0, floor(extract(epoch from (v_last_any - v_first)) / 60))::int; end if;
      -- A holiday volunteer who actually came in earns a worked-holiday (bonus)
      -- status, so reports and the PDF can show and count the bonus day.
      if v_off = 'Holiday' and exists (select 1 from holiday_workers hw
                                         where hw.the_date = p_date and hw.employee_id = p_emp) then
        v_status := 'HolidayWorked';
      end if;
    else
      v_first := null; v_first_m := null;
    end if;
    -- no late / early / overtime on a day off (stay 0)
  else
    -- Working day (a timetable applies). Check-out = last scan at/after the end.
    v_last := v_chk; v_last_m := v_chk_m;
    if v_last is null and v_first is not null and now() >= v_sched_out + interval '4 hours' then
      v_last := v_sched_out; v_last_m := null;
    end if;

    if coalesce(v_cnt, 0) = 0 then
      v_status := 'Absent';
    else
      v_late := greatest(0, ceil(extract(epoch from
                  (v_first - (v_sched_in + make_interval(mins => coalesce(v_tt.late_grace_min, 0))))) / 60))::int;
      if v_last is not null then
        v_early := 0;
        select coalesce(sum(extract(epoch from (end_time - start_time)) / 60) filter (where auto_deduct), 0)::int
          into v_break from breaks where timetable_id = v_tt.id;
        v_worked := greatest(0, floor(extract(epoch from (v_last - v_first)) / 60)::int - v_break);
        if ot_mode = 'after_scheduled_end' then
          v_ot := greatest(0, floor(extract(epoch from (v_last - v_sched_out)) / 60))::int;
          if v_ot < ot_min then v_ot := 0; end if;
        end if;
      end if;
      v_status := case when v_last is not null then 'Present' else 'Incomplete' end;
    end if;
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

select recompute_attendance_range((current_date - 31), current_date);
