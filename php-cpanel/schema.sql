-- ============================================================================
-- HI-SOTECH Solar Inverters - Operations & Website Platform Schema (V2)
-- Target: MySQL 8.0+ / MariaDB 10.4+ (cPanel phpMyAdmin Import)
-- Charset: utf8mb4_unicode_ci
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` VARCHAR(60) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NOT NULL,
  `permissions_json` LONGTEXT NOT NULL,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(60) NOT NULL DEFAULT 'technician',
  `title` VARCHAR(120) NOT NULL DEFAULT '',
  `skills` TEXT NULL,
  `status` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_items` (
  `id` VARCHAR(36) NOT NULL,
  `sku` VARCHAR(60) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `item_type` ENUM('equipment', 'service', 'appliance') NOT NULL DEFAULT 'equipment',
  `category` VARCHAR(80) NOT NULL,
  `unit` VARCHAR(40) NOT NULL DEFAULT 'unit',
  `price_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `stock_qty` INT NOT NULL DEFAULT 0,
  `capacity_kw` DECIMAL(8,2) NULL DEFAULT NULL,
  `watts` INT NULL DEFAULT NULL,
  `description` TEXT NOT NULL,
  `image_path` VARCHAR(255) NOT NULL DEFAULT '',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catalog_sku` (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `enquiries` (
  `id` VARCHAR(36) NOT NULL,
  `ref_code` VARCHAR(32) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(190) NOT NULL DEFAULT '',
  `phone` VARCHAR(40) NOT NULL,
  `location` VARCHAR(190) NOT NULL,
  `channel` VARCHAR(80) NOT NULL DEFAULT 'Website · Load Estimator',
  `need_summary` TEXT NOT NULL,
  `appliances_json` LONGTEXT NULL,
  `estimate_json` LONGTEXT NULL,
  `status` ENUM('New', 'Technical review', 'Quoted', 'Invoiced', 'In delivery', 'Completed') NOT NULL DEFAULT 'New',
  `owner_user_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enquiries_ref` (`ref_code`),
  KEY `idx_enquiries_owner` (`owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quotations` (
  `id` VARCHAR(36) NOT NULL,
  `quote_code` VARCHAR(32) NOT NULL,
  `enquiry_id` VARCHAR(36) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `status` ENUM('Draft', 'Pending MD', 'Approved', 'Rejected', 'Invoiced') NOT NULL DEFAULT 'Draft',
  `revision_no` INT NOT NULL DEFAULT 1,
  `scope` TEXT NOT NULL,
  `terms` TEXT NOT NULL,
  `note` TEXT NOT NULL,
  `discount_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_percent` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `issued_date` DATE NOT NULL,
  `valid_until` DATE NOT NULL,
  `approved_by` VARCHAR(120) NULL,
  `approved_at` DATETIME NULL,
  `items_json` LONGTEXT NOT NULL,
  `revisions_json` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quotes_code` (`quote_code`),
  KEY `idx_quotes_enquiry` (`enquiry_id`),
  CONSTRAINT `fk_quotes_enquiry` FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` VARCHAR(36) NOT NULL,
  `invoice_code` VARCHAR(32) NOT NULL,
  `quotation_id` VARCHAR(36) NOT NULL,
  `enquiry_id` VARCHAR(36) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `discount_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_percent` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `total_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `bank_details_json` TEXT NOT NULL,
  `customer_accepted` TINYINT(1) NOT NULL DEFAULT 0,
  `accepted_at` DATETIME NULL,
  `issued_date` DATE NOT NULL,
  `due_date` DATE NOT NULL,
  `items_json` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_code` (`invoice_code`),
  KEY `idx_invoices_enquiry` (`enquiry_id`),
  CONSTRAINT `fk_invoices_quote` FOREIGN KEY (`quotation_id`) REFERENCES `quotations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_invoices_enquiry` FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` VARCHAR(36) NOT NULL,
  `payment_code` VARCHAR(32) NOT NULL,
  `invoice_id` VARCHAR(36) NOT NULL,
  `amount_ngn` DECIMAL(14,2) NOT NULL,
  `payment_date` DATE NOT NULL,
  `method` VARCHAR(80) NOT NULL,
  `reference` VARCHAR(140) NOT NULL,
  `evidence_note` TEXT NOT NULL,
  `status` ENUM('Pending', 'Confirmed', 'Rejected') NOT NULL DEFAULT 'Pending',
  `recorded_by` VARCHAR(120) NOT NULL,
  `verified_by` VARCHAR(120) NULL,
  `verified_at` DATETIME NULL,
  `rejection_reason` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_code` (`payment_code`),
  KEY `idx_payments_invoice` (`invoice_id`),
  CONSTRAINT `fk_payments_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `installations` (
  `id` VARCHAR(36) NOT NULL,
  `job_code` VARCHAR(32) NOT NULL,
  `invoice_id` VARCHAR(36) NOT NULL,
  `enquiry_id` VARCHAR(36) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `location` VARCHAR(190) NOT NULL,
  `system_summary` VARCHAR(255) NOT NULL,
  `assigned_engineer_id` VARCHAR(36) NULL,
  `engineer_acknowledged` TINYINT(1) NOT NULL DEFAULT 0,
  `current_stage` TINYINT NOT NULL DEFAULT 1,
  `target_date` DATE NOT NULL,
  `release_type` ENUM('Full Payment', 'MD Exception') NOT NULL DEFAULT 'Full Payment',
  `release_note` TEXT NOT NULL,
  `released_by` VARCHAR(120) NOT NULL,
  `released_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jobs_code` (`job_code`),
  KEY `idx_jobs_engineer` (`assigned_engineer_id`),
  CONSTRAINT `fk_jobs_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_jobs_enquiry` FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `installation_updates` (
  `id` VARCHAR(36) NOT NULL,
  `installation_id` VARCHAR(36) NOT NULL,
  `stage_number` TINYINT NOT NULL,
  `activity_title` VARCHAR(160) NOT NULL,
  `report_text` TEXT NOT NULL,
  `is_customer_visible` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` VARCHAR(120) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_updates_job` (`installation_id`),
  CONSTRAINT `fk_updates_job` FOREIGN KEY (`installation_id`) REFERENCES `installations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `installation_photos` (
  `id` VARCHAR(36) NOT NULL,
  `update_id` VARCHAR(36) NOT NULL,
  `storage_filename` VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(180) NOT NULL,
  `mime_type` VARCHAR(80) NOT NULL,
  `uploaded_by` VARCHAR(120) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_photos_update` (`update_id`),
  CONSTRAINT `fk_photos_update` FOREIGN KEY (`update_id`) REFERENCES `installation_updates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_profiles` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `location` VARCHAR(190) NOT NULL DEFAULT '',
  `company` VARCHAR(150) NOT NULL DEFAULT '',
  `ref_code` VARCHAR(32) NOT NULL DEFAULT '',
  `email_verified_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_login_tokens` (
  `token_hash` CHAR(64) NOT NULL,
  `customer_id` VARCHAR(36) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_customer_login_expiry` (`expires_at`),
  CONSTRAINT `fk_customer_login_token_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_auth_rate_limits` (
  `id` VARCHAR(36) NOT NULL,
  `key_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_auth_rate_key_time` (`key_hash`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_equipment` (
  `id` VARCHAR(36) NOT NULL,
  `customer_id` VARCHAR(36) NOT NULL,
  `equipment_type` VARCHAR(120) NOT NULL,
  `brand_model` VARCHAR(180) NOT NULL,
  `serial_number` VARCHAR(120) NOT NULL DEFAULT '',
  `capacity_kw` VARCHAR(40) NOT NULL DEFAULT '',
  `install_date` VARCHAR(20) NOT NULL DEFAULT '',
  `notes` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ceq_customer` (`customer_id`),
  CONSTRAINT `fk_ceq_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_tickets` (
  `id` VARCHAR(36) NOT NULL,
  `ticket_code` VARCHAR(32) NOT NULL,
  `customer_id` VARCHAR(36) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `customer_phone` VARCHAR(40) NOT NULL,
  `location` VARCHAR(190) NOT NULL,
  `equipment_id` VARCHAR(36) NULL,
  `equipment_summary` VARCHAR(255) NOT NULL DEFAULT '',
  `category` ENUM('Service Request', 'Complaint', 'Warranty Claim', 'Preventive Maintenance') NOT NULL DEFAULT 'Service Request',
  `priority` ENUM('Normal', 'Urgent') NOT NULL DEFAULT 'Normal',
  `subject` VARCHAR(190) NOT NULL,
  `description` TEXT NOT NULL,
  `status` ENUM('Open', 'Assigned', 'In Progress', 'Resolved') NOT NULL DEFAULT 'Open',
  `assigned_tech_id` VARCHAR(36) NULL,
  `assigned_tech_name` VARCHAR(120) NULL,
  `resolution_note` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_code` (`ticket_code`),
  KEY `idx_ticket_customer` (`customer_id`),
  CONSTRAINT `fk_ticket_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `store_orders` (
  `id` VARCHAR(36) NOT NULL,
  `order_code` VARCHAR(32) NOT NULL,
  `enquiry_id` VARCHAR(36) NOT NULL,
  `ref_code` VARCHAR(32) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(190) NOT NULL DEFAULT '',
  `phone` VARCHAR(40) NOT NULL,
  `location` VARCHAR(190) NOT NULL,
  `delivery_address` VARCHAR(255) NOT NULL,
  `delivery_method` VARCHAR(60) NOT NULL DEFAULT 'Nationwide Delivery',
  `payment_method` VARCHAR(60) NOT NULL DEFAULT 'Bank Transfer on Invoice',
  `notes` TEXT NOT NULL,
  `items_json` LONGTEXT NOT NULL,
  `subtotal_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `delivery_fee_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_ngn` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('Pending', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled') NOT NULL DEFAULT 'Pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_code` (`order_code`),
  KEY `idx_order_enquiry` (`enquiry_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(180) NOT NULL,
  `body` TEXT NOT NULL,
  `target_module` VARCHAR(60) NOT NULL,
  `target_ref` VARCHAR(60) NOT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notif_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` VARCHAR(36) NOT NULL,
  `actor_name` VARCHAR(120) NOT NULL,
  `actor_role` VARCHAR(60) NOT NULL,
  `action_type` VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(60) NOT NULL,
  `entity_id` VARCHAR(60) NOT NULL,
  `summary` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_setup` (
  `id` TINYINT NOT NULL,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Seed system roles and demonstration records.
-- ============================================================================

INSERT INTO `roles` (`id`, `name`, `description`, `permissions_json`, `is_system`) VALUES
('superadmin', 'Super Admin', 'Full unrestricted control over all platform operations, dynamic role creation, staff accounts, storefront, finance, and field delivery.', '["manage_enquiries","manage_tickets","manage_storefront","draft_quotes","approve_quotes","manage_invoices","verify_payments","release_installations","update_installations","manage_staff","manage_roles","view_audit"]', 1),
('director', 'Managing Director', 'Executive approval of quotations, payment receipt verification, and authorization of installation job release.', '["manage_enquiries","manage_tickets","manage_storefront","draft_quotes","approve_quotes","manage_invoices","verify_payments","release_installations","update_installations","manage_staff","view_audit"]', 1),
('admin', 'Admin / Help Desk', 'Enquiries intake, customer complaint & service help desk routing, storefront pricing, quotation drafting, invoicing, and payment logging.', '["manage_enquiries","manage_tickets","manage_storefront","draft_quotes","manage_invoices","manage_staff","view_audit"]', 1),
('technician', 'Technician', 'Field execution of assigned 5-stage solar installations, site photo uploads, and assigned customer service/repair tickets.', '["update_installations","manage_tickets"]', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);


INSERT INTO `catalog_items` (`id`, `sku`, `name`, `item_type`, `category`, `unit`, `price_ngn`, `stock_qty`, `capacity_kw`, `watts`, `description`, `image_path`) VALUES
('cat-pv550', 'PV-550M', '550W Monocrystalline Tier-1 Solar Panel', 'equipment', 'Solar Panels', 'panel', 155000.00, 64, 0.55, 550, 'Half-cut N-Type monocrystalline module with 25-year performance warranty.', '/src/assets/images/store_solar_panel_1794824378149.jpg'),
('cat-pv500', 'PV-500M', '500W Mono PERC Solar Panel', 'equipment', 'Solar Panels', 'panel', 138000.00, 40, 0.50, 500, 'Standard commercial & residential solar module from HI-SOTECH stock.', '/assets/site/project-4-panels-500w.jpg'),
('cat-inv5', 'INV-5K-HYB', '5kW Hybrid MPPT Solar Inverter (48V)', 'equipment', 'Inverters', 'unit', 980000.00, 9, 5.00, 5000, 'Pure sine-wave hybrid solar inverter with integrated dual MPPT & BMS comms.', '/src/assets/images/catalog_hybrid_inverter_1794819207311.jpg'),
('cat-inv10', 'INV-10K-HYB', '10kW Dual-MPPT Parallel Hybrid Inverter', 'equipment', 'Inverters', 'unit', 1850000.00, 6, 10.00, 10000, 'Scalable 10kW hybrid inverter supporting generator, grid, and parallel operation.', '/assets/site/project-8-inverter-wall.jpg'),
('cat-inv15', 'INV-15K-3P', '15kW Three-Phase Commercial Hybrid Inverter', 'equipment', 'Inverters', 'unit', 3100000.00, 3, 15.00, 15000, 'High-voltage three-phase hybrid inverter for clinics, offices, and estates.', '/src/assets/images/store_three_phase_inverter_1794827493416.jpg'),
('cat-bat5', 'BAT-512L', '5.12kWh 51.2V LiFePO4 Lithium Battery Module', 'equipment', 'Battery Storage', 'unit', 1420000.00, 14, 5.12, NULL, '6000-cycle Grade-A LiFePO4 rack/wall module with smart BMS protection.', '/src/assets/images/store_lithium_battery_1794824377691.jpg'),
('cat-bos', 'BOS-PRO', 'DC/AC Combiner, SPD Protection & Copper Cabling Kit', 'equipment', 'Protection & BOS', 'kit', 285000.00, 22, NULL, NULL, 'Full DC isolator, lightning SPD, earthing rod, and 6mm/16mm copper kit.', '/src/assets/images/store_combiner_protection_kit_1794827495065.jpg'),
('cat-rack', 'RACK-AL', 'Anodized Aluminum Roof Mounting Rails & Clamps', 'equipment', 'Mounting', 'set', 195000.00, 18, NULL, NULL, 'Corrosion-proof anodized aluminum rail structure per 8-panel array.', '/src/assets/images/store_mounting_rails_1794827495998.jpg'),
('cat-lab', 'LAB-INST', 'Engineering Survey, Installation & Commissioning', 'service', 'Services', 'lot', 320000.00, 999, NULL, NULL, 'COREN-certified engineering site survey, mechanical/electrical installation & test.', '/assets/site/project-9-solar-rack.jpg'),
('cat-maint', 'SRV-MAINT', 'Preventive Maintenance & Battery Health Audit', 'service', 'Services', 'visit', 85000.00, 999, NULL, NULL, 'Scheduled array wash, thermal breaker inspection, firmware & BMS health check.', '/assets/site/project-3-ph-commercial.jpg'),
('cat-app-ac', 'APP-AC15', '1.5HP Low-Inrush Inverter Split AC', 'appliance', 'Appliances', 'unit', 540000.00, 10, 1.15, 1150, 'Solar-friendly inverter air conditioner engineered for low startup surge.', '/src/assets/images/store_inverter_ac_1794824379632.jpg'),
('cat-app-fridge', 'APP-FRIDGE', 'Inverter Refrigerator / Deep Freezer (A++)', 'appliance', 'Appliances', 'unit', 485000.00, 7, 0.18, 180, 'High-efficiency DC-inverter cold-chain refrigerator ideal for overnight battery backup.', '/src/assets/images/store_inverter_fridge_1794827495989.jpg'),
('cat-app-pump', 'APP-PUMP', '1HP Solar-Compatible Submersible Borehole Pump', 'appliance', 'Appliances', 'unit', 310000.00, 12, 0.75, 750, 'Reliable water pumping appliance compatible with hybrid solar inverters.', '/src/assets/images/store_submersible_pump_1794827496579.jpg')
ON DUPLICATE KEY UPDATE `price_ngn` = VALUES(`price_ngn`), `image_path` = VALUES(`image_path`);

INSERT INTO `enquiries` (`id`, `ref_code`, `customer_name`, `email`, `phone`, `location`, `channel`, `need_summary`, `appliances_json`, `estimate_json`, `status`, `owner_user_id`) VALUES
('enq-1001', 'HISO-1001', 'Demo Customer', 'customer@example.invalid', '+234 000 000 0000', 'Demo Site, Abuja', 'Website · Load Estimator', 'Demo residential hybrid backup with inverter AC support.', '[{"id":"led","name":"LED Lighting","qty":12,"watts":10,"hours":6},{"id":"fridge","name":"Inverter Refrigerator","qty":1,"watts":180,"hours":10},{"id":"ac","name":"1.5HP Inverter AC","qty":1,"watts":1150,"hours":5}]', '{"connectedLoadWatts":1450,"dailyEnergyKwh":8.27,"inverterMinKw":3,"batteryTargetKwh":6.3,"recommendedPanels550w":5,"recommendedBatteries5kwh":2,"powerMode":"Hybrid"}', 'In delivery', 'admin-idee'),
('enq-1002', 'HISO-1002', 'Sample Clinic', 'clinic@example.invalid', '+234 000 000 0000', 'Demo Commercial Site, Abuja', 'WhatsApp · Manual Intake', 'Sample clinic 10kW hybrid solar backup with zero switchover.', '[]', '{"connectedLoadWatts":6800,"dailyEnergyKwh":34.5,"inverterMinKw":10,"batteryTargetKwh":26.4,"recommendedPanels550w":19,"recommendedBatteries5kwh":6,"powerMode":"Hybrid"}', 'Quoted', 'admin-idee'),
('enq-1003', 'HISO-1003', 'Sample Prospect', 'prospect@example.invalid', '+234 000 000 0000', 'Demo Residential Site, Abuja', 'Website · Load Estimator', 'Sample residential load estimate awaiting technical site review.', '[{"id":"led","name":"LED Lighting","qty":14,"watts":10,"hours":7},{"id":"fan","name":"Ceiling Fans","qty":5,"watts":75,"hours":8}]', '{"connectedLoadWatts":515,"dailyEnergyKwh":3.98,"inverterMinKw":1.5,"batteryTargetKwh":3.0,"recommendedPanels550w":3,"recommendedBatteries5kwh":1,"powerMode":"Hybrid"}', 'New', 'md-oseni'),
('enq-1004', 'HISO-1004', 'Sample Retail Customer', 'retail@example.invalid', '+234 000 000 0000', 'Demo Delivery Site, Abuja', 'Website · Storefront Order', 'Sample storefront order (1× 5kW Hybrid Inverter, 2× 550W Solar Panels)', '[]', NULL, 'New', 'admin-idee')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

INSERT INTO `quotations` (`id`, `quote_code`, `enquiry_id`, `customer_name`, `status`, `revision_no`, `scope`, `terms`, `note`, `discount_ngn`, `tax_percent`, `issued_date`, `valid_until`, `approved_by`, `approved_at`, `items_json`, `revisions_json`) VALUES
('quo-1001', 'QUO-1001', 'enq-1001', 'Demo Customer', 'Invoiced', 1, 'Supply, installation, and commissioning of 5kW hybrid solar inverter with 10.24kWh LiFePO4 battery bank.', '50% deposit on acceptance, 50% prior to final commissioning handover. 7-day quote validity, 1-year workmanship warranty.', 'Includes roof earthing and DC/AC surge arresters.', 100000.00, 7.50, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Demo Director', NOW(), '[{"sku":"PV-550M","description":"550W Monocrystalline Tier-1 Solar Panel","unit":"panel","qty":8,"unitPriceNgn":155000},{"sku":"INV-5K-HYB","description":"5kW Hybrid MPPT Solar Inverter (48V)","unit":"unit","qty":1,"unitPriceNgn":980000},{"sku":"BAT-512L","description":"5.12kWh 51.2V LiFePO4 Lithium Battery Module","unit":"unit","qty":2,"unitPriceNgn":1420000},{"sku":"BOS-PRO","description":"DC/AC Combiner, SPD Protection & Copper Cabling Kit","unit":"kit","qty":1,"unitPriceNgn":285000},{"sku":"LAB-INST","description":"Engineering Survey, Installation & Commissioning","unit":"lot","qty":1,"unitPriceNgn":320000}]', '[{"revisionNo":1,"changedBy":"Demo Admin","note":"Sample technical specification","createdAt":"2026-11-10T09:00:00Z","totalNgn":5874875}]'),
('quo-1002', 'QUO-1002', 'enq-1002', 'Sample Clinic', 'Pending MD', 1, '10kW commercial hybrid inverter and 15.36kWh lithium storage for sample clinic.', '60% mobilisation deposit; 40% upon commissioning.', 'Sample quotation awaiting approval.', 0.00, 7.50, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY), NULL, NULL, '[{"sku":"PV-550M","description":"550W Monocrystalline Tier-1 Solar Panel","unit":"panel","qty":16,"unitPriceNgn":155000},{"sku":"INV-10K-HYB","description":"10kW Dual-MPPT Parallel Hybrid Inverter","unit":"unit","qty":1,"unitPriceNgn":1850000},{"sku":"BAT-512L","description":"5.12kWh 51.2V LiFePO4 Lithium Battery Module","unit":"unit","qty":3,"unitPriceNgn":1420000},{"sku":"BOS-PRO","description":"DC/AC Combiner, SPD Protection & Copper Cabling Kit","unit":"kit","qty":1,"unitPriceNgn":285000},{"sku":"LAB-INST","description":"Engineering Survey, Installation & Commissioning","unit":"lot","qty":1,"unitPriceNgn":320000}]', '[{"revisionNo":1,"changedBy":"Demo Admin","note":"Sample commercial system","createdAt":"2026-11-14T11:30:00Z","totalNgn":9884625}]')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

INSERT INTO `invoices` (`id`, `invoice_code`, `quotation_id`, `enquiry_id`, `customer_name`, `discount_ngn`, `tax_percent`, `total_ngn`, `bank_details_json`, `customer_accepted`, `accepted_at`, `issued_date`, `due_date`, `items_json`) VALUES
('inv-1001', 'INV-1001', 'quo-1001', 'enq-1001', 'Demo Customer', 100000.00, 7.50, 5874875.00, '{"bankName":"Example Bank","accountName":"DEMO ONLY - DO NOT PAY","accountNumber":"0000000000"}', 1, NOW(), DATE_SUB(CURDATE(), INTERVAL 6 DAY), DATE_ADD(CURDATE(), INTERVAL 8 DAY), '[{"sku":"PV-550M","description":"550W Monocrystalline Tier-1 Solar Panel","unit":"panel","qty":8,"unitPriceNgn":155000},{"sku":"INV-5K-HYB","description":"5kW Hybrid MPPT Solar Inverter (48V)","unit":"unit","qty":1,"unitPriceNgn":980000},{"sku":"BAT-512L","description":"5.12kWh 51.2V LiFePO4 Lithium Battery Module","unit":"unit","qty":2,"unitPriceNgn":1420000},{"sku":"BOS-PRO","description":"DC/AC Combiner, SPD Protection & Copper Cabling Kit","unit":"kit","qty":1,"unitPriceNgn":285000},{"sku":"LAB-INST","description":"Engineering Survey, Installation & Commissioning","unit":"lot","qty":1,"unitPriceNgn":320000}]')
ON DUPLICATE KEY UPDATE `total_ngn` = VALUES(`total_ngn`);

INSERT INTO `payments` (`id`, `payment_code`, `invoice_id`, `amount_ngn`, `payment_date`, `method`, `reference`, `evidence_note`, `status`, `recorded_by`, `verified_by`, `verified_at`) VALUES
('pay-1001', 'PAY-1001', 'inv-1001', 3500000.00, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Sample Bank Transfer', 'DEMO-REFERENCE', 'Sample payment record only; not proof of payment.', 'Pending', 'Demo Admin', NULL, NULL)
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

INSERT INTO `installations` (`id`, `job_code`, `invoice_id`, `enquiry_id`, `customer_name`, `location`, `system_summary`, `assigned_engineer_id`, `engineer_acknowledged`, `current_stage`, `target_date`, `release_type`, `release_note`, `released_by`) VALUES
('job-1001', 'JOB-1001', 'inv-1001', 'enq-1001', 'Demo Customer', 'Demo Site, Abuja', '5kW Hybrid Inverter · 8x 550W Panels · 10.24kWh LiFePO4', 'demo-technician', 1, 3, DATE_ADD(CURDATE(), INTERVAL 5 DAY), 'Standard Release', 'Sample installation record; confirm all customer and payment details before use.', 'Demo Director')
ON DUPLICATE KEY UPDATE `current_stage` = VALUES(`current_stage`);

INSERT INTO `installation_updates` (`id`, `installation_id`, `stage_number`, `activity_title`, `report_text`, `is_customer_visible`, `created_by`) VALUES
('upd-1001', 'job-1001', 1, 'Sample Site Assessment', 'Sample installation progress update for demonstration only.', 1, 'Demo Technician'),
('upd-1002', 'job-1001', 2, 'Sample Design Review', 'Sample design review update for demonstration only.', 1, 'Demo Technician'),
('upd-1003', 'job-1001', 3, 'Sample Materials Preparation', 'Sample materials update for demonstration only.', 1, 'Demo Technician')
ON DUPLICATE KEY UPDATE `activity_title` = VALUES(`activity_title`);

INSERT INTO `customer_profiles` (`id`, `name`, `email`, `phone`, `location`, `company`, `ref_code`) VALUES
('cust-amina', 'Demo Customer', 'customer@example.invalid', '+234 000 000 0000', 'Demo Site, Abuja', 'Example Residence', 'HISO-1001')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `customer_equipment` (`id`, `customer_id`, `equipment_type`, `brand_model`, `serial_number`, `capacity_kw`, `install_date`, `notes`) VALUES
('ceq-1', 'cust-amina', 'Hybrid Inverter', 'Sample 5kW 48V Dual MPPT', 'DEMO-INVERTER-001', '5.0', DATE_SUB(CURDATE(), INTERVAL 90 DAY), 'Sample equipment record for demonstration only.'),
('ceq-2', 'cust-amina', 'LiFePO4 Battery Bank', 'Sample 10.24kWh battery bank', 'DEMO-BATTERY-001', '10.24', DATE_SUB(CURDATE(), INTERVAL 90 DAY), 'Sample equipment record for demonstration only.')
ON DUPLICATE KEY UPDATE `brand_model` = VALUES(`brand_model`);

INSERT INTO `service_tickets` (`id`, `ticket_code`, `customer_id`, `customer_name`, `customer_phone`, `location`, `equipment_id`, `equipment_summary`, `category`, `priority`, `subject`, `description`, `status`, `assigned_tech_id`, `assigned_tech_name`, `resolution_note`) VALUES
('tkt-1001', 'TKT-1001', 'cust-amina', 'Demo Customer', '+234 000 000 0000', 'Demo Site, Abuja', 'ceq-1', 'Hybrid Inverter — Sample 5kW model', 'Preventive Maintenance', 'Normal', 'Sample Maintenance Request', 'Sample service ticket for demonstration only.', 'Assigned', 'demo-technician', 'Demo Technician', 'Sample resolution note; verify details before use.')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

INSERT INTO `store_orders` (`id`, `order_code`, `enquiry_id`, `ref_code`, `customer_name`, `email`, `phone`, `location`, `delivery_address`, `delivery_method`, `payment_method`, `notes`, `items_json`, `subtotal_ngn`, `delivery_fee_ngn`, `tax_ngn`, `total_ngn`, `status`) VALUES
('ord-1001', 'ORD-1001', 'enq-1004', 'HISO-1004', 'Sample Retail Customer', 'retail@example.invalid', '+234 000 000 0000', 'Demo Delivery Site, Abuja', 'Demo Address - Do Not Deliver', 'Sample Pickup', 'Sample Payment - Do Not Use', 'Sample storefront order for demonstration only.', '[{"sku":"INV-5K-HYB","name":"5kW Hybrid MPPT Solar Inverter (48V)","unit":"unit","qty":1,"unitPriceNgn":980000,"imagePath":"/src/assets/images/catalog_hybrid_inverter_1794819207311.jpg"},{"sku":"PV-550M","name":"550W Monocrystalline Tier-1 Solar Panel","unit":"panel","qty":2,"unitPriceNgn":155000,"imagePath":"/src/assets/images/store_solar_panel_1794824378149.jpg"}]', 1290000.00, 0.00, 96750.00, 1386750.00, 'New')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

SET FOREIGN_KEY_CHECKS = 1;
