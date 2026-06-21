-- Web "Sync" button → the always-on Mac catcher.
-- The dashboard can't reach the LAN device directly, so it drops a request row
-- here; the catcher polls this table, re-pulls ATTLOG/USERINFO from the device,
-- and stamps the row done. HR gets a one-click re-sync with nothing to install.

create table if not exists device_sync_requests (
  id           bigint generated always as identity primary key,
  device_sn    text not null,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  picked_up_at timestamptz,
  done_at      timestamptz,
  pulled       int,
  error        text
);

create index if not exists device_sync_requests_pending
  on device_sync_requests (device_sn, requested_at) where done_at is null;

alter table device_sync_requests enable row level security;

-- Authenticated dashboard users may request a sync and see its progress.
drop policy if exists "auth requests sync" on device_sync_requests;
create policy "auth requests sync" on device_sync_requests
  for insert to authenticated with check (true);

drop policy if exists "auth reads sync" on device_sync_requests;
create policy "auth reads sync" on device_sync_requests
  for select to authenticated using (true);

grant select, insert on device_sync_requests to authenticated;
-- The catcher uses the service-role key (bypasses RLS) to claim + complete rows.
