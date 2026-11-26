import assert from 'node:assert/strict';
import test from 'node:test';
import {
  migrateLegacyOfflineEstimatesToMemory,
  persistOfflineEstimates,
  readOfflineEstimates,
  type PendingOfflineEstimate,
} from './offline-estimate-storage';

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

function entry(localId: string, savedAt: string): PendingOfflineEstimate {
  return {
    localId,
    savedAt,
    customerName: 'Customer',
    email: 'customer@example.com',
    phone: '+2348012345678',
    location: 'Abuja',
    needSummary: 'Solar estimate',
    appliances: [{ id: 'light', name: 'Light', qty: 1, watts: 10, hours: 2 }],
    estimate: {
      connectedLoadWatts: 10,
      dailyEnergyKwh: 0.02,
      inverterMinKw: 1,
      batteryTargetKwh: 1,
      recommendedPanels550w: 1,
      recommendedBatteries5kwh: 1,
    },
  };
}

test('legacy offline customer records are migrated to memory and expired entries are removed', () => {
  const originalWindow = globalThis.window;
  const localStorage = new FakeStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });

  try {
    const stored = [
      entry('fresh', new Date().toISOString()),
      entry('expired', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()),
    ];
    localStorage.setItem('hiso_offline_estimates_queue', JSON.stringify(stored));

    migrateLegacyOfflineEstimatesToMemory();

    assert.equal(localStorage.getItem('hiso_offline_estimates_queue'), null);
    assert.deepEqual(readOfflineEstimates().map((item) => item.localId), ['fresh']);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('in-memory offline queue caps retained records and supports immediate clearing', () => {
  const originalWindow = globalThis.window;
  const localStorage = new FakeStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });

  try {
    const records = Array.from({ length: 25 }, (_, index) =>
      entry(`estimate-${index}`, new Date().toISOString())
    );
    persistOfflineEstimates(records);
    assert.equal(readOfflineEstimates().length, 20);

    persistOfflineEstimates([]);
    assert.deepEqual(readOfflineEstimates(), []);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
