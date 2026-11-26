import type { ApplianceItem, SolarEstimateResult } from './types';

const STORAGE_KEY = 'hiso_offline_estimates_queue';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE_SIZE = 20;
let queue: PendingOfflineEstimate[] = [];
let initialized = false;

export interface PendingOfflineEstimate {
  localId: string;
  savedAt: string;
  customerName: string;
  email: string;
  phone: string;
  location: string;
  needSummary: string;
  appliances: ApplianceItem[];
  estimate: SolarEstimateResult;
  whatsappUpdatesConsent?: boolean;
  whatsappMarketingConsent?: boolean;
}

function freshEntries(entries: unknown): PendingOfflineEstimate[] {
  if (!Array.isArray(entries)) return [];
  const now = Date.now();
  return (entries as PendingOfflineEstimate[])
    .filter((entry) => {
      const savedAt = Date.parse(entry?.savedAt || '');
      return Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= MAX_AGE_MS;
    })
    .slice(0, MAX_QUEUE_SIZE);
}

export function migrateLegacyOfflineEstimatesToMemory(): void {
  if (initialized) return;
  initialized = true;
  try {
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (legacy !== null) {
      try {
        queue = freshEntries(JSON.parse(legacy));
      } catch {
        queue = [];
      }
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    queue = [];
  }
}

export function readOfflineEstimates(): PendingOfflineEstimate[] {
  migrateLegacyOfflineEstimatesToMemory();
  queue = freshEntries(queue);
  return [...queue];
}

export function persistOfflineEstimates(entries: PendingOfflineEstimate[]): void {
  migrateLegacyOfflineEstimatesToMemory();
  queue = freshEntries(entries);
}
