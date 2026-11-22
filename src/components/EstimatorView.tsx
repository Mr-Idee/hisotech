import {
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { api } from '../lib/api';
import { notifyUser } from '../lib/notifications';
import {
  calculateSolarEstimate,
  computeEstimateCostFromCatalog,
  DEFAULT_APPLIANCES,
  formatNgn,
} from '../lib/solar';
import type { ApplianceItem, CatalogItem, EstimatorSettings, PowerMode, SolarEstimateResult } from '../lib/types';

interface PendingOfflineEstimate {
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

const OFFLINE_QUEUE_KEY = 'hiso_offline_estimates_queue';

interface EstimatorViewProps {
  catalog: CatalogItem[];
  settings: EstimatorSettings;
  importedAppliances?: ApplianceItem[];
  onClearImported?: () => void;
  onOpenStore: () => void;
  onTrackRef: (refCode: string) => void;
}

const COMMERCIAL_PRESET: ApplianceItem[] = [
  { id: 'c-led', name: 'Office LED Panels', qty: 24, watts: 36, hours: 9 },
  { id: 'c-pc', name: 'Workstations & Monitors', qty: 10, watts: 180, hours: 8 },
  { id: 'c-ac', name: '2HP Inverter Split AC', qty: 2, watts: 1500, hours: 6 },
  { id: 'c-srv', name: 'Network Rack & Server', qty: 1, watts: 450, hours: 24 },
];

function readOfflineQueue(): PendingOfflineEstimate[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function EstimatorView({
  catalog,
  settings,
  importedAppliances = [],
  onClearImported,
  onOpenStore,
  onTrackRef,
}: EstimatorViewProps) {
  const isOnline = useOnlineStatus();
  const [appliances, setAppliances] = useState<ApplianceItem[]>(DEFAULT_APPLIANCES);
  const [powerMode, setPowerMode] = useState<PowerMode>('Hybrid');
  const [autonomyHours, setAutonomyHours] = useState(10);
  const [peakSunHours, setPeakSunHours] = useState(4.5);
  const [usableDepthPercent, setUsableDepthPercent] = useState(85);
  const [equipmentGrade, setEquipmentGrade] = useState('Standard');
  const equipmentGrades = useMemo(
    () => [...new Set(catalog.map((item) => item.grade?.trim()).filter((grade): grade is string => Boolean(grade)))].sort(),
    [catalog]
  );

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [needSummary, setNeedSummary] = useState('');
  const [whatsappUpdatesConsent, setWhatsappUpdatesConsent] = useState(false);
  const [whatsappMarketingConsent, setWhatsappMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [error, setError] = useState('');
  const [submittedRef, setSubmittedRef] = useState('');
  const [submittedQuoteCode, setSubmittedQuoteCode] = useState('');
  const [offlineSavedBanner, setOfflineSavedBanner] = useState('');
  const [offlineQueue, setOfflineQueue] = useState<PendingOfflineEstimate[]>(() => readOfflineQueue());

  // Append appliances sent from the Store.
  useEffect(() => {
    if (importedAppliances.length > 0) {
      setAppliances((prev) => {
        const merged = [...prev];
        for (const incoming of importedAppliances) {
          if (!merged.some((m) => m.id === incoming.id)) {
            merged.push(incoming);
          }
        }
        return merged;
      });
      onClearImported?.();
    }
  }, [importedAppliances, onClearImported]);

  function persistQueue(next: PendingOfflineEstimate[]) {
    setOfflineQueue(next);
    try {
      window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }

  const estimate = useMemo(
    () =>
      calculateSolarEstimate(appliances, {
        powerMode,
        autonomyHours,
        peakSunHours,
        usableDepthPercent,
        equipmentGrade,
      }),
    [appliances, powerMode, autonomyHours, peakSunHours, usableDepthPercent, equipmentGrade]
  );

  useEffect(() => {
    if (equipmentGrades.length > 0 && !equipmentGrades.includes(equipmentGrade)) {
      setEquipmentGrade(equipmentGrades[0]);
    }
  }, [equipmentGrade, equipmentGrades]);

  // Directly import prices from the Store catalog.
  const costBreakdown = useMemo(
    () => computeEstimateCostFromCatalog(estimate, catalog, 7.5, settings),
    [estimate, catalog, settings]
  );
  const selectedPanel = costBreakdown.lines
    .map((line) => ({ line, item: catalog.find((item) => item.sku === line.sku) }))
    .find(({ item }) => item?.category === settings.panelCategory);
  const selectedBattery = costBreakdown.lines
    .map((line) => ({ line, item: catalog.find((item) => item.sku === line.sku) }))
    .find(({ item }) => item?.category === settings.batteryCategory);
  const selectedInverter = costBreakdown.lines
    .map((line) => ({ line, item: catalog.find((item) => item.sku === line.sku) }))
    .find(({ item }) => item?.category === settings.inverterCategory);
  const priceSummary = costBreakdown.total !== undefined
    ? `, est. ${formatNgn(costBreakdown.total)}`
    : costBreakdown.undetermined.length > 0
      ? ', estimated system total To Be Determined pending technical review'
      : '';
  const defaultNeedSummary = `${powerMode} solar estimate: ${estimate.connectedLoadWatts}W load, ${estimate.dailyEnergyKwh} kWh/day${priceSummary}.`;
  const enquiryNeedSummary = needSummary.trim()
    ? `${needSummary.trim()}${costBreakdown.undetermined.length > 0
      ? ` Pricing To Be Determined for ${costBreakdown.undetermined.map((item) => item.label).join(', ')}; system total awaits technical review.`
      : ''}`
    : defaultNeedSummary;

  const storeAppliances = useMemo(
    () => catalog.filter((c) => c.itemType === 'appliance'),
    [catalog]
  );

  async function uploadOfflineQueue(itemsToUpload = offlineQueue) {
    if (itemsToUpload.length === 0 || syncBusy) return;
    setSyncBusy(true);
    setError('');
    const remaining: PendingOfflineEstimate[] = [];
    let lastUploadedRef = '';
    let lastQuoteCode = '';

    for (const item of itemsToUpload) {
      try {
        const res = await api.submitPublicEnquiry({
          customerName: item.customerName,
          email: item.email,
          phone: item.phone,
          location: item.location,
          needSummary: item.needSummary,
          source: 'estimator',
          appliances: item.appliances,
          estimate: item.estimate,
          whatsappUpdatesConsent: item.whatsappUpdatesConsent,
          whatsappMarketingConsent: item.whatsappMarketingConsent,
        });
        lastUploadedRef = res.refCode;
        lastQuoteCode = res.quoteCode || '';
      } catch {
        remaining.push(item);
      }
    }

    persistQueue(remaining);
    if (lastUploadedRef && remaining.length === 0) {
      setSubmittedRef(lastUploadedRef);
      setSubmittedQuoteCode(lastQuoteCode);
      setOfflineSavedBanner('');
    }
    setSyncBusy(false);
  }

  // Auto-sync queued offline estimates when connection comes back
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) {
      uploadOfflineQueue(offlineQueue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  function updateRow(id: string, field: keyof ApplianceItem, value: string | number) {
    setAppliances((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function addRow() {
    setAppliances((prev) => [
      ...prev,
      { id: 'app-' + Date.now(), name: 'Custom Appliance', qty: 1, watts: 100, hours: 4 },
    ]);
  }

  function importStoreAppliance(sku: string) {
    const found = storeAppliances.find((a) => a.sku === sku);
    if (!found) return;
    setAppliances((prev) => [
      ...prev,
      {
        id: `store-${found.sku}-${Date.now()}`,
        name: found.name,
        qty: 1,
        watts: found.watts ?? 150,
        hours: 6,
        catalogSku: found.sku,
      },
    ]);
  }

  function removeRow(id: string) {
    setAppliances((prev) => prev.filter((item) => item.id !== id));
  }

  function saveEstimateOffline() {
    setError('');
    const safeCustomer = customerName.trim() || 'Offline Site Draft';
    const safePhone = phone.trim() || '+234 000 000 0000';
    const safeLocation = location.trim() || 'Nigeria Site Survey';

    const entry: PendingOfflineEstimate = {
      localId: 'LOC-' + Date.now(),
      savedAt: new Date().toISOString(),
      customerName: safeCustomer,
      email: email.trim(),
      phone: safePhone,
      location: safeLocation,
      needSummary: needSummary.trim() ? enquiryNeedSummary : `Offline ${enquiryNeedSummary}`,
      appliances,
      estimate: { ...estimate, estimatedTotalNgn: costBreakdown.total },
      whatsappUpdatesConsent,
      whatsappMarketingConsent,
    };

    const next = [entry, ...offlineQueue];
    persistQueue(next);
    setOfflineSavedBanner(
      `Saved ${entry.localId} locally to device storage. Ready to upload to HI-SOTECH server whenever online.`
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setOfflineSavedBanner('');
    setSubmittedQuoteCode('');
    if (!customerName.trim() || !phone.trim() || !location.trim()) {
      setError('Customer name, phone number, and site location are required.');
      return;
    }

    const finalEstimate: SolarEstimateResult = {
      ...estimate,
      estimatedTotalNgn: costBreakdown.total,
    };

    if (!isOnline) {
      saveEstimateOffline();
      return;
    }

    setBusy(true);
    try {
      const res = await api.submitPublicEnquiry({
        customerName,
        email,
        phone,
        location,
        needSummary: enquiryNeedSummary,
        source: 'estimator',
        appliances,
        estimate: finalEstimate,
        whatsappUpdatesConsent,
        whatsappMarketingConsent,
      });
      setSubmittedRef(res.refCode);
      setSubmittedQuoteCode(res.quoteCode || '');
      notifyUser(`Your estimate enquiry ${res.refCode} has been received.`);
    } catch {
      // Network failure fallback -> save locally to offline queue cleanly
      saveEstimateOffline();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-[#D61F26]">
            OFFLINE-CAPABLE SOLAR LOAD STUDIO
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#081E3E] sm:text-3xl dark:text-white">
            Calculate your Solar capacity and Get a Quote
          </h1>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setAppliances(DEFAULT_APPLIANCES)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#081E3E] dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-200"
          >
            Medium Home Preset
          </button>
          <button
            type="button"
            onClick={() => setAppliances(COMMERCIAL_PRESET)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#081E3E] dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-200"
          >
            Commercial Office Preset
          </button>
          <button
            type="button"
            onClick={() => setAppliances([{ id: 'blank-1', name: 'LED Lighting', qty: 0, watts: 10, hours: 6 }])}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#D61F26] dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-200"
          >
            Reset to Zero
          </button>
        </div>
      </div>

      {/* Offline Queue & Connectivity Banner */}
      {(offlineQueue.length > 0 || !isOnline || offlineSavedBanner) && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex min-w-0 items-start gap-2.5">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="min-w-0">
              <div className="font-semibold">
                {offlineSavedBanner ||
                  (!isOnline
                    ? 'You are currently offline. Calculations and Store pricing run 100% locally.'
                    : `${offlineQueue.length} local offline estimate(s) ready to sync to the HI-SOTECH server.`)}
              </div>
              {offlineQueue.length > 0 && (
                <p className="mt-0.5 text-xs opacity-85">
                  Queued: {offlineQueue.map((q) => `${q.customerName} (${q.estimate.inverterMinKw}kW)`).join(', ')}
                </p>
              )}
            </div>
          </div>

          {offlineQueue.length > 0 && isOnline && (
            <button
              type="button"
              disabled={syncBusy}
              onClick={() => uploadOfflineQueue(offlineQueue)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] disabled:opacity-60"
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {syncBusy ? 'Uploading...' : `Upload ${offlineQueue.length} Pending to Server`}
            </button>
          )}
        </div>
      )}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
        {/* Left: Appliances & Planning Assumptions */}
        <div className="min-w-0 space-y-6 lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">01. Appliance Schedule</h2>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                {storeAppliances.length > 0 && (
                  <select
                    aria-label="Import appliance from the Store"
                    value=""
                    onChange={(e) => importStoreAppliance(e.target.value)}
                    className="w-full max-w-full min-w-0 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 sm:w-56 dark:border-slate-700 dark:bg-[#061327] dark:text-slate-200"
                  >
                    <option value="">+ Import from the Store...</option>
                    {storeAppliances.map((app) => (
                      <option key={app.sku} value={app.sku}>
                        {app.name} ({app.watts ?? 150}W)
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#081E3E] px-3 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] sm:w-auto dark:bg-[#D61F26]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Row
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {appliances.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-12 items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:gap-2.5 dark:border-slate-800 dark:bg-[#061327]"
                >
                  <label className="col-span-10 min-w-0 text-xs sm:col-span-5">
                    <span className="font-medium text-slate-600 dark:text-slate-400">Appliance</span>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateRow(item.id, 'name', e.target.value)}
                      className="mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <div className="col-span-2 flex justify-end sm:order-last sm:col-span-1">
                    <button
                      type="button"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removeRow(item.id)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-[#D61F26] dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <label className="col-span-4 min-w-0 text-xs sm:col-span-2">
                    <span className="font-medium text-slate-600 dark:text-slate-400">Qty</span>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={item.qty}
                      onChange={(e) => updateRow(item.id, 'qty', Number(e.target.value))}
                      className="font-mono-num mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="col-span-4 min-w-0 text-xs sm:col-span-2">
                    <span className="font-medium text-slate-600 dark:text-slate-400">Watts</span>
                    <input
                      type="number"
                      min={0}
                      max={50000}
                      value={item.watts}
                      onChange={(e) => updateRow(item.id, 'watts', Number(e.target.value))}
                      className="font-mono-num mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="col-span-4 min-w-0 text-xs sm:col-span-2">
                    <span className="font-medium text-slate-600 dark:text-slate-400">Hrs/Day</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={item.hours}
                      onChange={(e) => updateRow(item.id, 'hours', Number(e.target.value))}
                      className="font-mono-num mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Step 2: Planning Assumptions */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">
              02. Power Mode &amp; Planning Assumptions
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 sm:gap-4">
              {(['Hybrid', 'Off-grid', 'Grid-backup'] as PowerMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setPowerMode(mode);
                    setAutonomyHours(mode === 'Off-grid' ? 16 : mode === 'Grid-backup' ? 8 : 10);
                  }}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    powerMode === mode
                      ? 'border-[#D61F26] bg-[#081E3E] text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-[#061327] dark:text-slate-300'
                  }`}
                >
                  <div className="text-sm font-bold">{mode}</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    {mode === 'Hybrid'
                      ? 'Solar + Battery + PHCN'
                      : mode === 'Off-grid'
                        ? 'Autonomous Solar + Battery'
                        : 'Grid Charger + Battery Backup'}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block min-w-0 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">Backup Autonomy (Hours)</span>
                <input
                  type="number"
                  min={2}
                  max={48}
                  value={autonomyHours}
                  onChange={(e) => setAutonomyHours(Number(e.target.value) || 10)}
                  className="font-mono-num mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                />
              </label>
              <label className="block min-w-0 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">Peak Sun Hours (Nigeria avg 4.5)</span>
                <input
                  type="number"
                  min={2}
                  max={8}
                  step={0.5}
                  value={peakSunHours}
                  onChange={(e) => setPeakSunHours(Number(e.target.value) || 4.5)}
                  className="font-mono-num mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                />
              </label>
              <label className="block min-w-0 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">Battery Usable DoD (%)</span>
                <input
                  type="number"
                  min={50}
                  max={95}
                  value={usableDepthPercent}
                  onChange={(e) => setUsableDepthPercent(Number(e.target.value) || 85)}
                  className="font-mono-num mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                />
              </label>
              <label className="block min-w-0 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">Equipment Grade</span>
                <select
                  value={equipmentGrade}
                  onChange={(e) => setEquipmentGrade(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                >
                  {(equipmentGrades.length > 0 ? equipmentGrades : ['Standard']).map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* Right: Live Sizing, Store Cost Sync & Submission */}
        <div className="min-w-0 space-y-6 lg:col-span-5">
          <div className="rounded-xl bg-[#081E3E] p-4 text-white sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">03. Live Local Sizing &amp; Cost</h2>
              <span className="text-xs font-medium text-red-300">{powerMode} Mode</span>
            </div>

            <dl className="mt-4 divide-y divide-white/10 text-sm">
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-slate-300">Connected Peak Load</dt>
                <dd className="font-mono-num shrink-0 text-base font-bold sm:text-lg">
                  {estimate.connectedLoadWatts.toLocaleString()} W
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-slate-300">Daily Energy Demand</dt>
                <dd className="font-mono-num shrink-0 text-base font-bold sm:text-lg">
                  {estimate.dailyEnergyKwh} kWh/day
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-slate-300">Minimum Inverter Class</dt>
                <dd className="font-mono-num shrink-0 text-base font-bold text-red-300 sm:text-lg">
                  {estimate.inverterMinKw} kW
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-slate-300">Nominal Battery Target</dt>
                <dd className="font-mono-num shrink-0 text-base font-bold sm:text-lg">
                  {estimate.batteryTargetKwh} kWh
                </dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-3 border-t border-white/15 pt-4 text-xs sm:grid-cols-3">
              <div className="min-w-0 rounded-lg bg-white/10 p-3">
                <div className="text-slate-300">Inverter</div>
                <div className="mt-1 break-words font-bold">
                  {selectedInverter?.item?.name
                    ?? (estimate.connectedLoadWatts > 0 ? 'To Be Determined' : 'Not required')}
                </div>
                {selectedInverter && (
                  <div className="font-mono-num mt-1 text-slate-300">
                    {selectedInverter.line.qty} × {selectedInverter.item?.capacityKw} kW
                  </div>
                )}
              </div>
              <div className="min-w-0 rounded-lg bg-white/10 p-3">
                <div className="text-slate-300">Solar panels</div>
                <div className="mt-1 break-words font-bold">
                  {selectedPanel?.item?.name
                    ?? (estimate.recommendedArrayWatts ? 'To Be Determined' : 'Not required')}
                </div>
                {selectedPanel && (
                  <div className="font-mono-num mt-1 text-slate-300">
                    {selectedPanel.line.qty} × {selectedPanel.item?.watts} W
                  </div>
                )}
              </div>
              <div className="min-w-0 rounded-lg bg-white/10 p-3">
                <div className="text-slate-300">Battery</div>
                <div className="mt-1 break-words font-bold">
                  {selectedBattery?.item?.name
                    ?? (estimate.batteryTargetKwh > 0 ? 'To Be Determined' : 'Not required')}
                </div>
                {selectedBattery && (
                  <div className="font-mono-num mt-1 text-slate-300">
                    {selectedBattery.line.qty} × {selectedBattery.item?.capacityKw} kWh
                  </div>
                )}
              </div>
            </div>

            {/* Imported Store Prices Breakdown */}
            <div className="mt-5 border-t border-white/15 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-red-300">IMPORTED STORE COST</span>
                <button
                  type="button"
                  onClick={onOpenStore}
                  className="inline-flex shrink-0 items-center gap-1 text-slate-300 underline hover:text-white"
                >
                  <ShoppingBag className="h-3 w-3" /> Edit in Store
                </button>
              </div>

              {costBreakdown.lines.length > 0 || costBreakdown.undetermined.length > 0 ? (
                <div className="mt-3 space-y-2 text-xs">
                  {costBreakdown.lines.map((line) => (
                    <div key={line.sku} className="flex items-center justify-between gap-2 text-slate-200">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono-num text-red-300">{line.qty}×</span> {line.description}
                      </span>
                      <span className="font-mono-num shrink-0 font-semibold">
                        {line.isTbd ? 'To Be Determined' : formatNgn(line.qty * line.unitPriceNgn)}
                      </span>
                    </div>
                  ))}
                  {costBreakdown.undetermined.map((component) => (
                    <div key={component.key} className="flex items-start justify-between gap-2 text-amber-100">
                      <span className="min-w-0 flex-1">
                        {component.label}
                        <span className="mt-0.5 block text-[11px] text-amber-200">{component.requirement}</span>
                      </span>
                      <span className="shrink-0 font-semibold">To Be Determined</span>
                    </div>
                  ))}
                  {costBreakdown.total !== undefined && (
                    <div className="flex items-center justify-between gap-2 border-t border-white/15 pt-2 text-slate-300">
                      <span>Core equipment estimate + 7.5% VAT</span>
                      <span className="font-mono-num shrink-0">{formatNgn(costBreakdown.tax)} VAT</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-sm font-bold text-white sm:text-base">
                    <span>Estimated System Total</span>
                    <span className="shrink-0 text-right text-red-300" data-testid="estimator-total-cost">
                      {costBreakdown.total !== undefined
                        ? formatNgn(costBreakdown.total)
                        : 'To Be Determined'}
                    </span>
                  </div>
                </div>
              ) : catalog.length === 0 ? (
                <p className="mt-2 text-xs text-amber-100">
                  Equipment pricing is being configured. Your load calculation can be submitted, but a priced quotation is not available yet.
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-300">
                  Add appliances above to compute live hardware &amp; installation pricing from the Store.
                </p>
              )}
              <p className="mt-4 border-t border-white/15 pt-3 text-xs text-slate-300">
                Only the inverter, battery, and solar array are priced here. Accessories, installation, and logistics are To Be Determined; prices are subject to inspection.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">
              04. Save Offline or Submit to HI-SOTECH
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Compute offline anywhere on site; save locally or upload immediately for formal quotation.
            </p>

            {submittedRef ? (
              <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/50">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <strong className="text-sm">Enquiry Uploaded Successfully</strong>
                </div>
                <p className="mt-2 text-sm text-emerald-900 dark:text-emerald-100">
                  Your tracking code is{' '}
                  <strong className="font-mono-num text-base">{submittedRef}</strong>.
                </p>
                {submittedQuoteCode && (
                  <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-100">
                    Draft quotation <strong className="font-mono-num">{submittedQuoteCode}</strong> was created and is awaiting staff review.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onTrackRef(submittedRef)}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
                >
                  Open Customer Tracker
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                {error && (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
                    {error}
                  </p>
                )}
                <div className="mt-4 space-y-3 text-sm">
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Full Name / Company *</span>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Adebayo Holdings"
                      className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">WhatsApp Number *</span>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+2348030000000"
                        className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@domain.com"
                        className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                      />
                    </label>
                  </div>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Site Location *</span>
                    <input
                      type="text"
                      required
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Gwarinpa, Abuja"
                      className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Site Notes</span>
                    <textarea
                      rows={2}
                      value={needSummary}
                      onChange={(e) => setNeedSummary(e.target.value)}
                      placeholder="Roof type, generator changeover, or preferred contact time..."
                      className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                    />
                  </label>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={whatsappUpdatesConsent}
                      onChange={(event) => setWhatsappUpdatesConsent(event.target.checked)} className="mt-0.5" />
                    <span>Optional: I agree to WhatsApp updates about this enquiry, quotes, invoices, and installation. I can withdraw consent at any time.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={whatsappMarketingConsent}
                      onChange={(event) => setWhatsappMarketingConsent(event.target.checked)} className="mt-0.5" />
                    <span>Optional: I separately agree to promotional WhatsApp messages. I can withdraw consent at any time.</span>
                  </label>
                </div>

                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button
                    type="button"
                    onClick={saveEstimateOffline}
                    className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-[#081E3E] hover:border-[#081E3E] sm:flex-1 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Offline Queue
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#D61F26] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#B0171D] disabled:opacity-60 sm:flex-1"
                  >
                    <CloudUpload className="h-3.5 w-3.5" />
                    {busy ? 'Uploading...' : isOnline ? 'Upload Estimate & Get HISO Code' : 'Queue Offline'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
