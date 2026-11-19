-- Back up the production database before running this migration.
-- This migration deletes only the seeded demonstration records with their
-- known IDs and matching demo identifiers; it preserves all other records.

ALTER TABLE `users`
  ADD COLUMN `username` VARCHAR(50) NULL AFTER `name`,
  ADD UNIQUE KEY `uq_users_username` (`username`);
ALTER TABLE `catalog_items`
  ADD COLUMN `grade` VARCHAR(60) NOT NULL DEFAULT 'Standard' AFTER `category`;

START TRANSACTION;

DELETE FROM `installation_photos`
WHERE `update_id` IN (
  SELECT u.`id`
  FROM `installation_updates` u
  JOIN `installations` i ON i.`id` = u.`installation_id`
  WHERE i.`id` = 'job-1001' AND i.`job_code` = 'JOB-1001' AND i.`customer_name` = 'Demo Customer'
);
DELETE FROM `installation_updates`
WHERE `installation_id` IN (
  SELECT `id` FROM `installations`
  WHERE `id` = 'job-1001' AND `job_code` = 'JOB-1001' AND `customer_name` = 'Demo Customer'
);
DELETE FROM `installations`
WHERE `id` = 'job-1001' AND `job_code` = 'JOB-1001' AND `customer_name` = 'Demo Customer';

DELETE FROM `payments` WHERE `id` = 'pay-1001' AND `payment_code` = 'PAY-1001';
DELETE FROM `invoices` WHERE `id` = 'inv-1001' AND `invoice_code` = 'INV-1001';
DELETE FROM `quotations`
WHERE (`id` = 'quo-1001' AND `quote_code` = 'QUO-1001')
   OR (`id` = 'quo-1002' AND `quote_code` = 'QUO-1002');
DELETE FROM `store_orders` WHERE `id` = 'ord-1001' AND `order_code` = 'ORD-1001';

DELETE FROM `service_tickets`
WHERE `id` = 'tkt-1001' AND `ticket_code` = 'TKT-1001';
DELETE FROM `customer_equipment`
WHERE (`id` = 'ceq-1' AND `serial_number` = 'DEMO-INVERTER-001')
   OR (`id` = 'ceq-2' AND `serial_number` = 'DEMO-BATTERY-001');
DELETE FROM `customer_login_tokens`
WHERE `customer_id` IN (
  SELECT `id` FROM `customer_profiles`
  WHERE `id` = 'cust-amina' AND `email` = 'customer@example.invalid'
);
DELETE FROM `customer_profiles`
WHERE `id` = 'cust-amina' AND `email` = 'customer@example.invalid';

DELETE FROM `enquiries`
WHERE (`id` = 'enq-1001' AND `ref_code` = 'HISO-1001' AND `email` = 'customer@example.invalid')
   OR (`id` = 'enq-1002' AND `ref_code` = 'HISO-1002' AND `email` = 'clinic@example.invalid')
   OR (`id` = 'enq-1003' AND `ref_code` = 'HISO-1003' AND `email` = 'prospect@example.invalid')
   OR (`id` = 'enq-1004' AND `ref_code` = 'HISO-1004' AND `email` = 'retail@example.invalid');

DELETE FROM `notifications` WHERE `id` IN ('notif-1', 'notif-2', 'notif-tkt-1');
DELETE FROM `audit_logs` WHERE `id` = 'aud-1' AND `entity_id` = 'JOB-1001';

COMMIT;
