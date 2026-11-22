ALTER TABLE invoices
  ADD COLUMN status ENUM('Pending', 'Confirmed', 'Completed') NOT NULL DEFAULT 'Pending' AFTER total_ngn;

ALTER TABLE store_orders
  MODIFY COLUMN status ENUM('Pending', 'Confirmed', 'Dispatched', 'Delivered', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending';

UPDATE invoices i
SET status = CASE
  WHEN (SELECT COALESCE(SUM(p.amount_ngn), 0) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'Confirmed') >= i.total_ngn THEN 'Completed'
  WHEN (SELECT COALESCE(SUM(p.amount_ngn), 0) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'Confirmed') > 0 THEN 'Confirmed'
  ELSE 'Pending'
END;

UPDATE store_orders o
JOIN invoices i ON i.enquiry_id = o.enquiry_id AND i.status = 'Completed'
SET o.status = 'Completed'
WHERE o.status = 'Delivered';

UPDATE enquiries e
JOIN store_orders o ON o.enquiry_id = e.id AND o.status = 'Completed'
SET e.status = 'Completed';
