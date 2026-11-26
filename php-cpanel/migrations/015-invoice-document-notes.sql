ALTER TABLE invoices
  ADD COLUMN note TEXT NULL AFTER customer_address;

UPDATE invoices i
JOIN quotations q ON q.id = i.quotation_id
SET i.note = q.note;

ALTER TABLE invoices
  MODIFY COLUMN note TEXT NOT NULL;
