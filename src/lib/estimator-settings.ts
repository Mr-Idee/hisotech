import type { CatalogItem, EstimatorSettings } from './types';

const CORE_CATEGORIES = {
  inverter: 'Inverters',
  battery: 'Battery Storage',
  panel: 'Solar Panels',
} as const;

export function defaultEstimatorSettings(catalog: CatalogItem[]): EstimatorSettings {
  const categoriesFor = (itemType: CatalogItem['itemType']) =>
    [...new Set(catalog.filter((item) => item.itemType === itemType).map((item) => item.category))];
  const chooseCategory = (itemType: CatalogItem['itemType'], preferred: string, match: RegExp) => {
    const categories = categoriesFor(itemType);
    return categories.includes(preferred) ? preferred : categories.find((category) => match.test(category)) ?? preferred;
  };
  const coreCategories = new Set([
    chooseCategory('equipment', CORE_CATEGORIES.inverter, /inverter/i),
    chooseCategory('equipment', CORE_CATEGORIES.battery, /batter/i),
    chooseCategory('equipment', CORE_CATEGORIES.panel, /solar|panel|module|pv/i),
  ]);
  const services = catalog.filter((item) => item.itemType === 'service');

  return {
    inverterCategory: chooseCategory('equipment', CORE_CATEGORIES.inverter, /inverter/i),
    parallelInverterSkus: [],
    batteryCategory: chooseCategory('equipment', CORE_CATEGORIES.battery, /batter/i),
    panelCategory: chooseCategory('equipment', CORE_CATEGORIES.panel, /solar|panel|module|pv/i),
    accessorySkus: catalog
      .filter((item) => item.itemType === 'equipment' && !coreCategories.has(item.category)
        && item.category !== chooseCategory('equipment', CORE_CATEGORIES.inverter, /inverter/i)
        && item.category !== chooseCategory('equipment', CORE_CATEGORIES.battery, /batter/i)
        && item.category !== chooseCategory('equipment', CORE_CATEGORIES.panel, /solar|panel|module|pv/i))
      .map((item) => item.sku),
    installationSkus: services
      .filter((item) => /install|commission|survey/i.test(`${item.category} ${item.name} ${item.sku}`))
      .slice(0, 1)
      .map((item) => item.sku),
    logisticsSkus: services
      .filter((item) => /logistic|delivery|transport/i.test(`${item.category} ${item.name} ${item.sku}`))
      .map((item) => item.sku),
  };
}

export function normalizeEstimatorSettings(value: unknown, catalog: CatalogItem[]): EstimatorSettings {
  const defaults = defaultEstimatorSettings(catalog);
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const categoriesFor = (itemType: CatalogItem['itemType']) =>
    new Set(catalog.filter((item) => item.itemType === itemType).map((item) => item.category));
  const safeCategory = (key: 'inverterCategory' | 'batteryCategory' | 'panelCategory', itemType: CatalogItem['itemType']) =>
    typeof source[key] === 'string' && (catalog.length === 0 || categoriesFor(itemType).has(source[key] as string))
      ? source[key] as string
      : defaults[key];
  const safeSkus = (key: 'accessorySkus' | 'installationSkus' | 'logisticsSkus', itemType: CatalogItem['itemType']) => {
    if (!Array.isArray(source[key])) return defaults[key];
    const allowed = new Set(catalog.filter((item) => item.itemType === itemType).map((item) => item.sku));
    return [...new Set(source[key].filter((sku): sku is string => typeof sku === 'string' && allowed.has(sku)))];
  };
  const inverterCategory = safeCategory('inverterCategory', 'equipment');
  const parallelInverterSkus = Array.isArray(source.parallelInverterSkus)
    ? [...new Set(source.parallelInverterSkus.filter((sku): sku is string =>
      typeof sku === 'string' && catalog.some((item) =>
        item.sku === sku
        && item.itemType === 'equipment'
        && item.category === inverterCategory
        && (item.capacityKw ?? 0) > 0
      )
    ))]
    : [];

  return {
    inverterCategory,
    parallelInverterSkus,
    batteryCategory: safeCategory('batteryCategory', 'equipment'),
    panelCategory: safeCategory('panelCategory', 'equipment'),
    accessorySkus: safeSkus('accessorySkus', 'equipment'),
    installationSkus: safeSkus('installationSkus', 'service'),
    logisticsSkus: safeSkus('logisticsSkus', 'service'),
  };
}
