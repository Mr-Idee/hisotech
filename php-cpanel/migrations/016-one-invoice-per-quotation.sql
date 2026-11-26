-- Reconcile any duplicate quotation_id groups before applying this constraint.
SELECT quotation_id, COUNT(*) AS invoice_count, GROUP_CONCAT(invoice_code ORDER BY invoice_code) AS invoice_codes
FROM invoices
GROUP BY quotation_id
HAVING COUNT(*) > 1;

ALTER TABLE invoices
  ADD UNIQUE KEY uq_invoices_quotation (quotation_id);
