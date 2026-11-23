ALTER TABLE users
  ADD COLUMN profile_photo_filename VARCHAR(255) NULL AFTER phone;

CREATE TABLE IF NOT EXISTS customer_contact_groups (
  id VARCHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_contact_group_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_contact_group_members (
  group_id VARCHAR(36) NOT NULL,
  customer_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, customer_id),
  KEY idx_contact_group_member_customer (customer_id),
  CONSTRAINT fk_contact_group_member_group FOREIGN KEY (group_id) REFERENCES customer_contact_groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_contact_group_member_customer FOREIGN KEY (customer_id) REFERENCES customer_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
