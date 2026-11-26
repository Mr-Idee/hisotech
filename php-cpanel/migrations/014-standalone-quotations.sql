ALTER TABLE quotations
  MODIFY COLUMN enquiry_id VARCHAR(36) NULL,
  ADD COLUMN customer_email VARCHAR(190) NULL AFTER customer_name,
  ADD COLUMN customer_phone VARCHAR(40) NULL AFTER customer_email,
  ADD COLUMN customer_address VARCHAR(255) NULL AFTER customer_phone;

UPDATE quotations q
LEFT JOIN enquiries e ON e.id = q.enquiry_id
SET q.customer_email = e.email,
    q.customer_phone = e.phone,
    q.customer_address = e.location
WHERE q.enquiry_id IS NOT NULL;

ALTER TABLE invoices
  MODIFY COLUMN enquiry_id VARCHAR(36) NULL,
  ADD COLUMN customer_email VARCHAR(190) NULL AFTER customer_name,
  ADD COLUMN customer_phone VARCHAR(40) NULL AFTER customer_email,
  ADD COLUMN customer_address VARCHAR(255) NULL AFTER customer_phone;

UPDATE invoices i
LEFT JOIN enquiries e ON e.id = i.enquiry_id
SET i.customer_email = e.email,
    i.customer_phone = e.phone,
    i.customer_address = e.location
WHERE i.enquiry_id IS NOT NULL;
