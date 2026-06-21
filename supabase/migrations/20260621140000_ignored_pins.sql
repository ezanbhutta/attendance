-- Let HR mark a device PIN as "not a real user" (test scans, removed staff,
-- admin enrolments) so it stops appearing in the unlinked-PINs warning.
-- v_unknown_pins now excludes ignored PINs.

create table if not exists ignored_pins (
  device_sn  text not null,
  pin        text not null,
  reason     text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (device_sn, pin)
);

alter table ignored_pins enable row level security;

drop policy if exists "auth manages ignored pins" on ignored_pins;
create policy "auth manages ignored pins" on ignored_pins
  for all to authenticated using (true) with check (true);

grant select, insert, delete on ignored_pins to authenticated;

create or replace view v_unknown_pins with (security_invoker = true) as
  select rp.device_sn, rp.pin, count(*) as punches,
         min(rp.punch_time) as first_seen, max(rp.punch_time) as last_seen
    from raw_punches rp
    left join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
   where dum.employee_id is null
     and not exists (select 1 from ignored_pins ip where ip.device_sn = rp.device_sn and ip.pin = rp.pin)
   group by 1, 2;

grant select on v_unknown_pins to authenticated;
