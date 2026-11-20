import type {
  ApplianceItem,
  CatalogItem,
  InstallationRecord,
  LineItem,
  OrderDeliveryMethod,
  PaymentRecord,
  PermissionKey,
  EstimatorSettings,
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
  { key: 'manage_storefront', label: 'Store Prices, Images & Stock', group: 'Catalogue' },
  { key: 'draft_quotes', label: 'Draft & Revise Quotations', group: 'Commercial' },
  { key: 'approve_quotes', label: 'Approve / Reject Quotations', group: 'Executive' },
  { key: 'manage_invoices', label: 'Issue Invoices & Log Receipts', group: 'Finance' },
  { key: 'verify_payments', label: 'Verify Bank Receipts', group: 'Executive' },
  { key: 'release_installations', label: 'Release Jobs for Installation', group: 'Executive' },
  { key: 'update_installations', label: 'Update Field Stages & Site Photos', group: 'Field' },
  { key: 'manage_staff', label: 'Manage Staff Accounts', group: 'Administration' },
  { key: 'manage_roles', label: 'Create & Edit Custom Roles', group: 'Super Admin' },
  { key: 'view_audit', label: 'Inspect Security Audit Logs', group: 'Administration' },
  { key: 'manage_communications', label: 'Send Approved Communications & Push Notifications', group: 'Communications' },
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
    'manage_communications',
  ],
  admin: [
    'manage_enquiries',
    'manage_tickets',
    'manage_storefront',
    'draft_quotes',
    'manage_invoices',
    'manage_staff',
    'view_audit',
    'manage_communications',
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
  const equipmentGrade = opts.equipmentGrade?.trim() || 'Standard';
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

  const recommendedArrayWatts =
    dailyEnergyKwh === 0 || powerMode === 'Grid-backup'
      ? 0
      : Math.ceil((dailyEnergyKwh * (powerMode === 'Off-grid' ? 1.35 : 1.25) * 1000) / peakSunHours);

  const recommendedPanels550w = recommendedArrayWatts === 0
    ? 0
    : Math.max(2, Math.ceil(recommendedArrayWatts / 550));

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
    recommendedArrayWatts,
    equipmentGrade,
  };
}

export interface UndeterminedEstimateComponent {
  key: 'inverter' | 'panel' | 'battery';
  label: string;
  requirement: string;
}

export interface EstimateCostBreakdown {
  lines: LineItem[];
  subtotal: number;
  tax: number;
  total: number | undefined;
  undetermined: UndeterminedEstimateComponent[];
}

function chooseRepeatedCapacityLine(
  items: CatalogItem[],
  requiredCapacity: number,
  capacityFor: (item: CatalogItem) => number,
  minQty = 1
): LineItem | undefined {
  const options = items
    .filter((item) => item.priceNgn > 0 && capacityFor(item) > 0)
    .map((item) => {
      const capacity = capacityFor(item);
      const qty = Math.max(minQty, Math.ceil(requiredCapacity / capacity));
      return {
        item,
        qty,
        totalPrice: qty * item.priceNgn,
        oversupply: qty * capacity - requiredCapacity,
      };
    })
    .filter((option) => option.qty <= Math.max(0, Math.floor(option.item.stockQty)))
    .sort((a, b) =>
      a.totalPrice - b.totalPrice
      || a.oversupply - b.oversupply
      || a.qty - b.qty
      || a.item.sku.localeCompare(b.item.sku)
    );
  const selected = options[0];
  if (!selected) return undefined;
  return {
    sku: selected.item.sku,
    description: selected.item.name,
    unit: selected.item.unit,
    qty: selected.qty,
    unitPriceNgn: selected.item.priceNgn,
  };
}

export function buildQuoteLinesFromEstimate(
  estimate: SolarEstimateResult | null,
  catalog: CatalogItem[],
  settings?: EstimatorSettings
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

  const grade = estimate.equipmentGrade?.trim().toLowerCase() || 'standard';
  const inverterCategory = settings?.inverterCategory ?? 'Inverters';
  const batteryCategory = settings?.batteryCategory ?? 'Battery Storage';
  const panelCategory = settings?.panelCategory ?? 'Solar Panels';
  const parallelInverterSkus = new Set(settings?.parallelInverterSkus ?? []);
  const filterGrade = (items: CatalogItem[]) => {
    const matchingGrade = items.filter((item) => item.grade?.trim().toLowerCase() === grade);
    const ungraded = items.filter((item) => !item.grade?.trim());
    if (matchingGrade.length > 0) return matchingGrade;
    return ungraded.length > 0 ? ungraded : items;
  };

  const lines: LineItem[] = [];
  const inverterCandidates = filterGrade(hardwareAndServices.filter(
    (item) => item.itemType === 'equipment'
      && item.category === inverterCategory
      && (item.capacityKw ?? 0) > 0
      && item.priceNgn > 0
      && item.stockQty >= 1
  ));
  const suitableSingleInverter = inverterCandidates
    .filter((item) => (item.capacityKw ?? 0) >= estimate.inverterMinKw)
    .sort((a, b) =>
      (a.capacityKw ?? 0) - (b.capacityKw ?? 0)
      || a.priceNgn - b.priceNgn
      || a.sku.localeCompare(b.sku)
    )[0];
  const chosenInverter = suitableSingleInverter
    ? {
        sku: suitableSingleInverter.sku,
        description: suitableSingleInverter.name,
        unit: suitableSingleInverter.unit,
        qty: 1,
        unitPriceNgn: suitableSingleInverter.priceNgn,
      }
    : chooseRepeatedCapacityLine(
        inverterCandidates.filter((item) => parallelInverterSkus.has(item.sku)),
        estimate.inverterMinKw,
        (item) => item.capacityKw ?? 0
      );
  const requiredArrayWatts = estimate.recommendedArrayWatts ?? estimate.recommendedPanels550w * 550;
  const panelCandidates = filterGrade(hardwareAndServices.filter(
    (item) => item.itemType === 'equipment'
      && item.category === panelCategory
      && (item.watts ?? 0) > 0
  ));
  const selectedPanel = requiredArrayWatts > 0
    ? chooseRepeatedCapacityLine(panelCandidates, requiredArrayWatts, (item) => item.watts ?? 0, 2)
    : undefined;
  if (selectedPanel) lines.push(selectedPanel);
  if (chosenInverter) lines.push(chosenInverter);

  const batteryCandidates = filterGrade(
    hardwareAndServices.filter((item) =>
      item.itemType === 'equipment'
      && item.category === batteryCategory
      && (item.capacityKw ?? 0) > 0
    )
  );
  const selectedBattery = estimate.batteryTargetKwh > 0
    ? chooseRepeatedCapacityLine(batteryCandidates, estimate.batteryTargetKwh, (item) => item.capacityKw ?? 0)
    : undefined;
  if (selectedBattery) lines.push(selectedBattery);

  const coreCategories = new Set([panelCategory, inverterCategory, batteryCategory]);
  const accessories = settings
    ? hardwareAndServices.filter((item) => item.itemType === 'equipment'
      && settings.accessorySkus.includes(item.sku) && !coreCategories.has(item.category))
    : [...new Set(
        hardwareAndServices
          .filter((item) => item.itemType === 'equipment' && !coreCategories.has(item.category))
          .map((item) => item.category)
      )].flatMap((category) =>
        filterGrade(hardwareAndServices.filter((item) => item.itemType === 'equipment' && item.category === category))
      );
  for (const accessory of accessories) {
    lines.push({
      sku: accessory.sku,
      description: accessory.name,
      unit: accessory.unit,
      qty: 1,
      unitPriceNgn: accessory.priceNgn,
    });
  }

  const services = hardwareAndServices.filter((item) => item.itemType === 'service');
  const installations = settings
    ? services.filter((item) => settings.installationSkus.includes(item.sku))
    : filterGrade(services.filter((item) =>
        /install|commission|survey/i.test(`${item.category} ${item.name} ${item.sku}`)
      )).slice(0, 1);
  for (const installation of installations) {
    lines.push({
      sku: installation.sku,
      description: installation.name,
      unit: installation.unit,
      qty: 1,
      unitPriceNgn: installation.priceNgn,
    });
  }
  const logistics = settings
    ? services.filter((item) => settings.logisticsSkus.includes(item.sku))
    : filterGrade(
        services.filter((item) => /logistic|delivery|transport/i.test(`${item.category} ${item.name} ${item.sku}`))
      );
  for (const item of logistics) {
    lines.push({
      sku: item.sku,
      description: item.name,
      unit: item.unit,
      qty: 1,
      unitPriceNgn: item.priceNgn,
    });
  }

  return lines;
}

export function computeEstimateCostFromCatalog(
  estimate: SolarEstimateResult | null,
  catalog: CatalogItem[],
  taxPercent = 7.5,
  settings?: EstimatorSettings
): EstimateCostBreakdown {
  if (!estimate || estimate.connectedLoadWatts === 0) {
    return { lines: [], subtotal: 0, tax: 0, total: undefined, undetermined: [] };
  }
  const lines = buildQuoteLinesFromEstimate(estimate, catalog, settings);
  const requirements: UndeterminedEstimateComponent[] = [
    { key: 'inverter', label: 'Inverter', requirement: `Requires at least ${estimate.inverterMinKw} kW.` },
    ...((estimate.recommendedArrayWatts ?? estimate.recommendedPanels550w * 550) > 0
      ? [{
          key: 'panel' as const,
          label: 'Solar panels',
          requirement: `Requires ${estimate.recommendedArrayWatts ?? estimate.recommendedPanels550w * 550} W of solar capacity.`,
        }]
      : []),
    ...(estimate.batteryTargetKwh > 0
      ? [{
          key: 'battery' as const,
          label: 'Battery',
          requirement: `Requires ${estimate.batteryTargetKwh} kWh of storage.`,
        }]
      : []),
  ];
  const componentCategories = {
    inverter: settings?.inverterCategory ?? 'Inverters',
    panel: settings?.panelCategory ?? 'Solar Panels',
    battery: settings?.batteryCategory ?? 'Battery Storage',
  };
  const selectedSkus = new Set(lines.map((line) => line.sku));
  const undetermined = requirements.filter((requirement) => {
    const category = componentCategories[requirement.key];
    return !catalog.some((item) =>
      item.category === category && selectedSkus.has(item.sku)
    );
  });
  const totals = calculateDocumentTotals(lines, 0, taxPercent);
  return {
    lines,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: undetermined.length === 0 ? totals.total : undefined,
    undetermined,
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
