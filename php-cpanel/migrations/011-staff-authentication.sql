ALTER TABLE users
  ADD COLUMN auth_type ENUM('password', 'pin') NOT NULL DEFAULT 'password' AFTER password_hash,
  ADD COLUMN email_verified_at DATETIME NULL AFTER email;

UPDATE users
SET email_verified_at = UTC_TIMESTAMP()
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_password_reset_tokens (
  token_hash CHAR(64) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_staff_password_reset_user (user_id),
  KEY idx_staff_password_reset_expiry (expires_at),
  CONSTRAINT fk_staff_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
