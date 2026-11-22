import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItem, EstimatorSettings, InstallationRecord, SolarEstimateResult } from './types';
import {
  calculateDocumentTotals,
  calculateInvoiceBalance,
  calculateSolarEstimate,
  calculateStoreOrderTotals,
  canUpdateStaffStatusOrRole,
  buildQuoteLinesFromEstimate,
  computeEstimateCostFromCatalog,
  getOverdueAgeBand,
  hasPermission,
  syncLineItemsWithCatalog,
  validateInstallationRelease,
} from './solar';

const SAMPLE_CATALOG: CatalogItem[] = [
  {
    id: 'cat-1',
    sku: 'PV-550M',
    name: '550W Monocrystalline Tier-1 Solar Panel',
    itemType: 'equipment',
    category: 'Solar Panels',
    unit: 'panel',
    priceNgn: 160000,
    stockQty: 50,
    capacityKw: 0.55,
    watts: 550,
    description: 'High-efficiency monocrystalline PV module',
    imagePath: '/src/assets/images/store_solar_panel_1794824378149.jpg',
  },
  {
    id: 'cat-2',
    sku: 'INV-5K-HYB',
    name: '5kW Hybrid MPPT Solar Inverter',
    itemType: 'equipment',
    category: 'Inverters',
    unit: 'unit',
    priceNgn: 1100000,
    stockQty: 8,
    capacityKw: 5,
    watts: 5000,
    description: 'Hybrid solar inverter',
    imagePath: '/src/assets/images/catalog_hybrid_inverter_1794819207311.jpg',
  },
  {
    id: 'cat-3',
    sku: 'BAT-512L',
    name: '5.12kWh LiFePO4 Lithium Battery',
    itemType: 'equipment',
    category: 'Battery Storage',
    unit: 'unit',
    priceNgn: 1500000,
    stockQty: 12,
    capacityKw: 5.12,
    watts: null,
    description: '6000-cycle lithium storage module',
    imagePath: '/src/assets/images/store_lithium_battery_1794824377691.jpg',
  },
  {
    id: 'cat-4',
    sku: 'LAB-INST',
    name: 'Engineering Survey & Commissioning',
    itemType: 'service',
    category: 'Services',
    unit: 'lot',
    priceNgn: 350000,
    stockQty: 999,
    capacityKw: null,
    watts: null,
    description: 'Turnkey labour and testing',
    imagePath: '/assets/site/project-7-survey-team.jpg',
  },
];

test('calculateSolarEstimate sizes inverter, panels, and batteries accurately across power modes', () => {
  const appliances = [
    { id: '1', name: 'LED', qty: 10, watts: 10, hours: 6 },
    { id: '2', name: 'Fridge', qty: 1, watts: 200, hours: 10 },
    { id: '3', name: 'AC', qty: 1, watts: 1200, hours: 4 },
  ];
  const hybrid = calculateSolarEstimate(appliances, { powerMode: 'Hybrid', peakSunHours: 4.5 });
  assert.equal(hybrid.connectedLoadWatts, 1500);
  assert.equal(hybrid.dailyEnergyKwh, 7.4);
  assert.equal(hybrid.inverterMinKw, 3);
  assert.ok(hybrid.recommendedPanels550w >= 3);
  assert.ok(hybrid.recommendedBatteries5kwh >= 1);

  const offGrid = calculateSolarEstimate(appliances, { powerMode: 'Off-grid', autonomyHours: 18, peakSunHours: 4.5 });
  assert.ok(offGrid.batteryTargetKwh > hybrid.batteryTargetKwh);
  assert.ok(offGrid.recommendedPanels550w >= hybrid.recommendedPanels550w);

  const gridBackup = calculateSolarEstimate(appliances, { powerMode: 'Grid-backup' });
  assert.equal(gridBackup.recommendedPanels550w, 0);
});

test('computeEstimateCostFromCatalog & syncLineItemsWithCatalog reflect updated Store prices immediately', () => {
  const est = calculateSolarEstimate([
    { id: '1', name: 'Office Load', qty: 2, watts: 1000, hours: 6 },
  ]);
  const before = computeEstimateCostFromCatalog(est, SAMPLE_CATALOG, 7.5);
  assert.ok(before.total !== undefined && before.total > 0);

  const updatedCatalog = SAMPLE_CATALOG.map((item) =>
    item.sku === 'BAT-512L' ? { ...item, priceNgn: item.priceNgn + 250000 } : item
  );
  const after = computeEstimateCostFromCatalog(est, updatedCatalog, 7.5);
  assert.ok(after.subtotal > before.subtotal);

  const synced = syncLineItemsWithCatalog(before.lines, updatedCatalog);
  const batteryLine = synced.find((l) => l.sku === 'BAT-512L');
  assert.equal(batteryLine?.unitPriceNgn, 1750000);
});

test('quote sizing follows selected catalog grade and component capacities', () => {
  const premiumCatalog: CatalogItem[] = [
    ...SAMPLE_CATALOG,
    {
      ...SAMPLE_CATALOG[0],
      id: 'cat-pv-premium',
      sku: 'PV-1000-PREMIUM',
      name: '1000W Premium Solar Panel',
      grade: 'Premium',
      priceNgn: 250000,
      watts: 1000,
    },
    {
      ...SAMPLE_CATALOG[2],
      id: 'cat-bat-premium',
      sku: 'BAT-10-PREMIUM',
      name: '10kWh Premium Battery',
      grade: 'Premium',
      priceNgn: 2500000,
      capacityKw: 10,
    },
    {
      ...SAMPLE_CATALOG[1],
      id: 'cat-inv-premium',
      sku: 'INV-5K-PREMIUM',
      name: '5kW Premium Inverter',
      grade: 'Premium',
      priceNgn: 1400000,
    },
  ];
  const estimate = calculateSolarEstimate(
    [{ id: 'load', name: 'Load', qty: 1, watts: 2000, hours: 8 }],
    { powerMode: 'Hybrid', equipmentGrade: 'Premium' }
  );
  const lines = buildQuoteLinesFromEstimate(estimate, premiumCatalog);
  const panel = lines.find((line) => line.sku === 'PV-1000-PREMIUM');
  const battery = lines.find((line) => line.sku === 'BAT-10-PREMIUM');
  assert.equal(panel?.qty, Math.max(2, Math.ceil((estimate.recommendedArrayWatts ?? 0) / 1000)));
  assert.equal(battery?.qty, Math.ceil(estimate.batteryTargetKwh / 10));
  assert.equal(lines.find((line) => line.sku === 'INV-5K-PREMIUM')?.unitPriceNgn, 1400000);
});

test('estimate pricing includes only core equipment and marks accessories and services as TBD', () => {
  const configuredCatalog: CatalogItem[] = [
    { ...SAMPLE_CATALOG[0], category: 'PV Modules' },
    { ...SAMPLE_CATALOG[1], category: 'Hybrid Inverters' },
    { ...SAMPLE_CATALOG[2], category: 'Lithium Storage' },
    { ...SAMPLE_CATALOG[3], id: 'accessory', sku: 'BOS-KIT', name: 'Panel mounting rack', itemType: 'equipment', category: 'Balance of System' },
    { ...SAMPLE_CATALOG[3], id: 'installation', sku: 'INSTALL', name: 'Installation & commissioning', itemType: 'service', category: 'Engineering' },
    { ...SAMPLE_CATALOG[3], id: 'delivery', sku: 'DELIVERY', name: 'Nationwide delivery', itemType: 'service', category: 'Logistics', priceNgn: 25000 },
    { ...SAMPLE_CATALOG[3], id: 'unselected', sku: 'EXTRA', name: 'Unselected extra service', itemType: 'service', category: 'Other' },
  ];
  const settings: EstimatorSettings = {
    inverterCategory: 'Hybrid Inverters',
    parallelInverterSkus: [],
    batteryCategory: 'Lithium Storage',
    panelCategory: 'PV Modules',
    accessorySkus: ['BOS-KIT'],
    installationSkus: ['INSTALL'],
    logisticsSkus: ['DELIVERY'],
  };
  const estimate = calculateSolarEstimate([
    { id: 'load', name: 'Load', qty: 1, watts: 1500, hours: 6 },
  ]);
  const lines = buildQuoteLinesFromEstimate(estimate, configuredCatalog, settings);

  assert.deepEqual(lines.map((line) => line.sku), [
    'PV-550M',
    'INV-5K-HYB',
    'BAT-512L',
    'TBD-ACCESSORIES',
    'TBD-INSTALLATION',
    'TBD-LOGISTICS',
  ]);
  assert.ok(lines.filter((line) => line.sku.startsWith('TBD-')).every((line) => line.isTbd));
  assert.equal(lines.find((line) => line.sku === 'INSTALL')?.unitPriceNgn, undefined);
  assert.equal(lines.find((line) => line.sku === 'DELIVERY')?.unitPriceNgn, undefined);
});

test('estimate pricing does not show a partial total when required catalog equipment is missing', () => {
  const estimate = calculateSolarEstimate([
    { id: 'load', name: 'Load', qty: 1, watts: 1000, hours: 5 },
  ]);
  assert.equal(computeEstimateCostFromCatalog(estimate, []).lines.filter((line) => line.isTbd).length, 6);
  const missing = computeEstimateCostFromCatalog(estimate, SAMPLE_CATALOG.slice(0, 1));
  assert.equal(missing.total, undefined);
  assert.ok(missing.undetermined.some((item) => item.key === 'inverter'));
});

test('only admin-approved inverter models can be combined to meet higher loads', () => {
  const estimate: SolarEstimateResult = {
    connectedLoadWatts: 9000,
    dailyEnergyKwh: 20,
    inverterMinKw: 9,
    batteryTargetKwh: 0,
    recommendedPanels550w: 0,
    recommendedBatteries5kwh: 0,
    recommendedArrayWatts: 0,
    equipmentGrade: 'Standard',
  };
  const settings: EstimatorSettings = {
    inverterCategory: 'Inverters',
    parallelInverterSkus: [],
    batteryCategory: 'Battery Storage',
    panelCategory: 'Solar Panels',
    accessorySkus: [],
    installationSkus: [],
    logisticsSkus: [],
  };
  const singleOnly = computeEstimateCostFromCatalog(estimate, SAMPLE_CATALOG, 7.5, settings);
  assert.equal(singleOnly.total, undefined);
  assert.deepEqual(singleOnly.undetermined.map((item) => item.key), ['inverter']);

  const parallelApproved = computeEstimateCostFromCatalog(
    estimate,
    SAMPLE_CATALOG,
    7.5,
    { ...settings, parallelInverterSkus: ['INV-5K-HYB'] }
  );
  assert.equal(parallelApproved.lines.find((line) => line.sku === 'INV-5K-HYB')?.qty, 2);
  assert.equal(parallelApproved.undetermined.length, 0);
  assert.ok(parallelApproved.total && parallelApproved.total > 0);

  const insufficientStock = computeEstimateCostFromCatalog(
    estimate,
    SAMPLE_CATALOG.map((item) => item.sku === 'INV-5K-HYB' ? { ...item, stockQty: 1 } : item),
    7.5,
    { ...settings, parallelInverterSkus: ['INV-5K-HYB'] }
  );
  assert.deepEqual(insufficientStock.undetermined.map((item) => item.key), ['inverter']);
});

test('hasPermission enforces superadmin wildcard and custom role permissions', () => {
  assert.equal(hasPermission({ role: 'superadmin', permissions: [] }, 'manage_roles'), true);
  assert.equal(hasPermission({ role: 'director', permissions: ['approve_quotes', 'verify_payments'] }, 'manage_roles'), false);
  assert.equal(hasPermission({ role: 'admin', permissions: ['manage_tickets', 'manage_storefront'] }, 'manage_tickets'), true);
  assert.equal(hasPermission({ role: 'pricing_officer', permissions: ['manage_storefront'] }, 'manage_storefront'), true);
  assert.equal(hasPermission({ role: 'pricing_officer', permissions: ['manage_storefront'] }, 'verify_payments'), false);
});

test('calculateDocumentTotals clamps discounts and computes tax cleanly', () => {
  const totals = calculateDocumentTotals(
    [
      { sku: 'PV-550M', description: 'Panel', unit: 'pcs', qty: 4, unitPriceNgn: 145000 },
      { sku: 'LAB', description: 'Labour', unit: 'lot', qty: 1, unitPriceNgn: 120000 },
    ],
    50000,
    7.5
  );
  assert.equal(totals.subtotal, 700000);
  assert.equal(totals.discount, 50000);
  assert.equal(totals.taxable, 650000);
  assert.equal(totals.tax, 48750);
  assert.equal(totals.total, 698750);
});

test('calculateInvoiceBalance only counts MD-Confirmed payments', () => {
  const summary = calculateInvoiceBalance(2500000, [
    { amountNgn: 1000000, status: 'Confirmed' },
    { amountNgn: 750000, status: 'Pending' },
    { amountNgn: 500000, status: 'Rejected' },
  ]);
  assert.equal(summary.confirmedPaid, 1000000);
  assert.equal(summary.pendingAmount, 750000);
  assert.equal(summary.balance, 1500000);
  assert.equal(summary.isSettled, false);
});

test('getOverdueAgeBand classifies due invoices accurately', () => {
  assert.equal(getOverdueAgeBand('2026-11-10', 0, '2026-12-20'), 'Settled');
  assert.equal(getOverdueAgeBand('2026-11-20', 50000, '2026-11-16'), 'Current');
  assert.equal(getOverdueAgeBand('2026-11-01', 50000, '2026-11-16'), '1-30 Days');
  assert.equal(getOverdueAgeBand('2026-10-01', 50000, '2026-11-16'), '31-60 Days');
  assert.equal(getOverdueAgeBand('2026-08-01', 50000, '2026-11-16'), '61+ Days');
});

test('validateInstallationRelease blocks unpaid Full Payment but allows documented MD Exception', () => {
  assert.equal(validateInstallationRelease(500000, 'Full Payment', '').allowed, false);
  assert.equal(validateInstallationRelease(500000, 'MD Exception', 'short').allowed, false);
  assert.equal(
    validateInstallationRelease(500000, 'MD Exception', '70% verified deposit; balance upon commissioning').allowed,
    true
  );
  assert.equal(validateInstallationRelease(0, 'Full Payment', '').allowed, true);
});

test('canUpdateStaffStatusOrRole blocks deactivating technician with open installations', () => {
  const jobs: Pick<InstallationRecord, 'assignedEngineerId' | 'currentStage'>[] = [
    { assignedEngineerId: 'eng-1', currentStage: 3 },
  ];
  assert.equal(canUpdateStaffStatusOrRole('eng-1', 'technician', 'Inactive', jobs).allowed, false);
  assert.equal(canUpdateStaffStatusOrRole('eng-1', 'admin', 'Active', jobs).allowed, false);
  assert.equal(canUpdateStaffStatusOrRole('eng-1', 'technician', 'Active', jobs).allowed, true);
});

test('calculateStoreOrderTotals leaves delivery TBD and applies VAT to product subtotal', () => {
  const pickup = calculateStoreOrderTotals(
    [{ sku: 'PV-550M', qty: 2, unitPriceNgn: 1 }],
    'Abuja Warehouse Pickup',
    SAMPLE_CATALOG
  );
  assert.equal(pickup.resolvedItems.length, 1);
  assert.equal(pickup.resolvedItems[0].unitPriceNgn, 160000);
  assert.equal(pickup.subtotalNgn, 320000);
  assert.equal(pickup.deliveryFeeNgn, 0);
  assert.equal(pickup.taxNgn, 24000);
  assert.equal(pickup.totalNgn, 344000);

  const deliveryUnder5m = calculateStoreOrderTotals(
    [{ sku: 'PV-550M', qty: 2 }],
    'Nationwide Delivery',
    SAMPLE_CATALOG
  );
  assert.equal(deliveryUnder5m.deliveryFeeNgn, 0);
  assert.equal(deliveryUnder5m.totalNgn, 320000 + 24000);

  const deliveryFreeOver5m = calculateStoreOrderTotals(
    [{ sku: 'BAT-512L', qty: 4 }],
    'Nationwide Delivery',
    SAMPLE_CATALOG
  );
  assert.equal(deliveryFreeOver5m.subtotalNgn, 6000000);
  assert.equal(deliveryFreeOver5m.deliveryFeeNgn, 0);
  assert.equal(deliveryFreeOver5m.totalNgn, 6450000);
});
