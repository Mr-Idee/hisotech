UPDATE enquiries
SET status = 'New'
WHERE status NOT IN ('New', 'Technical review');

ALTER TABLE enquiries
  MODIFY COLUMN status ENUM('New', 'Technical review') NOT NULL DEFAULT 'New',
  ADD COLUMN archived_at DATETIME NULL AFTER status,
  ADD KEY idx_enquiries_archive_created (archived_at, created_at);
