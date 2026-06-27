-- ════════════════════════════════════════════════════════════════════════════
-- Half days (recorded by HR — no salary is calculated).
--
-- HR marks that a person was away for PART of a working day: the date and the
-- absent window (from_time → to_time), a reason, and whether it is Paid or
-- Unpaid. The day stays Present but is also flagged a Half Day, and the report
-- shows the worked hours reduced by the absent window. The system only records
-- this; it computes no pay.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists half_days (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  the_date    date   not null,
  from_time   time   not null,
  to_time     time   not null,
  reason      text,
  paid        boolean not null default false,
  created_at  timestamptz default now()
);
create index if not exists half_days_emp_date on half_days (employee_id, the_date);
alter table half_days enable row level security;
drop policy if exists "auth manages half days" on half_days;
create policy "auth manages half days" on half_days
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on half_days to authenticated;
