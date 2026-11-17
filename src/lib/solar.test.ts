import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItem, InstallationRecord } from './types';
import {
  calculateDocumentTotals,
  calculateInvoiceBalance,
  calculateSolarEstimate,
  calculateStoreOrderTotals,
  canUpdateStaffStatusOrRole,
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

test('computeEstimateCostFromCatalog & syncLineItemsWithCatalog reflect updated Storefront prices immediately', () => {
  const est = calculateSolarEstimate([
    { id: '1', name: 'Office Load', qty: 2, watts: 1000, hours: 6 },
  ]);
  const before = computeEstimateCostFromCatalog(est, SAMPLE_CATALOG, 7.5);
  assert.ok(before.total > 0);

  const updatedCatalog = SAMPLE_CATALOG.map((item) =>
    item.sku === 'BAT-512L' ? { ...item, priceNgn: item.priceNgn + 250000 } : item
  );
  const after = computeEstimateCostFromCatalog(est, updatedCatalog, 7.5);
  assert.ok(after.subtotal > before.subtotal);

  const synced = syncLineItemsWithCatalog(before.lines, updatedCatalog);
  const batteryLine = synced.find((l) => l.sku === 'BAT-512L');
  assert.equal(batteryLine?.unitPriceNgn, 1750000);
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

test('calculateStoreOrderTotals resolves catalog prices, delivery threshold, and 7.5% VAT', () => {
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
  assert.equal(deliveryUnder5m.deliveryFeeNgn, 25000);
  assert.equal(deliveryUnder5m.totalNgn, 320000 + 25000 + 24000);

  const deliveryFreeOver5m = calculateStoreOrderTotals(
    [{ sku: 'BAT-512L', qty: 4 }],
    'Nationwide Delivery',
    SAMPLE_CATALOG
  );
  assert.equal(deliveryFreeOver5m.subtotalNgn, 6000000);
  assert.equal(deliveryFreeOver5m.deliveryFeeNgn, 0);
});
