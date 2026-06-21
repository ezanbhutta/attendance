-- Push a person to the device (enroll their name, PIN and card).
-- The dashboard cannot reach the LAN device directly, so it drops a row here.
-- The catcher polls this table and sends a "DATA UPDATE USERINFO" command to the
-- device on its next poll, which sets the name, PIN and card. Face and
-- fingerprint cannot be pushed; those are enrolled at the device itself.

create table if not exists device_user_pushes (
  id           bigint generated always as identity primary key,
  device_sn    text not null,
  pin          text not null,
  name         text,
  card_no      text,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  picked_up_at timestamptz,
  done_at      timestamptz,
  error        text
);

create index if not exists device_user_pushes_pending
  on device_user_pushes (device_sn, requested_at) where done_at is null;

alter table device_user_pushes enable row level security;

-- Authenticated dashboard users may queue a push and see its progress.
drop policy if exists "auth queues push" on device_user_pushes;
create policy "auth queues push" on device_user_pushes
  for insert to authenticated with check (true);

drop policy if exists "auth reads push" on device_user_pushes;
create policy "auth reads push" on device_user_pushes
  for select to authenticated using (true);

grant select, insert on device_user_pushes to authenticated;
-- The catcher uses the service-role key (bypasses RLS) to claim + complete rows.
