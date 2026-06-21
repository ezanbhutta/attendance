-- Device user-sync + make employees deletable.

-- 1) Remember when we last pulled the user list from the device (shown in the
--    dashboard as "Last synced").
alter table devices add column if not exists last_user_sync       timestamptz;
alter table devices add column if not exists last_user_sync_count int;

-- 2) Deleting an employee was blocked by foreign keys (e.g. attendance_daily).
--    Make everything that BELONGS to an employee delete with them.
alter table attendance_daily    drop constraint if exists attendance_daily_employee_id_fkey;
alter table attendance_daily    add  constraint attendance_daily_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

alter table device_user_map     drop constraint if exists device_user_map_employee_id_fkey;
alter table device_user_map     add  constraint device_user_map_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

alter table manual_logs         drop constraint if exists manual_logs_employee_id_fkey;
alter table manual_logs         add  constraint manual_logs_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

alter table leaves              drop constraint if exists leaves_employee_id_fkey;
alter table leaves              add  constraint leaves_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

alter table employee_schedules  drop constraint if exists employee_schedules_employee_id_fkey;
alter table employee_schedules  add  constraint employee_schedules_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

alter table temporary_schedules drop constraint if exists temporary_schedules_employee_id_fkey;
alter table temporary_schedules add  constraint temporary_schedules_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

-- 3) Surface the last user-sync time in the device-health view. Drop first:
--    CREATE OR REPLACE VIEW can't insert columns mid-list on an existing view.
drop view if exists v_device_health;
create view v_device_health with (security_invoker = true) as
  select sn, name, ip, firmware, last_seen, last_user_sync, last_user_sync_count,
         extract(epoch from (now() - last_seen))::int as seconds_since_seen,
         (last_seen is not null and now() - last_seen < interval '2 minutes') as online
    from devices;
grant select on v_device_health to authenticated;
