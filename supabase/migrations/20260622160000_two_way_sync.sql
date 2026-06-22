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
