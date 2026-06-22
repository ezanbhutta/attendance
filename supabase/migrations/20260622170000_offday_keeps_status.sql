-- ════════════════════════════════════════════════════════════════════════════
-- (1) "Fix a punch" follows the night-shift rule, and
-- (2) a holiday / approved leave / weekly off keeps its status even when the
--     person scanned — the scans are still recorded and shown, the day just stays
--     labelled Holiday / Leave / WeeklyOff instead of flipping to Present.
--
-- So a stray tap on a day off no longer erases the leave/holiday, and the report
-- and PDF show both the scans and that the day was off.
-- ════════════════════════════════════════════════════════════════════════════

-- (1) A manual correction at, say, 02:00 belongs to the night shift that started
--     the evening before — recompute that day too, like the punch trigger does.
create or replace function trg_recompute_on_manual()
returns trigger language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if new.employee_id is not null then
    d := (coalesce(new.punch_time, now()) at time zone attendance_tz())::date;
    perform compute_attendance_for(new.employee_id, d);
    perform compute_attendance_for(new.employee_id, d - 1);
  end if;
  return null;
end $$;

-- (2) Off-day status wins over a stray scan; scans are still recorded.
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

  with src as (
    select rp.punch_time as t, rp.verify_mode::smallint as m
      from raw_punches rp
      join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
     where dum.employee_id = p_emp
       and case when (has_tt and windowed)
                then rp.punch_time >= win_lo and rp.punch_time < win_hi
                else (rp.punch_time at time zone tz)::date = p_date end
    union all
    select ml.punch_time, null::smallint
      from manual_logs ml
     where ml.employee_id = p_emp
       and case when (has_tt and windowed)
                then ml.punch_time >= win_lo and ml.punch_time < win_hi
                else (ml.punch_time at time zone tz)::date = p_date end
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
