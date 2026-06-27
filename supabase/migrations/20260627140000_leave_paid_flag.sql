-- ════════════════════════════════════════════════════════════════════════════
-- Paid / unpaid leave (HR's choice — no salary is calculated).
--
-- When HR adds a leave they pick Paid or Unpaid; the system only records that
-- choice so it shows in the report. It does NOT compute any pay. Existing leaves
-- whose type was 'unpaid' are marked unpaid; everything else defaults to paid.
-- ════════════════════════════════════════════════════════════════════════════

alter table leaves add column if not exists paid boolean not null default true;
update leaves set paid = false where leave_type = 'unpaid';
