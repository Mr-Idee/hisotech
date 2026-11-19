import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { CatalogItem, EstimatorSettings, PlatformSettings } from '../lib/types';

interface WorkspaceSettingsProps {
  catalog: CatalogItem[];
  settings: PlatformSettings;
  onSaved: (settings: PlatformSettings) => void;
  onOpenDocument: (type: 'quote' | 'invoice', id: string) => void;
}

export function WorkspaceSettings({ catalog, settings, onSaved, onOpenDocument }: WorkspaceSettingsProps) {
  const [form, setForm] = useState<PlatformSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  const equipmentCategories = useMemo(
    () => [...new Set(catalog.filter((item) => item.itemType === 'equipment').map((item) => item.category))].sort(),
    [catalog]
  );
  const accessories = useMemo(() => catalog.filter(
    (item) => item.itemType === 'equipment'
      && ![
        form.estimator.inverterCategory,
        form.estimator.batteryCategory,
        form.estimator.panelCategory,
      ].includes(item.category)
  ), [catalog, form.estimator]);
  const services = useMemo(() => catalog.filter((item) => item.itemType === 'service'), [catalog]);

  function updateBank(field: keyof PlatformSettings['bankDetails'], value: string) {
    setForm((current) => ({ ...current, bankDetails: { ...current.bankDetails, [field]: value } }));
    setSaved(false);
  }

  function updateEstimator(update: Partial<EstimatorSettings>) {
    setForm((current) => ({
      ...current,
      estimator: { ...current.estimator, ...update },
    }));
    setSaved(false);
  }

  function toggleSku(field: 'accessorySkus' | 'installationSkus' | 'logisticsSkus', sku: string) {
    const selected = form.estimator[field];
    updateEstimator({
      [field]: selected.includes(sku) ? selected.filter((item) => item !== sku) : [...selected, sku],
    });
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const response = await api.savePlatformSettings(form);
      setForm(response.settings);
      onSaved(response.settings);
      setSaved(true);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#061327] dark:text-slate-100';
  const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39] sm:p-6';

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <header>
        <p className="text-xs font-semibold tracking-wider text-[#D61F26]">WORKSPACE CONFIGURATION</p>
        <h1 className="mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">Platform Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Configure the receiving account shown on new invoices and choose the Store categories and services used by the load estimator.
        </p>
      </header>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
      {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">Settings saved.</p>}

      <section className={cardClass} aria-labelledby="invoice-bank-title">
        <h2 id="invoice-bank-title" className="text-lg font-bold text-[#081E3E] dark:text-white">Invoice bank account</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">This global account is copied to each invoice when it is issued. Previously issued invoices do not change.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Bank name
            <input maxLength={120} value={form.bankDetails.bankName} onChange={(event) => updateBank('bankName', event.target.value)} className={inputClass} />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Account name
            <input maxLength={120} value={form.bankDetails.accountName} onChange={(event) => updateBank('accountName', event.target.value)} className={inputClass} />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Account number
            <input maxLength={50} value={form.bankDetails.accountNumber} onChange={(event) => updateBank('accountNumber', event.target.value)} className={inputClass} />
          </label>
        </div>
        {Object.values(form.bankDetails).some(Boolean) && Object.values(form.bankDetails).some((value) => !value) && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Complete all three fields, or clear them all to hide bank details on new invoices.</p>
        )}
      </section>

      <section className={cardClass} aria-labelledby="estimator-rules-title">
        <h2 id="estimator-rules-title" className="text-lg font-bold text-[#081E3E] dark:text-white">Load estimator equipment matching</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          The estimator sizes the system from the customer’s appliance demand, then selects the smallest suitable inverter, capacity-matched batteries, and panel wattage from the chosen Store categories and grade.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {([
            ['inverterCategory', 'Inverter category', 'capacityKw is kW'],
            ['batteryCategory', 'Battery category', 'capacityKw is stored as kWh'],
            ['panelCategory', 'Solar array category', 'watts is panel output'],
          ] as const).map(([field, label, unitNote]) => (
            <label key={field} className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {label}
              <select
                required
                value={form.estimator[field]}
                onChange={(event) => updateEstimator({ [field]: event.target.value })}
                className={inputClass}
              >
                {!equipmentCategories.includes(form.estimator[field]) && <option value={form.estimator[field]}>{form.estimator[field]}</option>}
                {equipmentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <span className="mt-1 block font-normal text-slate-500 dark:text-slate-400">{unitNote}</span>
            </label>
          ))}
        </div>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-[#061327] dark:text-slate-300">
          To change available equipment types, capacities, grade, or live prices, edit the corresponding Store items first. Battery capacity is maintained in the Store’s capacity field in kWh; inverter capacity is in kW; panels use their watt rating.
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        {([
          ['accessorySkus', 'Accessories', accessories],
          ['installationSkus', 'Installation & commissioning', services],
          ['logisticsSkus', 'Logistics & delivery', services],
        ] as const).map(([field, title, choices]) => (
          <section key={field} className={cardClass} aria-labelledby={`${field}-title`}>
            <h2 id={`${field}-title`} className="text-base font-bold text-[#081E3E] dark:text-white">{title}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Selected Store items are included in estimator pricing.</p>
            {choices.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">Add matching items to the Store first.</p>
            ) : (
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {choices.map((item) => (
                  <label key={`${field}-${item.sku}`} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500">
                    <input
                      type="checkbox"
                      checked={form.estimator[field].includes(item.sku)}
                      onChange={() => toggleSku(field, item.sku)}
                      className="mt-0.5 accent-[#D61F26]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-800 dark:text-slate-100">{item.name}</span>
                      <span className="mt-0.5 block text-slate-500 dark:text-slate-400">{item.sku} · {item.category}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <section className={`${cardClass} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <h2 className="font-bold text-[#081E3E] dark:text-white">Document examples</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Preview the sample quotation and invoice layout with warranty and service-life notes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenDocument('quote', 'sample-quote')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#D61F26] dark:border-slate-700 dark:text-slate-200">Sample quotation</button>
          <button type="button" onClick={() => onOpenDocument('invoice', 'sample-invoice')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#D61F26] dark:border-slate-700 dark:text-slate-200">Sample invoice</button>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="rounded-lg bg-[#D61F26] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#B0171D] disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </form>
  );
}
