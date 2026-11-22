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
  `username` VARCHAR(50) NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(60) NOT NULL DEFAULT 'technician',
  `title` VARCHAR(120) NOT NULL DEFAULT '',
  `skills` TEXT NULL,
  `status` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_items` (
  `id` VARCHAR(36) NOT NULL,
  `sku` VARCHAR(60) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `item_type` ENUM('equipment', 'service', 'appliance') NOT NULL DEFAULT 'equipment',
  `category` VARCHAR(80) NOT NULL,
  `grade` VARCHAR(60) NOT NULL DEFAULT 'Standard',
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

CREATE TABLE IF NOT EXISTS `customer_equipment_photos` (
  `id` VARCHAR(36) NOT NULL,
  `equipment_id` VARCHAR(36) NOT NULL,
  `customer_id` VARCHAR(36) NOT NULL,
  `storage_filename` VARCHAR(80) NOT NULL,
  `original_name` VARCHAR(140) NOT NULL,
  `mime_type` VARCHAR(40) NOT NULL DEFAULT 'image/jpeg',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ceq_photo_equipment` (`equipment_id`),
  KEY `idx_ceq_photo_customer` (`customer_id`),
  CONSTRAINT `fk_ceq_photo_equipment` FOREIGN KEY (`equipment_id`) REFERENCES `customer_equipment` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ceq_photo_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS `homepage_sections` (
  `section_id` VARCHAR(32) NOT NULL,
  `heading` VARCHAR(180) NOT NULL,
  `body` TEXT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` VARCHAR(36) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`section_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_settings` (
  `id` VARCHAR(40) NOT NULL,
  `settings_json` LONGTEXT NOT NULL,
  `updated_by` VARCHAR(36) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `communications_consents` (
  `customer_id` VARCHAR(36) NOT NULL,
  `channel` ENUM('email', 'whatsapp') NOT NULL,
  `consented_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`customer_id`, `channel`),
  KEY `idx_consent_channel_active` (`channel`, `revoked_at`),
  CONSTRAINT `fk_consent_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `whatsapp_recipient_consents` (
  `recipient_type` ENUM('customer', 'staff', 'enquiry') NOT NULL,
  `recipient_id` VARCHAR(36) NOT NULL,
  `purpose` ENUM('operational', 'marketing') NOT NULL,
  `phone_at_consent` VARCHAR(20) NOT NULL,
  `consented_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `consent_source` VARCHAR(60) NOT NULL,
  PRIMARY KEY (`recipient_type`, `recipient_id`, `purpose`),
  KEY `idx_whatsapp_consent_active` (`purpose`, `recipient_type`, `revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `communications_delivery_events` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `event_key` VARCHAR(60) NOT NULL,
  `recipient_type` ENUM('customer', 'staff', 'enquiry') NOT NULL,
  `recipient_id` VARCHAR(36) NOT NULL,
  `channel` ENUM('email', 'push', 'whatsapp') NOT NULL,
  `status` ENUM('sent', 'not_configured', 'failed', 'skipped') NOT NULL,
  `error_code` VARCHAR(60) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_delivery_event_created` (`event_key`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` VARCHAR(36) NOT NULL,
  `owner_type` ENUM('staff', 'customer') NOT NULL,
  `owner_id` VARCHAR(36) NOT NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth_key` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_push_endpoint_hash` (`endpoint_hash`),
  KEY `idx_push_owner` (`owner_type`, `owner_id`)
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
-- Seed system roles.
-- ============================================================================

INSERT INTO `roles` (`id`, `name`, `description`, `permissions_json`, `is_system`) VALUES
('superadmin', 'Super Admin', 'Full unrestricted control over all platform operations, dynamic role creation, staff accounts, Store, finance, field delivery, and communications.', '["manage_enquiries","manage_tickets","manage_storefront","draft_quotes","approve_quotes","manage_invoices","verify_payments","release_installations","update_installations","manage_staff","manage_roles","view_audit","manage_communications"]', 1),
('director', 'Managing Director', 'Executive approval of quotations, payment receipt verification, and authorization of installation job release.', '["manage_enquiries","manage_tickets","manage_storefront","draft_quotes","approve_quotes","manage_invoices","verify_payments","release_installations","update_installations","manage_staff","view_audit","manage_communications"]', 1),
('admin', 'Admin / Help Desk', 'Enquiries intake, customer complaint & service help desk routing, Store pricing, quotation drafting, invoicing, payment logging, and customer communications.', '["manage_enquiries","manage_tickets","manage_storefront","draft_quotes","manage_invoices","manage_staff","view_audit","manage_communications"]', 1),
('technician', 'Technician', 'Field execution of assigned 5-stage solar installations, site photo uploads, and assigned customer service/repair tickets.', '["update_installations","manage_tickets"]', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);


SET FOREIGN_KEY_CHECKS = 1;
