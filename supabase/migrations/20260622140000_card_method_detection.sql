-- ════════════════════════════════════════════════════════════════════════════
-- Detect card scans instead of labelling them "Other".
--
-- The device's confirmed verify_mode values are 15 = face and 1 = fingerprint.
-- Its third method is the RF/NFC card, which arrives with a different verify_mode
-- (and the ATTLOG feed carries no card number, so card_no is usually null). The
-- live feed previously mapped anything that wasn't face or fingerprint to
-- "other", so every card entry showed as Other. Since this device only offers
-- face, fingerprint and card, treat a successful scan that is neither face nor
-- fingerprint (or that carries a card number) as a card.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view v_live_punches with (security_invoker = true) as
  select rp.id, rp.punch_time, rp.device_sn, rp.pin, rp.verify_mode,
         case when rp.verify_mode = 15 then 'face'
              when rp.verify_mode = 1  then 'fingerprint'
              when rp.verify_mode is null and rp.card_no is null then 'other'
              else 'card' end as method,
         dum.employee_id, e.emp_code,
         (e.first_name || ' ' || coalesce(e.last_name, '')) as employee
    from raw_punches rp
    left join device_user_map dum on dum.device_sn = rp.device_sn and dum.pin = rp.pin
    left join employees e on e.id = dum.employee_id
   order by rp.punch_time desc;

-- Mirror the same rule on the per-employee methods so the Employees page shows a
-- Card badge for anyone who has scanned with a card, not only when a card number
-- happened to be captured.
create or replace view v_employee_methods with (security_invoker = true) as
  select dum.employee_id,
         bool_or(rp.verify_mode = 15) as has_face,
         bool_or(rp.verify_mode = 1)  as has_finger,
         bool_or(rp.card_no is not null
                 or (rp.verify_mode is not null and rp.verify_mode not in (1, 15))) as has_card,
         (array_agg(rp.card_no order by rp.punch_time desc) filter (where rp.card_no is not null))[1] as card_no
    from device_user_map dum
    join raw_punches rp on rp.device_sn = dum.device_sn and rp.pin = dum.pin
   group by dum.employee_id;

grant select on v_employee_methods to authenticated;
