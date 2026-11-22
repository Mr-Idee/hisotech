CREATE TABLE IF NOT EXISTS customer_equipment_photos (
  id VARCHAR(36) NOT NULL,
  equipment_id VARCHAR(36) NOT NULL,
  customer_id VARCHAR(36) NOT NULL,
  storage_filename VARCHAR(80) NOT NULL,
  original_name VARCHAR(140) NOT NULL,
  mime_type VARCHAR(40) NOT NULL DEFAULT 'image/jpeg',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ceq_photo_equipment (equipment_id),
  KEY idx_ceq_photo_customer (customer_id),
  CONSTRAINT fk_ceq_photo_equipment FOREIGN KEY (equipment_id) REFERENCES customer_equipment (id) ON DELETE CASCADE,
  CONSTRAINT fk_ceq_photo_customer FOREIGN KEY (customer_id) REFERENCES customer_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
