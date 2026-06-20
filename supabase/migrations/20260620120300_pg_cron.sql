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
