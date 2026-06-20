-- Production seed: the real device (spec §2) and default config knobs (§7/§13.2).
-- Safe to re-run (on conflict do nothing). Employee/PIN mapping is dev-only and
-- lives in supabase/seed.sql instead.

insert into devices (sn, name, mac, ip, firmware) values
  ('NYU7253801246', 'SenseFace 2A — Main Gate', '00:17:61:12:7a:a2', '192.168.1.201', 'ZAM70-NF24HA-Ver3.3.12')
on conflict (sn) do nothing;

-- Config knobs consumed by the attendance compute (spec §7) and reporting.
insert into app_config (key, value) values
  ('timezone',                 '"Asia/Karachi"'::jsonb),   -- device-local zone (TimeZone=5)
  ('dedup_window_seconds',     '60'::jsonb),                -- collapse repeat scans within N s
  ('overtime_mode',            '"after_scheduled_end"'::jsonb),
  ('overtime_min_minutes',     '0'::jsonb),                 -- ignore OT below this many minutes
  ('absent_rule',              '"no_punch_is_absent"'::jsonb),
  ('default_late_grace_min',   '0'::jsonb),
  ('default_early_leave_grace_min', '0'::jsonb),
  ('week_start',               '1'::jsonb),                 -- 1=Monday for weekly reports
  ('global_shift_id',          'null'::jsonb)               -- fallback shift when nothing else matches
on conflict (key) do nothing;
