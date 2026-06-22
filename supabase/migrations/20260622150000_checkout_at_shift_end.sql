-- ════════════════════════════════════════════════════════════════════════════
-- Check-out = the last scan at or after the shift end.
--
-- People step out and back in during a shift (lunch, errands). Those mid-shift
-- scans are recorded, but they must NOT be treated as the check-out. The check-
-- out is the last scan at or after the shift's end time. So:
--   • Stepped out and came back, then left after the end  → check-out = that last
--     scan (overtime still counts if it is past the end).
--   • No scan at/after the end (left early, or the end scan was missed) → there is
--     no valid check-out. They stay "Still in" until four hours past the end, then
--     the shift is closed at the shift end time (the existing 4-hour rule).
--
-- Note: because the check-out is always at/after the end, early-leave minutes are
-- no longer recorded — an early departure is credited to the shift end instead.
-- ════════════════════════════════════════════════════════════════════════════

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
  v_last_any timestamptz; v_last_any_m smallint;   -- last scan of the day (for a day off)
  v_chk timestamptz;      v_chk_m smallint;        -- last scan at/after the shift end
  v_sched_in timestamptz; v_sched_out timestamptz;
  win_lo   timestamptz; win_hi timestamptz;
  v_late int := 0; v_early int := 0; v_ot int := 0; v_worked int := 0; v_break int := 0;
  v_status text;
begin
  -- Gate only people (CEO / Admin / Security) are never counted or reported.
  select track_attendance, weekly_off into v_track, v_weekoff from employees where id = p_emp;
  if not coalesce(v_track, true) then
    delete from attendance_daily where employee_id = p_emp and work_date = p_date;
    return;
  end if;

  -- 1) Resolve the timetable for this shift-day.
  v_shift := resolve_shift_id(p_emp, p_date);
  if v_shift is not null then
    select t.* into v_tt
      from shift_details sd join timetables t on t.id = sd.timetable_id
      where sd.shift_id = v_shift and sd.day_index = extract(dow from p_date)::int
      limit 1;
    has_tt := found;
  end if;

  -- Weekly off day: no expected hours.
  if v_weekoff is not null and extract(dow from p_date)::int = v_weekoff then
    has_tt := false;
  end if;

  -- 2) Resolve the scheduled window (overnight + next-day handling).
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

  -- Check-out: the last scan at or after the shift end (mid-shift scans never
  -- count). With no timetable (worked on a day off) the last scan is used.
  if has_tt then v_last := v_chk; v_last_m := v_chk_m;
  else v_last := v_last_any; v_last_m := v_last_any_m; end if;

  -- No scan at/after the shift end. Once the shift ended more than four hours ago,
  -- consider them off at the shift end time (missing checkout, or left early).
  if has_tt and v_last is null and v_first is not null and now() >= v_sched_out + interval '4 hours' then
    v_last := v_sched_out; v_last_m := null;
  end if;

  -- 3) Status + metrics.
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
      if v_last is not null then
        v_early := 0;   -- a valid check-out is always at or after the shift end
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
    v_status := case
      when has_tt then (case when v_last is not null then 'Present' else 'Incomplete' end)
      else (case when v_cnt >= 2 then 'Present' else 'Incomplete' end)
    end;
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

-- Apply the new check-out rule to the recent window.
select recompute_attendance_range((current_date - 31), current_date);
