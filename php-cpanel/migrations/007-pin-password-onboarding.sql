ALTER TABLE users
  ADD COLUMN initial_pin_hash VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN pin_expires_at DATETIME NULL AFTER initial_pin_hash,
  ADD COLUMN must_set_password TINYINT(1) NOT NULL DEFAULT 0 AFTER pin_expires_at;

ALTER TABLE customer_profiles
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER email_verified_at,
  ADD COLUMN initial_pin_hash VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN pin_expires_at DATETIME NULL AFTER initial_pin_hash,
  ADD COLUMN must_set_password TINYINT(1) NOT NULL DEFAULT 0 AFTER pin_expires_at;
