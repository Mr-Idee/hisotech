CREATE TABLE IF NOT EXISTS whatsapp_recipient_consents (
  recipient_type ENUM('customer', 'staff', 'enquiry') NOT NULL,
  recipient_id VARCHAR(36) NOT NULL,
  purpose ENUM('operational', 'marketing') NOT NULL,
  phone_at_consent VARCHAR(20) NOT NULL,
  consented_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  consent_source VARCHAR(60) NOT NULL,
  PRIMARY KEY (recipient_type, recipient_id, purpose),
  KEY idx_whatsapp_consent_active (purpose, recipient_type, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS communications_delivery_events (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  event_key VARCHAR(60) NOT NULL,
  recipient_type ENUM('customer', 'staff', 'enquiry') NOT NULL,
  recipient_id VARCHAR(36) NOT NULL,
  channel ENUM('email', 'push', 'whatsapp') NOT NULL,
  status ENUM('sent', 'not_configured', 'failed', 'skipped') NOT NULL,
  error_code VARCHAR(60) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_delivery_event_created (event_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
