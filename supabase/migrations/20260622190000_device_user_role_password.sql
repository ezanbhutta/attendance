-- ════════════════════════════════════════════════════════════════════════════
-- Manage each person's device ROLE and PASSWORD from the dashboard.
--
--   device_privilege : the scanner's user role. 0 = Normal User, 14 = Super Admin
--                      (the values the device itself uses in its Pri field).
--   device_password  : the numeric password a user can type at the device. Set
--                      from the dashboard and pushed; never read back (so the
--                      dashboard value stays the source of truth).
--
-- The push queue carries the same two fields so "To device" can send them.
-- Face and fingerprint are NOT here — they live only on the device by design.
-- ════════════════════════════════════════════════════════════════════════════

alter table employees add column if not exists device_privilege smallint not null default 0;
alter table employees add column if not exists device_password text;

alter table device_user_pushes add column if not exists privilege smallint;
alter table device_user_pushes add column if not exists password text;
