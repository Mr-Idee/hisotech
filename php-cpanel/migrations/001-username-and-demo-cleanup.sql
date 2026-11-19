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

DELETE FROM `catalog_items`
WHERE (`id` = 'cat-pv550' AND `sku` = 'PV-550M' AND `name` = '550W Monocrystalline Tier-1 Solar Panel' AND `price_ngn` = 155000.00)
   OR (`id` = 'cat-pv500' AND `sku` = 'PV-500M' AND `name` = '500W Mono PERC Solar Panel' AND `price_ngn` = 138000.00)
   OR (`id` = 'cat-inv5' AND `sku` = 'INV-5K-HYB' AND `name` = '5kW Hybrid MPPT Solar Inverter (48V)' AND `price_ngn` = 980000.00)
   OR (`id` = 'cat-inv10' AND `sku` = 'INV-10K-HYB' AND `name` = '10kW Dual-MPPT Parallel Hybrid Inverter' AND `price_ngn` = 1850000.00)
   OR (`id` = 'cat-inv15' AND `sku` = 'INV-15K-3P' AND `name` = '15kW Three-Phase Commercial Hybrid Inverter' AND `price_ngn` = 3100000.00)
   OR (`id` = 'cat-bat5' AND `sku` = 'BAT-512L' AND `name` = '5.12kWh 51.2V LiFePO4 Lithium Battery Module' AND `price_ngn` = 1420000.00)
   OR (`id` = 'cat-bos' AND `sku` = 'BOS-PRO' AND `name` = 'DC/AC Combiner, SPD Protection & Copper Cabling Kit' AND `price_ngn` = 285000.00)
   OR (`id` = 'cat-rack' AND `sku` = 'RACK-AL' AND `name` = 'Anodized Aluminum Roof Mounting Rails & Clamps' AND `price_ngn` = 195000.00)
   OR (`id` = 'cat-lab' AND `sku` = 'LAB-INST' AND `name` = 'Engineering Survey, Installation & Commissioning' AND `price_ngn` = 320000.00)
   OR (`id` = 'cat-maint' AND `sku` = 'SRV-MAINT' AND `name` = 'Preventive Maintenance & Battery Health Audit' AND `price_ngn` = 85000.00)
   OR (`id` = 'cat-app-ac' AND `sku` = 'APP-AC15' AND `name` = '1.5HP Low-Inrush Inverter Split AC' AND `price_ngn` = 540000.00)
   OR (`id` = 'cat-app-fridge' AND `sku` = 'APP-FRIDGE' AND `name` = 'Inverter Refrigerator / Deep Freezer (A++)' AND `price_ngn` = 485000.00)
   OR (`id` = 'cat-app-pump' AND `sku` = 'APP-PUMP' AND `name` = '1HP Solar-Compatible Submersible Borehole Pump' AND `price_ngn` = 310000.00);

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
