-- Make deleting a department or group "just work" from the dashboard.
--
-- Before: these foreign keys defaulted to ON DELETE NO ACTION (RESTRICT), so
-- deleting a department/group that still had employees or schedules raised
-- "violates foreign key constraint ...". After:
--   • deleting a DEPARTMENT or GROUP simply UNASSIGNS its employees
--     (department_id / group_id -> NULL; the employee record is kept), and
--   • removes that department's/group's now-orphaned schedule rows, and
--   • promotes any sub-departments to top-level (parent_id -> NULL).
-- No employee, punch, or attendance record is ever deleted. Reversible by
-- re-assigning.

alter table employees            drop constraint if exists employees_department_id_fkey;
alter table employees            add  constraint employees_department_id_fkey
  foreign key (department_id) references departments(id) on delete set null;

alter table employees            drop constraint if exists employees_group_id_fkey;
alter table employees            add  constraint employees_group_id_fkey
  foreign key (group_id) references groups(id) on delete set null;

alter table departments          drop constraint if exists departments_parent_id_fkey;
alter table departments          add  constraint departments_parent_id_fkey
  foreign key (parent_id) references departments(id) on delete set null;

alter table department_schedules drop constraint if exists department_schedules_department_id_fkey;
alter table department_schedules add  constraint department_schedules_department_id_fkey
  foreign key (department_id) references departments(id) on delete cascade;

alter table group_schedules      drop constraint if exists group_schedules_group_id_fkey;
alter table group_schedules      add  constraint group_schedules_group_id_fkey
  foreign key (group_id) references groups(id) on delete cascade;
