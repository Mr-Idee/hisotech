import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultEstimatorSettings, normalizeEstimatorSettings } from './estimator-settings';
import type { CatalogItem } from './types';

const catalog: CatalogItem[] = [
  { id: '1', sku: 'INV-3', name: '3kW Hybrid Inverter', itemType: 'equipment', category: 'Hybrid Inverters', unit: 'unit', priceNgn: 1, stockQty: 1, capacityKw: 3, watts: 3000, description: '', imagePath: '' },
  { id: '2', sku: 'BAT-5', name: '5kWh LiFePO4 Battery', itemType: 'equipment', category: 'Lithium Batteries', unit: 'unit', priceNgn: 1, stockQty: 1, capacityKw: 5, watts: null, description: '', imagePath: '' },
  { id: '3', sku: 'PV-500', name: '500W Solar Panel', itemType: 'equipment', category: 'PV Modules', unit: 'panel', priceNgn: 1, stockQty: 1, capacityKw: 0.5, watts: 500, description: '', imagePath: '' },
  { id: '4', sku: 'BOS', name: 'Protection kit', itemType: 'equipment', category: 'Accessories', unit: 'kit', priceNgn: 1, stockQty: 1, capacityKw: null, watts: null, description: '', imagePath: '' },
  { id: '5', sku: 'INSTALL', name: 'Installation & commissioning', itemType: 'service', category: 'Engineering', unit: 'lot', priceNgn: 1, stockQty: 999, capacityKw: null, watts: null, description: '', imagePath: '' },
  { id: '6', sku: 'DELIVERY', name: 'Nationwide logistics', itemType: 'service', category: 'Transport', unit: 'lot', priceNgn: 1, stockQty: 999, capacityKw: null, watts: null, description: '', imagePath: '' },
];

test('default estimator settings map equipment categories and relevant Store services', () => {
  assert.deepEqual(defaultEstimatorSettings(catalog), {
    inverterCategory: 'Hybrid Inverters',
    batteryCategory: 'Lithium Batteries',
    panelCategory: 'PV Modules',
    accessorySkus: ['BOS'],
    installationSkus: ['INSTALL'],
    logisticsSkus: ['DELIVERY'],
  });
});

test('normalization rejects unknown catalog references and accepts valid empty selections', () => {
  const settings = normalizeEstimatorSettings({
    inverterCategory: 'missing',
    batteryCategory: 'Lithium Batteries',
    panelCategory: 'PV Modules',
    accessorySkus: ['BOS', 'UNKNOWN'],
    installationSkus: [],
    logisticsSkus: ['DELIVERY'],
  }, catalog);

  assert.equal(settings.inverterCategory, 'Hybrid Inverters');
  assert.deepEqual(settings.accessorySkus, ['BOS']);
  assert.deepEqual(settings.installationSkus, []);
  assert.deepEqual(settings.logisticsSkus, ['DELIVERY']);
});
