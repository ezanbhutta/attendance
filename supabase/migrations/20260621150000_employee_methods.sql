-- Per-employee enrolment/verification methods, derived from their punches:
-- face (verify_mode 15), fingerprint (1), and card (card_no present) + the most
-- recent card number when the device reports one. Surfaced on the Employees page.

create or replace view v_employee_methods with (security_invoker = true) as
  select dum.employee_id,
         bool_or(rp.verify_mode = 15)    as has_face,
         bool_or(rp.verify_mode = 1)     as has_finger,
         bool_or(rp.card_no is not null) as has_card,
         (array_agg(rp.card_no order by rp.punch_time desc) filter (where rp.card_no is not null))[1] as card_no
    from device_user_map dum
    join raw_punches rp on rp.device_sn = dum.device_sn and rp.pin = dum.pin
   group by dum.employee_id;

grant select on v_employee_methods to authenticated;
