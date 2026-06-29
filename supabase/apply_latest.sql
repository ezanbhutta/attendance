-- ════════════════════════════════════════════════════════════════════════════
-- APPLY LATEST  ·  Attendance OS
-- Paste this whole file into the Supabase SQL Editor (New query) and Run.
-- It is idempotent and safe to run more than once.
--
-- What it does:
--   • Night shifts after midnight count for the previous day (auto).
--   • Editing a timetable or shift recomputes attendance immediately.
--   • Card scans are detected as "card", not "Other".
--   • Check-out is the last scan at/after the shift end (mid-shift scans don't end
--     the day); a missing checkout closes at the shift end after the 4-hour rule.
--   • "Fix a punch" recomputes the night-shift day too.
--   • A holiday / approved leave / weekly off keeps its status even if the person
--     scanned — the scans are still recorded and shown.
--   • A holiday AND approved leave fall on a night shift's PHYSICAL day: an
--     after-midnight shift (e.g. 01:00–09:00) gets them on the work-date worked
--     that morning (a 26 Jun holiday / leave → the 25 Jun work-date).
--   • Deleting an employee queues their removal from the device.
--   • Recomputes the last 31 days at the end.
-- ════════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260622160000_two_way_sync.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Two-way sync: deleting an employee removes them from the device too.
--
-- The dashboard already pushes adds/renames to the device (device_user_pushes).
-- This adds the delete direction: when an employee is HARD-deleted, queue a
-- "remove from device" command for the catcher to send. Archiving is an UPDATE,
-- so it never triggers this — archived people stay enrolled on the scanner.
--
-- (The pull direction — the catcher applying device renames and archiving people
-- removed on the device during a Sync — lives in the catcher, not here.)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists device_user_deletes (
  id           bigint generated always as identity primary key,
  device_sn    text not null,
  pin          text not null,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  picked_up_at timestamptz,
  done_at      timestamptz,
  error        text
);

create index if not exists device_user_deletes_pending
  on device_user_deletes (device_sn, requested_at) where done_at is null;

alter table device_user_deletes enable row level security;

drop policy if exists "auth queues delete" on device_user_deletes;
create policy "auth queues delete" on device_user_deletes
  for insert to authenticated with check (true);

drop policy if exists "auth reads delete" on device_user_deletes;
create policy "auth reads delete" on device_user_deletes
  for select to authenticated using (true);

grant select, insert on device_user_deletes to authenticated;
-- The catcher uses the service-role key (bypasses RLS) to claim + complete rows.

-- When an employee is hard-deleted, queue a removal for each device/PIN they were
-- mapped to (or, if never mapped, their emp_code against every known device).
create or replace function trg_queue_device_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into device_user_deletes (device_sn, pin)
    select dum.device_sn, dum.pin from device_user_map dum where dum.employee_id = old.id;
  if not found then
    insert into device_user_deletes (device_sn, pin)
      select d.sn, old.emp_code from devices d;
  end if;
  return old;
end $$;

drop trigger if exists employees_device_delete on employees;
create trigger employees_device_delete before delete on employees
  for each row execute function trg_queue_device_delete();


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260622170000_offday_keeps_status.sql
-- ═══════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════
-- from 20260622180000_prev_day_owns_overnight_checkout.sql
-- ════════════════════════════════════════════════════════════════════════
-- scan as attendance.
--
-- Fix: before gathering a day's scans, work out a "morning cutoff" from the
-- previous day's shift. Any scan on this day earlier than that cutoff belongs to
-- the previous night and is ignored here. The previous day keeps it; today does
-- not double-count it. Days with no overnight before them are unaffected.
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

-- Re-run the last month so the past rows are corrected too ("before and after").
select recompute_attendance_range((current_date - 31), current_date);


-- ════════════════════════════════════════════════════════════════════════
-- from 20260622190000_device_user_role_password.sql
-- ════════════════════════════════════════════════════════════════════════
alter table employees add column if not exists device_privilege smallint not null default 0;
alter table employees add column if not exists device_password text;
alter table device_user_pushes add column if not exists privilege smallint;
alter table device_user_pushes add column if not exists password text;


-- ════════════════════════════════════════════════════════════════════════
-- from 20260625120000_holiday_workers.sql
-- ════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════
-- from 20260625130000_holiday_worked_checkout.sql
-- ════════════════════════════════════════════════════════════════════════
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
  v_bonus boolean := false;
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

  -- Is this a holiday volunteer who actually came in? They earn a bonus day AND
  -- their day is treated like a WORKING day for check-out (last scan at/after the
  -- shift end, or auto-closed at the shift end four hours later) — not like a plain
  -- day off. Falls back to the last scan only when they have no shift that day.
  v_bonus := (v_off = 'Holiday' and coalesce(v_cnt, 0) >= 1
              and exists (select 1 from holiday_workers hw where hw.the_date = p_date and hw.employee_id = p_emp));

  if v_off is not null and not v_bonus then
    -- Pure day off (holiday / leave / weekly off): keep the label, still record the
    -- scans so the report shows them. Simple last-scan close.
    v_status := v_off;
    if coalesce(v_cnt, 0) >= 1 then
      v_last := v_last_any; v_last_m := v_last_any_m;
      if v_cnt >= 2 then v_worked := greatest(0, floor(extract(epoch from (v_last_any - v_first)) / 60))::int; end if;
    else
      v_first := null; v_first_m := null;
    end if;
  else
    -- Working day, OR a holiday volunteer (bonus). Check-out = last scan at/after the
    -- shift end; if none yet and it is 4h past the end, close at the shift end.
    if has_tt then
      v_last := v_chk; v_last_m := v_chk_m;
      if v_last is null and v_first is not null and now() >= v_sched_out + interval '4 hours' then
        v_last := v_sched_out; v_last_m := null;
      end if;
    else
      v_last := v_last_any; v_last_m := v_last_any_m;   -- bonus worker with no shift today
    end if;

    if coalesce(v_cnt, 0) = 0 then
      v_status := 'Absent';
    else
      -- Lateness and overtime apply to ordinary working days, not bonus days.
      if not v_bonus and has_tt then
        v_late := greatest(0, ceil(extract(epoch from
                    (v_first - (v_sched_in + make_interval(mins => coalesce(v_tt.late_grace_min, 0))))) / 60))::int;
      end if;
      if v_last is not null then
        v_early := 0;
        if has_tt then
          select coalesce(sum(extract(epoch from (end_time - start_time)) / 60) filter (where auto_deduct), 0)::int
            into v_break from breaks where timetable_id = v_tt.id;
        end if;
        v_worked := greatest(0, floor(extract(epoch from (v_last - v_first)) / 60)::int - coalesce(v_break, 0));
        if not v_bonus and has_tt and ot_mode = 'after_scheduled_end' then
          v_ot := greatest(0, floor(extract(epoch from (v_last - v_sched_out)) / 60))::int;
          if v_ot < ot_min then v_ot := 0; end if;
        end if;
      end if;
      v_status := case when v_bonus then 'HolidayWorked'
                       when v_last is not null then 'Present' else 'Incomplete' end;
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


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260627120000_holiday_night_shift.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Holidays land on a night shift's PHYSICAL day, not its work-date.
--
-- A night shift that runs after midnight (e.g. CSR Night 01:00–09:00) counts for
-- the PREVIOUS day: a scan at 01:02 on the 27th is the 26th's shift, because the
-- shift_date is p_date + 1. The holiday check, though, was looking at p_date, so
-- a holiday on the 26th was being applied to the 26th work-date — but that shift
-- is physically worked on the morning of the 27th (not a holiday), while the
-- shift actually worked on the holiday morning (the 26th) is the 25th work-date.
--
-- Fix: look up the holiday (and the holiday-volunteer record) on the shift's
-- physical day — coalesce(shift_date, p_date). For day and evening shifts
-- shift_date already equals p_date, so nothing changes; only true after-midnight
-- night shifts move their holiday back by one work-date, which is correct:
--   • Holiday 26 Jun  →  night worker's 25 Jun work-date becomes Holiday /
--     HolidayWorked (that shift is worked on the holiday morning),
--   • their 26 Jun work-date (worked on the 27th) stays an ordinary day.
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
  v_hol_date date;
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
  v_bonus boolean := false;
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
  -- The calendar day this shift is physically worked: shift_date for a night
  -- shift counted on the previous day, otherwise the work-date itself.
  v_hol_date := coalesce(shift_date, p_date);

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

  -- Off-day reason, decided independently of any scans. The holiday is looked up
  -- on the shift's physical day so a night shift gets the holiday on the work-date
  -- whose shift is actually worked on the holiday.
  v_off := case
    when exists (select 1 from holidays where the_date = v_hol_date) then 'Holiday'
    when exists (select 1 from leaves where employee_id = p_emp and status = 'approved'
                   and p_date between start_date and coalesce(end_date, start_date)) then 'Leave'
    when not has_tt then 'WeeklyOff'
    else null
  end;

  -- Is this a holiday volunteer who actually came in? They earn a bonus day AND
  -- their day is treated like a WORKING day for check-out (last scan at/after the
  -- shift end, or auto-closed at the shift end four hours later) — not like a plain
  -- day off. Falls back to the last scan only when they have no shift that day.
  v_bonus := (v_off = 'Holiday' and coalesce(v_cnt, 0) >= 1
              and exists (select 1 from holiday_workers hw where hw.the_date = v_hol_date and hw.employee_id = p_emp));

  if v_off is not null and not v_bonus then
    -- Pure day off (holiday / leave / weekly off): keep the label, still record the
    -- scans so the report shows them. Simple last-scan close.
    v_status := v_off;
    if coalesce(v_cnt, 0) >= 1 then
      v_last := v_last_any; v_last_m := v_last_any_m;
      if v_cnt >= 2 then v_worked := greatest(0, floor(extract(epoch from (v_last_any - v_first)) / 60))::int; end if;
    else
      v_first := null; v_first_m := null;
    end if;
  else
    -- Working day, OR a holiday volunteer (bonus). Check-out = last scan at/after the
    -- shift end; if none yet and it is 4h past the end, close at the shift end.
    if has_tt then
      v_last := v_chk; v_last_m := v_chk_m;
      if v_last is null and v_first is not null and now() >= v_sched_out + interval '4 hours' then
        v_last := v_sched_out; v_last_m := null;
      end if;
    else
      v_last := v_last_any; v_last_m := v_last_any_m;   -- bonus worker with no shift today
    end if;

    if coalesce(v_cnt, 0) = 0 then
      v_status := 'Absent';
    else
      -- Lateness and overtime apply to ordinary working days, not bonus days.
      if not v_bonus and has_tt then
        v_late := greatest(0, ceil(extract(epoch from
                    (v_first - (v_sched_in + make_interval(mins => coalesce(v_tt.late_grace_min, 0))))) / 60))::int;
      end if;
      if v_last is not null then
        v_early := 0;
        if has_tt then
          select coalesce(sum(extract(epoch from (end_time - start_time)) / 60) filter (where auto_deduct), 0)::int
            into v_break from breaks where timetable_id = v_tt.id;
        end if;
        v_worked := greatest(0, floor(extract(epoch from (v_last - v_first)) / 60)::int - coalesce(v_break, 0));
        if not v_bonus and has_tt and ot_mode = 'after_scheduled_end' then
          v_ot := greatest(0, floor(extract(epoch from (v_last - v_sched_out)) / 60))::int;
          if v_ot < ot_min then v_ot := 0; end if;
        end if;
      end if;
      v_status := case when v_bonus then 'HolidayWorked'
                       when v_last is not null then 'Present' else 'Incomplete' end;
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


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260627130000_leave_night_shift.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Approved leave also lands on a night shift's PHYSICAL day.
--
-- The previous migration moved a night shift's HOLIDAY onto the work-date worked
-- that morning. Approved LEAVE works the same way: a night worker who takes leave
-- on the 26th is off the shift worked on the morning of the 26th, which is the
-- 25th work-date. So the leave look-up uses the shift's physical calendar day too
-- (coalesce(shift_date, p_date)) — renamed v_cal_date here since holiday, the
-- holiday-volunteer record and leave all key off the same physical day. Day and
-- evening shifts are unchanged (their shift_date already equals the work-date).
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
  v_cal_date date;   -- the calendar day this shift is physically worked
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
  v_bonus boolean := false;
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
  -- Night shift counted on the previous day → shift_date is the morning it is
  -- physically worked; otherwise the work-date itself.
  v_cal_date := coalesce(shift_date, p_date);

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

  -- Off-day reason, decided independently of any scans. Holiday AND approved leave
  -- are looked up on the shift's physical day, so a night shift gets them on the
  -- work-date whose shift is actually worked on the holiday / leave day.
  v_off := case
    when exists (select 1 from holidays where the_date = v_cal_date) then 'Holiday'
    when exists (select 1 from leaves where employee_id = p_emp and status = 'approved'
                   and v_cal_date between start_date and coalesce(end_date, start_date)) then 'Leave'
    when not has_tt then 'WeeklyOff'
    else null
  end;

  -- Is this a holiday volunteer who actually came in? They earn a bonus day AND
  -- their day is treated like a WORKING day for check-out (last scan at/after the
  -- shift end, or auto-closed at the shift end four hours later) — not like a plain
  -- day off. Falls back to the last scan only when they have no shift that day.
  v_bonus := (v_off = 'Holiday' and coalesce(v_cnt, 0) >= 1
              and exists (select 1 from holiday_workers hw where hw.the_date = v_cal_date and hw.employee_id = p_emp));

  if v_off is not null and not v_bonus then
    -- Pure day off (holiday / leave / weekly off): keep the label, still record the
    -- scans so the report shows them. Simple last-scan close.
    v_status := v_off;
    if coalesce(v_cnt, 0) >= 1 then
      v_last := v_last_any; v_last_m := v_last_any_m;
      if v_cnt >= 2 then v_worked := greatest(0, floor(extract(epoch from (v_last_any - v_first)) / 60))::int; end if;
    else
      v_first := null; v_first_m := null;
    end if;
  else
    -- Working day, OR a holiday volunteer (bonus). Check-out = last scan at/after the
    -- shift end; if none yet and it is 4h past the end, close at the shift end.
    if has_tt then
      v_last := v_chk; v_last_m := v_chk_m;
      if v_last is null and v_first is not null and now() >= v_sched_out + interval '4 hours' then
        v_last := v_sched_out; v_last_m := null;
      end if;
    else
      v_last := v_last_any; v_last_m := v_last_any_m;   -- bonus worker with no shift today
    end if;

    if coalesce(v_cnt, 0) = 0 then
      v_status := 'Absent';
    else
      -- Lateness and overtime apply to ordinary working days, not bonus days.
      if not v_bonus and has_tt then
        v_late := greatest(0, ceil(extract(epoch from
                    (v_first - (v_sched_in + make_interval(mins => coalesce(v_tt.late_grace_min, 0))))) / 60))::int;
      end if;
      if v_last is not null then
        v_early := 0;
        if has_tt then
          select coalesce(sum(extract(epoch from (end_time - start_time)) / 60) filter (where auto_deduct), 0)::int
            into v_break from breaks where timetable_id = v_tt.id;
        end if;
        v_worked := greatest(0, floor(extract(epoch from (v_last - v_first)) / 60)::int - coalesce(v_break, 0));
        if not v_bonus and has_tt and ot_mode = 'after_scheduled_end' then
          v_ot := greatest(0, floor(extract(epoch from (v_last - v_sched_out)) / 60))::int;
          if v_ot < ot_min then v_ot := 0; end if;
        end if;
      end if;
      v_status := case when v_bonus then 'HolidayWorked'
                       when v_last is not null then 'Present' else 'Incomplete' end;
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


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260627140000_leave_paid_flag.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Paid / unpaid leave (HR's choice — no salary is calculated).
--
-- When HR adds a leave they pick Paid or Unpaid; the system only records that
-- choice so it shows in the report. It does NOT compute any pay. Existing leaves
-- whose type was 'unpaid' are marked unpaid; everything else defaults to paid.
-- ════════════════════════════════════════════════════════════════════════════

alter table leaves add column if not exists paid boolean not null default true;
update leaves set paid = false where leave_type = 'unpaid';


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260627150000_half_days.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Half days (recorded by HR — no salary is calculated).
--
-- HR marks that a person was away for PART of a working day: the date and the
-- absent window (from_time → to_time), a reason, and whether it is Paid or
-- Unpaid. The day stays Present but is also flagged a Half Day, and the report
-- shows the worked hours reduced by the absent window. The system only records
-- this; it computes no pay.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists half_days (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  the_date    date   not null,
  from_time   time   not null,
  to_time     time   not null,
  reason      text,
  paid        boolean not null default false,
  created_at  timestamptz default now()
);
create index if not exists half_days_emp_date on half_days (employee_id, the_date);
alter table half_days enable row level security;
drop policy if exists "auth manages half days" on half_days;
create policy "auth manages half days" on half_days
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on half_days to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- from 20260627160000_lock_down_rpc.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Lock down the SECURITY DEFINER compute functions (security hardening).
--
-- Postgres grants EXECUTE on every new function to PUBLIC, which includes the
-- Supabase `anon` and `authenticated` roles — so these SECURITY DEFINER
-- functions were callable over PostgREST (POST /rest/v1/rpc/<fn>) by anyone with
-- the public anon key, bypassing RLS to overwrite attendance_daily and pin the
-- DB (a no-login DoS + integrity attack on payroll inputs).
--
-- The dashboard never calls these RPCs (it only reads views/tables). Only the
-- listener (service_role) and the internal triggers/cron need them — and the
-- triggers run with the definer's rights regardless of these grants. So we
-- revoke EXECUTE from public/anon/authenticated and grant it back only to
-- service_role on the entry points the listener invokes.
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function
  compute_attendance_for(bigint, date),
  resolve_shift_id(bigint, date),
  recompute_attendance_for_date(date),
  recompute_employee_range(bigint, date, date),
  recompute_attendance_range(date, date),
  attendance_config_text(text, text),
  attendance_config_int(text, int),
  attendance_tz()
from public, anon, authenticated;

grant execute on function
  compute_attendance_for(bigint, date),
  recompute_attendance_for_date(date),
  recompute_employee_range(bigint, date, date),
  recompute_attendance_range(date, date)
to service_role;

-- Future functions in public should not be world-executable by default either.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Sanity check (not enforced): list the SECURITY DEFINER functions and their ACLs.
-- select proname, proacl from pg_proc where pronamespace = 'public'::regnamespace and prosecdef;
