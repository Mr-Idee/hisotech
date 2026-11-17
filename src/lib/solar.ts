import type {
  ApplianceItem,
  CatalogItem,
  InstallationRecord,
  LineItem,
  OrderDeliveryMethod,
  PaymentRecord,
  PermissionKey,
  PowerMode,
  SolarEstimateOptions,
  SolarEstimateResult,
  StaffMember,
  StaffStatus,
  StoreOrderItem,
  UserRole,
} from './types';

export const INSTALLATION_STAGES = [
  { stage: 1, title: 'Site Assessment', description: 'Physical roof, load, and earthing survey' },
  { stage: 2, title: 'Design Approval', description: 'Single-line diagram and equipment sign-off' },
  { stage: 3, title: 'Materials Preparation', description: 'Inverters, modules, and BOS kitting' },
  { stage: 4, title: 'Installation', description: 'Mechanical racking, DC/AC wiring, protection' },
  { stage: 5, title: 'Commissioning', description: 'Load testing, handover, and warranty log' },
] as const;

export const ALL_PERMISSIONS: { key: PermissionKey; label: string; group: string }[] = [
  { key: 'manage_enquiries', label: 'Intake & Review Enquiries', group: 'Commercial' },
  { key: 'manage_tickets', label: 'Help Desk & Service Complaints', group: 'Support' },
  { key: 'manage_storefront', label: 'Storefront Prices, Images & Stock', group: 'Catalogue' },
  { key: 'draft_quotes', label: 'Draft & Revise Quotations', group: 'Commercial' },
  { key: 'approve_quotes', label: 'Approve / Reject Quotations', group: 'Executive' },
  { key: 'manage_invoices', label: 'Issue Invoices & Log Receipts', group: 'Finance' },
  { key: 'verify_payments', label: 'Verify Bank Receipts', group: 'Executive' },
  { key: 'release_installations', label: 'Release Jobs for Installation', group: 'Executive' },
  { key: 'update_installations', label: 'Update Field Stages & Site Photos', group: 'Field' },
  { key: 'manage_staff', label: 'Manage Staff Accounts', group: 'Administration' },
  { key: 'manage_roles', label: 'Create & Edit Custom Roles', group: 'Super Admin' },
  { key: 'view_audit', label: 'Inspect Security Audit Logs', group: 'Administration' },
];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  superadmin: ALL_PERMISSIONS.map((p) => p.key),
  director: [
    'manage_enquiries',
    'manage_tickets',
    'manage_storefront',
    'draft_quotes',
    'approve_quotes',
    'manage_invoices',
    'verify_payments',
    'release_installations',
    'update_installations',
    'manage_staff',
    'view_audit',
  ],
  admin: [
    'manage_enquiries',
    'manage_tickets',
    'manage_storefront',
    'draft_quotes',
    'manage_invoices',
    'manage_staff',
    'view_audit',
  ],
  technician: ['update_installations', 'manage_tickets'],
};

export function hasPermission(user: Pick<StaffMember, 'role' | 'permissions'> | null | undefined, perm: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const list = user.permissions && user.permissions.length > 0
    ? user.permissions
    : ROLE_DEFAULT_PERMISSIONS[user.role] ?? [];
  return list.includes(perm);
}

export const DEFAULT_APPLIANCES: ApplianceItem[] = [
  { id: 'led', name: 'LED Lighting', qty: 12, watts: 10, hours: 6 },
  { id: 'fan', name: 'Ceiling Fans', qty: 4, watts: 75, hours: 8 },
  { id: 'tv', name: 'Television & Media', qty: 1, watts: 120, hours: 5 },
  { id: 'fridge', name: 'Inverter Refrigerator', qty: 1, watts: 180, hours: 10 },
  { id: 'laptop', name: 'Home Office / Router', qty: 2, watts: 65, hours: 8 },
  { id: 'ac', name: '1.5HP Inverter AC', qty: 1, watts: 1150, hours: 5 },
];

export function formatNgn(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return '₦' + Math.round(safe).toLocaleString('en-NG');
}

export function calculateSolarEstimate(
  appliances: ApplianceItem[],
  sunOrOptions: number | SolarEstimateOptions = 4.5,
  backupShareArg = 0.65
): SolarEstimateResult {
  const opts: SolarEstimateOptions =
    typeof sunOrOptions === 'number'
      ? { peakSunHours: sunOrOptions, backupShare: backupShareArg }
      : sunOrOptions;

  const peakSunHours = Math.max(2, Math.min(8, Number(opts.peakSunHours) || 4.5));
  const powerMode: PowerMode = opts.powerMode ?? 'Hybrid';
  const usableDepthPercent = Math.max(50, Math.min(95, Number(opts.usableDepthPercent) || 85));
  const dodFactor = usableDepthPercent / 100;
  const autonomyHours = Math.max(2, Math.min(48, Number(opts.autonomyHours) || (powerMode === 'Off-grid' ? 16 : 10)));
  const modeMultiplier = powerMode === 'Off-grid' ? 1.0 : powerMode === 'Grid-backup' ? 0.55 : (opts.backupShare ?? 0.65);

  let connectedLoadWatts = 0;
  let dailyWh = 0;

  for (const item of appliances) {
    const qty = Math.max(0, Number(item.qty) || 0);
    const watts = Math.max(0, Number(item.watts) || 0);
    const hours = Math.min(24, Math.max(0, Number(item.hours) || 0));
    connectedLoadWatts += qty * watts;
    dailyWh += qty * watts * hours;
  }

  const dailyEnergyKwh = Math.round((dailyWh / 1000) * 100) / 100;
  const rawInverterKw = (connectedLoadWatts * 1.3) / 1000;
  const standardSizes = [1.5, 3, 5, 8, 10, 15, 20, 30, 50, 80, 100, 120];
  const inverterMinKw =
    connectedLoadWatts === 0
      ? 0
      : standardSizes.find((s) => s >= rawInverterKw) ?? Math.ceil(rawInverterKw / 10) * 10;

  // Autonomy scaling: baseline 10h night/reserve = 1.0x modeMultiplier; 16h off-grid scales up storage reserve cleanly
  const autonomyRatio = autonomyHours / 12;
  const rawBatteryKwh =
    dailyEnergyKwh === 0
      ? 0
      : ((dailyEnergyKwh * modeMultiplier * Math.max(0.75, autonomyRatio)) / dodFactor);
  const batteryTargetKwh = Math.round(rawBatteryKwh * 10) / 10;

  const recommendedPanels550w =
    dailyEnergyKwh === 0 || powerMode === 'Grid-backup'
      ? 0
      : Math.max(2, Math.ceil((dailyEnergyKwh * (powerMode === 'Off-grid' ? 1.35 : 1.25)) / (0.55 * peakSunHours)));

  const recommendedBatteries5kwh =
    batteryTargetKwh === 0 ? 0 : Math.max(1, Math.ceil(batteryTargetKwh / 5.12));

  return {
    connectedLoadWatts: Math.round(connectedLoadWatts),
    dailyEnergyKwh,
    inverterMinKw,
    batteryTargetKwh,
    recommendedPanels550w,
    recommendedBatteries5kwh,
    powerMode,
    autonomyHours,
    peakSunHours,
    usableDepthPercent,
  };
}

export function buildQuoteLinesFromEstimate(
  estimate: SolarEstimateResult | null,
  catalog: CatalogItem[]
): LineItem[] {
  const hardwareAndServices = catalog.filter((c) => c.itemType !== 'appliance');
  if (!estimate || estimate.connectedLoadWatts === 0) {
    return hardwareAndServices.slice(0, 4).map((item) => ({
      sku: item.sku,
      description: item.name,
      unit: item.unit,
      qty: 1,
      unitPriceNgn: item.priceNgn,
    }));
  }

  const findSkuOrCategory = (sku: string, cat?: string) =>
    hardwareAndServices.find((c) => c.sku === sku) ??
    (cat ? hardwareAndServices.find((c) => c.category === cat) : undefined);

  const inverters = hardwareAndServices
    .filter((c) => c.category === 'Inverters' && c.capacityKw !== null)
    .sort((a, b) => (a.capacityKw ?? 0) - (b.capacityKw ?? 0));
  const chosenInverter =
    inverters.find((inv) => (inv.capacityKw ?? 0) >= estimate.inverterMinKw) ??
    inverters[inverters.length - 1];

  const lines: LineItem[] = [];
  const pv = findSkuOrCategory('PV-550M', 'Solar Panels');
  if (pv && estimate.recommendedPanels550w > 0) {
    lines.push({
      sku: pv.sku,
      description: pv.name,
      unit: pv.unit,
      qty: estimate.recommendedPanels550w,
      unitPriceNgn: pv.priceNgn,
    });
  }
  if (chosenInverter) {
    lines.push({
      sku: chosenInverter.sku,
      description: chosenInverter.name,
      unit: chosenInverter.unit,
      qty: 1,
      unitPriceNgn: chosenInverter.priceNgn,
    });
  }
  const bat = findSkuOrCategory('BAT-512L', 'Battery Storage');
  if (bat && estimate.recommendedBatteries5kwh > 0) {
    lines.push({
      sku: bat.sku,
      description: bat.name,
      unit: bat.unit,
      qty: estimate.recommendedBatteries5kwh,
      unitPriceNgn: bat.priceNgn,
    });
  }

  const bos = findSkuOrCategory('BOS-PRO', 'Protection & BOS');
  if (bos) {
    lines.push({
      sku: bos.sku,
      description: bos.name,
      unit: bos.unit,
      qty: 1,
      unitPriceNgn: bos.priceNgn,
    });
  }

  if (estimate.recommendedPanels550w > 0) {
    const rack = findSkuOrCategory('RACK-AL', 'Mounting');
    if (rack) {
      lines.push({
        sku: rack.sku,
        description: rack.name,
        unit: rack.unit,
        qty: Math.max(1, Math.ceil(estimate.recommendedPanels550w / 8)),
        unitPriceNgn: rack.priceNgn,
      });
    }
  }

  const labour = findSkuOrCategory('LAB-INST', 'Services');
  if (labour) {
    lines.push({
      sku: labour.sku,
      description: labour.name,
      unit: labour.unit,
      qty: 1,
      unitPriceNgn: labour.priceNgn,
    });
  }

  return lines;
}

export function computeEstimateCostFromCatalog(
  estimate: SolarEstimateResult | null,
  catalog: CatalogItem[],
  taxPercent = 7.5
): { lines: LineItem[]; subtotal: number; tax: number; total: number } {
  if (!estimate || estimate.connectedLoadWatts === 0) {
    return { lines: [], subtotal: 0, tax: 0, total: 0 };
  }
  const lines = buildQuoteLinesFromEstimate(estimate, catalog);
  const totals = calculateDocumentTotals(lines, 0, taxPercent);
  return {
    lines,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
  };
}

export function syncLineItemsWithCatalog(items: LineItem[], catalog: CatalogItem[]): LineItem[] {
  const bySku = new Map(catalog.map((c) => [c.sku, c]));
  return items.map((line) => {
    const match = bySku.get(line.sku);
    if (!match) return line;
    return {
      ...line,
      description: match.name,
      unit: match.unit,
      unitPriceNgn: match.priceNgn,
    };
  });
}

export function calculateDocumentTotals(
  items: LineItem[],
  discountNgn: number,
  taxPercent: number
): { subtotal: number; discount: number; taxable: number; tax: number; total: number } {
  const subtotal = items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.qty) || 0) * Math.max(0, Number(item.unitPriceNgn) || 0),
    0
  );
  const discount = Math.min(subtotal, Math.max(0, Number(discountNgn) || 0));
  const taxable = Math.max(0, subtotal - discount);
  const safeTaxRate = Math.min(100, Math.max(0, Number(taxPercent) || 0));
  const tax = Math.round(taxable * (safeTaxRate / 100));
  const total = Math.round(taxable + tax);
  return { subtotal: Math.round(subtotal), discount: Math.round(discount), taxable: Math.round(taxable), tax, total };
}

export function calculateInvoiceBalance(
  totalNgn: number,
  payments: Pick<PaymentRecord, 'amountNgn' | 'status'>[]
): { confirmedPaid: number; pendingAmount: number; balance: number; isSettled: boolean } {
  let confirmedPaid = 0;
  let pendingAmount = 0;

  for (const p of payments) {
    const amt = Math.max(0, Number(p.amountNgn) || 0);
    if (p.status === 'Confirmed') confirmedPaid += amt;
    else if (p.status === 'Pending') pendingAmount += amt;
  }

  const balance = Math.max(0, Math.round(totalNgn - confirmedPaid));
  return {
    confirmedPaid: Math.round(confirmedPaid),
    pendingAmount: Math.round(pendingAmount),
    balance,
    isSettled: balance <= 1,
  };
}

export type AgeingBand = 'Settled' | 'Current' | '1-30 Days' | '31-60 Days' | '61+ Days';

export function getOverdueAgeBand(dueDateIso: string, balanceNgn: number, todayIso: string): AgeingBand {
  if (balanceNgn <= 1) return 'Settled';
  const due = new Date(dueDateIso.slice(0, 10) + 'T12:00:00Z').getTime();
  const today = new Date(todayIso.slice(0, 10) + 'T12:00:00Z').getTime();
  const days = Math.floor((today - due) / 86400000);
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 Days';
  if (days <= 60) return '31-60 Days';
  return '61+ Days';
}

export function validateInstallationRelease(
  balanceNgn: number,
  releaseType: 'Full Payment' | 'MD Exception',
  releaseNote: string
): { allowed: boolean; reason?: string } {
  if (balanceNgn <= 1 && releaseType === 'Full Payment') {
    return { allowed: true };
  }
  if (balanceNgn > 1 && releaseType === 'Full Payment') {
    return {
      allowed: false,
      reason: 'Invoice has an outstanding balance. Confirm remaining receipts or issue a recorded MD Exception.',
    };
  }
  if (releaseType === 'MD Exception' && releaseNote.trim().length < 8) {
    return {
      allowed: false,
      reason: 'An MD Exception release requires a clear recorded justification (minimum 8 characters).',
    };
  }
  return { allowed: true };
}

export function canUpdateStaffStatusOrRole(
  staffId: string,
  nextRole: UserRole,
  nextStatus: StaffStatus,
  installations: Pick<InstallationRecord, 'assignedEngineerId' | 'currentStage'>[]
): { allowed: boolean; reason?: string } {
  const activeJobs = installations.filter(
    (job) => job.assignedEngineerId === staffId && job.currentStage < 5
  );
  if (activeJobs.length > 0 && (nextRole !== 'technician' || nextStatus !== 'Active')) {
    return {
      allowed: false,
      reason: `Reassign ${activeJobs.length} active installation(s) before changing this technician's role or deactivating access.`,
    };
  }
  return { allowed: true };
}

export function calculateStoreOrderTotals(
  items: { sku: string; name?: string; unit?: string; qty: number; unitPriceNgn?: number; imagePath?: string }[],
  deliveryMethod: OrderDeliveryMethod,
  catalog: CatalogItem[],
  taxPercent = 7.5
): {
  resolvedItems: StoreOrderItem[];
  subtotalNgn: number;
  deliveryFeeNgn: number;
  taxNgn: number;
  totalNgn: number;
} {
  const bySku = new Map(catalog.map((c) => [c.sku, c]));
  const resolvedItems: StoreOrderItem[] = [];

  for (const raw of items) {
    const qty = Math.round(Number(raw.qty) || 0);
    if (qty <= 0) continue;
    const clampedQty = Math.min(999, qty);
    const match = bySku.get(raw.sku);
    const unitPriceNgn = Math.max(0, Number(match ? match.priceNgn : raw.unitPriceNgn) || 0);
    resolvedItems.push({
      sku: match?.sku ?? raw.sku,
      name: match?.name ?? raw.name ?? raw.sku,
      unit: match?.unit ?? raw.unit ?? 'unit',
      qty: clampedQty,
      unitPriceNgn,
      imagePath: match?.imagePath ?? raw.imagePath ?? '',
    });
  }

  const subtotalNgn = Math.round(
    resolvedItems.reduce((sum, it) => sum + it.qty * it.unitPriceNgn, 0)
  );
  const deliveryFeeNgn =
    resolvedItems.length === 0 ||
    deliveryMethod === 'Abuja Warehouse Pickup' ||
    subtotalNgn >= 5000000
      ? 0
      : 25000;
  const safeTaxRate = Math.min(100, Math.max(0, Number(taxPercent) || 0));
  const taxNgn = Math.round(subtotalNgn * (safeTaxRate / 100));
  const totalNgn = subtotalNgn + deliveryFeeNgn + taxNgn;

  return { resolvedItems, subtotalNgn, deliveryFeeNgn, taxNgn, totalNgn };
}
