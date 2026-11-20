export function customerEmailMatches(
  customerEmail: string | null | undefined,
  recordEmail: string | null | undefined
): boolean {
  const customer = customerEmail?.trim().toLowerCase() || '';
  const record = recordEmail?.trim().toLowerCase() || '';
  return customer.length > 0 && record.length > 0 && customer === record;
}
