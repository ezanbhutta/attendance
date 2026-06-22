-- ════════════════════════════════════════════════════════════════════════════
-- APPLY LATEST  ·  Attendance OS
-- Paste this whole file into the Supabase SQL Editor (New query) and Run.
-- It is idempotent and safe to run more than once.
--
-- What it does:
--   • Night shifts that start after midnight (e.g. 01:00 to 09:00) count for the
--     PREVIOUS day, automatically from the hours. Clears the false night absences.
--   • Editing a timetable or shift recomputes attendance immediately.
--   • Card scans are detected as "card" instead of "Other".
--   • Check-out is the last scan at or after the shift end; mid-shift in/out scans
--     no longer end the shift, and a missing checkout closes at the shift end after
--     the 4-hour rule.
--   • Recomputes the last 31 days at the end so everything reflects the new rules.
-- ════════════════════════════════════════════════════════════════════════════

-- Column guards: make sure the fields the compute relies on exist.
alter table timetables add column if not exists next_day     boolean not null default false;
alter table timetables add column if not exists is_overnight boolean not null default false;
alter table employees  add column if not exists weekly_off   int;


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260621190000_next_day_night_shift.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Night shift that counts toward the PREVIOUS day.
--
-- Some night shifts run wholly after midnight, for example 01:00 to 09:00, yet
-- the business counts them under the day before (a "Saturday night shift" that
-- physically happens Sunday 01:00 to 09:00 belongs to Saturday). Because such a
-- shift does not cross midnight, the overnight rule does not apply to it.
--
-- This adds a per-timetable flag, next_day. When set, the timetable's clock
-- hours are read on (work_date + 1), and the punches for that morning are filed
-- under work_date. So a Saturday row with a next_day 01:00 to 09:00 timetable is
-- scheduled for Sunday 01:00 to 09:00, collects those Sunday scans, and stores
-- them under Saturday. Nobody is marked absent until Sunday 01:00 arrives, and
-- auto checkout still works off the Sunday 09:00 end.
--
-- This function is the full, current version: gate only skip, weekly off, worked
-- on a day off, the overnight window, and now next_day, all in one.
-- ════════════════════════════════════════════════════════════════════════════

alter table timetables add column if not exists next_day boolean not null default false;

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

  -- Weekly off day: no expected hours. A scan still records as a worked day.
  if v_weekoff is not null and extract(dow from p_date)::int = v_weekoff then
    has_tt := false;
  end if;

  -- 2) Resolve the scheduled window. overnight = crosses midnight from an evening
  --    start. next_day = the clock hours are the following morning, but the day
  --    counts as p_date (a night shift logged to the previous day). Either way we
  --    gather punches by time window so the right scans are attributed here.
  if has_tt then
    overnight := v_tt.is_overnight or v_tt.check_out <= v_tt.check_in;
    nextday   := coalesce(v_tt.next_day, false);
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
  select count(*), min(t), max(t),
         (array_agg(m order by t))[1], (array_agg(m order by t desc))[1]
    into v_cnt, v_first, v_last, v_first_m, v_last_m
    from deduped;

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

-- A scan only ever belongs to its own day or the day before it: an overnight
-- evening shift and a next_day morning shift both file their after-midnight
-- scans onto the previous day. So recompute p_date and p_date-1.
create or replace function trg_recompute_on_punch()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp bigint; d date;
begin
  select employee_id into v_emp from device_user_map where device_sn = new.device_sn and pin = new.pin;
  if v_emp is not null then
    d := (new.punch_time at time zone attendance_tz())::date;
    perform compute_attendance_for(v_emp, d);
    perform compute_attendance_for(v_emp, d - 1);
  end if;
  return null;
end $$;

-- Repair recent days so the new rule shows right away.
select recompute_attendance_range((current_date - 31), current_date);


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260622120000_recompute_on_schedule_change.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Make timetable and shift edits take effect immediately.
--
-- Punches, manual logs, leaves and employee edits (e.g. weekly off) already
-- recompute attendance through triggers. But editing a TIMETABLE (hours, grace,
-- or the next_day "counts for previous day" flag) or remapping a SHIFT to a
-- different timetable did NOT recompute the days already stored. So a change
-- like turning on "counts for previous day" only showed up after the nightly
-- job — the day kept its old answer (e.g. a night-shift person stayed Absent for
-- today even though their shift now belongs to the next morning).
--
-- These statement-level triggers close that gap: any change to a timetable or to
-- a shift's weekday mapping recomputes the recent window for everyone, so the new
-- rule is reflected at once. Statement-level (not per row) keeps a bulk edit —
-- e.g. writing all seven weekdays of a shift — to a single recompute.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function trg_recompute_on_schedule_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_attendance_range((current_date - 31), current_date);
  return null;
end $$;

drop trigger if exists timetables_recompute on timetables;
create trigger timetables_recompute after insert or update or delete on timetables
  for each statement execute function trg_recompute_on_schedule_change();

drop trigger if exists shift_details_recompute on shift_details;
create trigger shift_details_recompute after insert or update or delete on shift_details
  for each statement execute function trg_recompute_on_schedule_change();

-- Re-apply current rules to the recent window now (fixes already-stored days).
select recompute_attendance_range((current_date - 31), current_date);


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260622130000_auto_previous_day_night_shift.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Auto-detect "counts for the previous day" from the clock, no manual flag.
--
-- A shift that starts after midnight and runs to later that same morning (e.g.
-- 01:00 to 09:00) is a night shift that belongs to the day before. The hours say
-- so, so the system should not need a per-timetable toggle. We now derive it:
--
--   night-that-counts-for-previous-day  :=  not overnight
--                                           and check_out > check_in       (does not cross midnight)
--                                           and check_in < 06:00           (starts in the small hours)
--
-- "overnight" (an evening shift that crosses midnight, e.g. 17:00 to 01:00) is
-- already detected from check_out <= check_in and is unchanged. The two are now
-- mutually exclusive, which also fixes a latent double-day-shift case.
--
-- The legacy next_day column is still honoured as an explicit override (OR'd in)
-- for any odd early shift that should NOT count for the previous day handling via
-- data, but the dashboard no longer shows a toggle — the hours decide.
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

  -- Weekly off day: no expected hours. A scan still records as a worked day.
  if v_weekoff is not null and extract(dow from p_date)::int = v_weekoff then
    has_tt := false;
  end if;

  -- 2) Resolve the scheduled window. overnight = crosses midnight from an evening
  --    start. next-day = wholly after midnight and counts under the previous day,
  --    now derived from the hours (start before 06:00) rather than a manual flag.
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
  select count(*), min(t), max(t),
         (array_agg(m order by t))[1], (array_agg(m order by t desc))[1]
    into v_cnt, v_first, v_last, v_first_m, v_last_m
    from deduped;

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

-- Apply the new rule to the recent window now.
select recompute_attendance_range((current_date - 31), current_date);


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260622140000_card_method_detection.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Detect card scans instead of labelling them "Other".
--
-- The device's confirmed verify_mode values are 15 = face and 1 = fingerprint.
-- Its third method is the RF/NFC card, which arrives with a different verify_mode
-- (and the ATTLOG feed carries no card number, so card_no is usually null). The
-- live feed previously mapped anything that wasn't face or fingerprint to
-- "other", so every card entry showed as Other. Since this device only offers
-- face, fingerprint and card, treat a successful scan that is neither face nor
-- fingerprint (or that carries a card number) as a card.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view v_live_punches with (security_invoker = true) as
  select rp.id, rp.punch_time, rp.device_sn, rp.pin, rp.verify_mode,
         case when rp.verify_mode = 15 then 'face'
              when rp.verify_mode = 1  then 'fingerprint'
              when rp.verify_mode is null and rp.card_no is null then 'other'
              else 'card' end as method,
         dum.employee_id, e.emp_code,
         (e.first_name || ' ' || coalesce(e.last_name, '')) as employee
    from raw_punches rp
    left join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
    left join employees e on e.id = dum.employee_id
   order by rp.punch_time desc;

-- Mirror the same rule on the per-employee methods so the Employees page shows a
-- Card badge for anyone who has scanned with a card, not only when a card number
-- happened to be captured.
create or replace view v_employee_methods with (security_invoker = true) as
  select dum.employee_id,
         bool_or(rp.verify_mode = 15) as has_face,
         bool_or(rp.verify_mode = 1)  as has_finger,
         bool_or(rp.card_no is not null
                 or (rp.verify_mode is not null and rp.verify_mode not in (1, 15))) as has_card,
         (array_agg(rp.card_no order by rp.punch_time desc) filter (where rp.card_no is not null))[1] as card_no
    from device_user_map dum
    join raw_punches rp on rp.device_sn = dum.device_sn and rp.pin = dum.pin
   group by dum.employee_id;

grant select on v_employee_methods to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260622150000_checkout_at_shift_end.sql
-- ═══════════════════════════════════════════════════════════════════════════
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
