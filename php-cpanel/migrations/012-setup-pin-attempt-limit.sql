ALTER TABLE users
  ADD COLUMN pin_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER pin_expires_at;

ALTER TABLE customer_profiles
  ADD COLUMN pin_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER pin_expires_at;
