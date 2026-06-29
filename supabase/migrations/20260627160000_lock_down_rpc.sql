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
