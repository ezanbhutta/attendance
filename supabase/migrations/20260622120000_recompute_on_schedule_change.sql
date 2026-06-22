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
