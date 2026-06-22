-- ════════════════════════════════════════════════════════════════════════════
-- CHECK DB  ·  Attendance OS
-- Paste into Supabase → SQL Editor → New query → Run.
-- Read-only. Returns one row per feature with ✅ present or ❌ MISSING.
-- Missing rows sort to the top. If everything is ✅, nothing is missing.
-- ════════════════════════════════════════════════════════════════════════════
with checks(feature, ok) as (
  values
  ('base · raw_punches table',              (to_regclass('public.raw_punches')        is not null)),
  ('base · devices table',                  (to_regclass('public.devices')            is not null)),
  ('base · compute_attendance_for()',       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='compute_attendance_for')),
  ('base · v_report_daily',                 (to_regclass('public.v_report_daily')     is not null)),
  ('base · v_device_health',                (to_regclass('public.v_device_health')    is not null)),
  ('base · v_live_punches',                 (to_regclass('public.v_live_punches')     is not null)),
  ('methods · v_employee_methods',          (to_regclass('public.v_employee_methods') is not null)),
  ('simple_structure · employees.shift_id',        exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees'  and column_name='shift_id')),
  ('simple_structure · employees.track_attendance',exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees'  and column_name='track_attendance')),
  ('weekly_off · employees.weekly_off',     exists(select 1 from information_schema.columns where table_schema='public' and table_name='employees'  and column_name='weekly_off')),
  ('deletes · devices.last_user_sync',      exists(select 1 from information_schema.columns where table_schema='public' and table_name='devices'    and column_name='last_user_sync')),
  ('night · timetables.is_overnight',       exists(select 1 from information_schema.columns where table_schema='public' and table_name='timetables' and column_name='is_overnight')),
  ('next_day · timetables.next_day',        exists(select 1 from information_schema.columns where table_schema='public' and table_name='timetables' and column_name='next_day')),
  ('sync · device_sync_requests table',     (to_regclass('public.device_sync_requests') is not null)),
  ('ignored_pins table',                    (to_regclass('public.ignored_pins')         is not null)),
  ('pushes · device_user_pushes table',     (to_regclass('public.device_user_pushes')   is not null)),
  ('recompute-on-edit trigger',             exists(select 1 from pg_trigger where not tgisinternal and tgname in ('timetables_recompute','shift_details_recompute'))),
  ('FIX · card detected (not "Other")',     exists(select 1 from pg_views where schemaname='public' and viewname='v_live_punches' and definition like '%''card''%')),
  ('FIX · night counts for previous day',   exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='compute_attendance_for' and pg_get_functiondef(p.oid) like '%06:00%'))
)
select case when ok then '✅' else '❌ MISSING' end as status, feature
from checks
order by ok asc, feature;
