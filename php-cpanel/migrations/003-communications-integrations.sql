CREATE TABLE IF NOT EXISTS homepage_sections (
  section_id VARCHAR(32) NOT NULL PRIMARY KEY,
  heading VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by CHAR(36) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS communications_consents (
  customer_id VARCHAR(36) NOT NULL,
  channel ENUM('email', 'whatsapp') NOT NULL,
  consented_at DATETIME NULL,
  revoked_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, channel),
  KEY idx_consent_channel_active (channel, revoked_at),
  CONSTRAINT fk_consent_customer FOREIGN KEY (customer_id) REFERENCES customer_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  owner_type ENUM('staff', 'customer') NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint_hash (endpoint_hash),
  KEY idx_push_owner (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE roles
SET permissions_json = JSON_ARRAY_APPEND(permissions_json, '$', 'manage_communications')
WHERE id IN ('admin', 'director')
  AND JSON_VALID(permissions_json)
  AND JSON_SEARCH(permissions_json, 'one', 'manage_communications') IS NULL;
