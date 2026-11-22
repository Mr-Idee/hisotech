import { CheckCircle2, ExternalLink, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { listenForCustomerLogout } from '../lib/auth-sync';
import { formatNgn, INSTALLATION_STAGES } from '../lib/solar';

interface TrackerViewProps {
  initialRef?: string;
  onOpenDocument: (type: 'quote' | 'invoice', id: string) => void;
  onOpenCustomerPortal: () => void;
}

export function TrackerView({ initialRef, onOpenDocument, onOpenCustomerPortal }: TrackerViewProps) {
  const [refInput, setRefInput] = useState(initialRef || '');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.trackRequest>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  async function lookup(code: string) {
    const clean = code.trim();
    if (!clean) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.trackRequest(clean);
      setData(res);
    } catch (err) {
      setData(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const startRef = initialRef || '';
    setRefInput(startRef);
    if (startRef) void lookup(startRef);
  }, [initialRef]);

  useEffect(() => listenForCustomerLogout(() => {
    setData(null);
    setLoading(false);
    setError('You were signed out in another tab. Sign in through the Customer Service Portal to view tracking details.');
  }), []);

  async function handleAcceptInvoice(invoiceId: string) {
    setAcceptBusy(true);
    try {
      await api.acceptInvoice(invoiceId);
      await lookup(refInput);
    } finally {
      setAcceptBusy(false);
    }
  }

  const stagePercent = data?.installation ? data.installation.currentStage * 20 : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="rounded-xl bg-[#081E3E] p-6 text-white sm:p-8">
        <p className="text-xs font-semibold tracking-wider text-red-300">CUSTOMER TRACKING PORTAL</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Track your solar enquiry, documents & installation stages.</h1>
        <p className="mt-2 text-sm text-slate-300">
          Sign in through the Customer Service Portal using the verified email for your request before viewing tracking details.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(refInput);
          }}
          className="mt-6 flex flex-col gap-3 sm:flex-row"
        >
          <label className="sr-only" htmlFor="track-ref-input">
            Tracking Reference
          </label>
          <input
            id="track-ref-input"
            type="text"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            placeholder="Enter reference e.g. HISO-1001 or ORD-1001"
            className="font-mono-num w-full min-w-0 rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-white focus:outline-none sm:flex-1"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#D61F26] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#B0171D] sm:w-auto"
          >
            <Search className="h-4 w-4" />
            {loading ? 'Checking...' : 'Check Status'}
          </button>
        </form>

      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
          <p>{error}</p>
          {error.includes('Verified customer sign-in required') && (
            <button
              type="button"
              onClick={onOpenCustomerPortal}
              className="mt-3 rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
            >
              Open Customer Service Portal
            </button>
          )}
        </div>
      )}

      {data && (
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          {/* Left Column: Enquiry & Commercial Status */}
          <div className="space-y-6 lg:col-span-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono-num text-xs font-semibold text-[#D61F26]">
                    {data.enquiry.refCode}
                  </span>
                  <h2 className="mt-1 text-xl font-bold text-[#081E3E] dark:text-white">
                    {data.enquiry.customerName}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{data.enquiry.location}</p>
                </div>
                <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-[#081E3E] dark:bg-slate-800 dark:text-white">
                  {data.enquiry.status}
                </span>
              </div>

              {data.enquiry.estimate && data.enquiry.estimate.connectedLoadWatts > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Estimated Load</div>
                    <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {data.enquiry.estimate.connectedLoadWatts} W · {data.enquiry.estimate.dailyEnergyKwh} kWh
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Indicative Inverter</div>
                    <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {data.enquiry.estimate.inverterMinKw} kW Class
                    </div>
                  </div>
                </div>
              )}
            </section>

            {data.order && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-mono-num text-xs font-semibold text-[#D61F26]">
                      STORE ORDER · {data.order.orderCode}
                    </span>
                    <h3 className="mt-1 text-base font-bold text-[#081E3E] dark:text-white">
                      {data.order.deliveryMethod}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {data.order.deliveryAddress}
                    </p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-[#081E3E] dark:bg-slate-800 dark:text-white">
                    {data.order.status}
                  </span>
                </div>
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                  {data.order.items.map((it) => (
                    <div key={it.sku} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                        <strong className="font-mono-num">{it.qty}×</strong> {it.name}
                      </span>
                      <span className="font-mono-num shrink-0 font-semibold text-[#081E3E] dark:text-white">
                        {formatNgn(it.qty * it.unitPriceNgn)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-500 dark:border-slate-800">
                    <span>VAT (7.5%) + Logistics</span>
                    <span className="font-mono-num">
                      {formatNgn(data.order.taxNgn + data.order.deliveryFeeNgn)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-[#081E3E] dark:text-white">
                    <span>Order Total</span>
                    <span className="font-mono-num text-[#D61F26]">{formatNgn(data.order.totalNgn)}</span>
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
              <h3 className="text-base font-bold text-[#081E3E] dark:text-white">Approved Commercial Documents</h3>

              {!data.quotation && !data.invoice && (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  Technical review is in progress. Approved quotations and invoices will appear here once released by
                  management.
                </p>
              )}

              {data.quotation && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
                  <div>
                    <div className="font-mono-num text-sm font-bold text-[#081E3E] dark:text-white">
                      {data.quotation.quoteCode} · R{data.quotation.revisionNo}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {data.quotation.status} · Valid until {data.quotation.validUntil}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenDocument('quote', data.quotation!.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-[#081E3E] hover:border-[#081E3E] dark:border-slate-600 dark:text-white"
                  >
                    View Quote
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {data.invoice && (
                <div className="mt-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono-num text-sm font-bold text-[#081E3E] dark:text-white">
                        {data.invoice.invoiceCode}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{data.invoice.status} · Due {data.invoice.dueDate}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenDocument('invoice', data.invoice!.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-[#081E3E] hover:border-[#081E3E] dark:border-slate-600 dark:text-white"
                    >
                      View Invoice
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Invoice Value</dt>
                      <dd className="font-mono-num font-semibold text-slate-900 dark:text-white">
                        {formatNgn(data.invoice.totalNgn)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Verified Receipts</dt>
                      <dd className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatNgn(data.invoice.confirmedPaidNgn)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Remaining Balance</dt>
                      <dd className="font-mono-num font-bold text-[#D61F26]">
                        {formatNgn(data.invoice.balanceNgn)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {data.invoice.customerAccepted ? (
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Commercial offer accepted by customer
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={acceptBusy}
                        onClick={() => handleAcceptInvoice(data.invoice!.id)}
                        className="w-full rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
                      >
                        {acceptBusy ? 'Recording Acceptance...' : 'Confirm Acceptance of Invoice'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Installation Stages & Customer-Visible Reports */}
          <div className="lg:col-span-7">
            <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Installation Delivery Progress</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {data.installation
                      ? `${data.installation.jobCode} · ${data.installation.systemSummary}`
                      : 'Awaiting installation release from management.'}
                  </p>
                </div>
                {data.installation && (
                  <span className="font-mono-num text-lg font-bold text-[#D61F26]">{stagePercent}%</span>
                )}
              </div>

              {data.installation ? (
                <>
                  <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-[#D61F26] transition-all"
                      style={{ width: `${stagePercent}%` }}
                    />
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-5">
                    {INSTALLATION_STAGES.map((st) => {
                      const done = data.installation!.currentStage > st.stage;
                      const current = data.installation!.currentStage === st.stage;
                      return (
                        <div
                          key={st.stage}
                          className={`rounded-lg border p-2.5 text-xs ${
                            done
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                              : current
                                ? 'border-[#D61F26] bg-red-50/70 text-[#081E3E] dark:bg-red-950/30 dark:text-white'
                                : 'border-slate-200 text-slate-400 dark:border-slate-800'
                          }`}
                        >
                          <div className="font-mono-num font-bold">0{st.stage}</div>
                          <div className="mt-0.5 font-semibold">{st.title}</div>
                          <div className="mt-1 text-[11px]">
                            {done ? 'Completed' : current ? 'Current' : 'Upcoming'}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
                    <h4 className="text-sm font-bold text-[#081E3E] dark:text-white">Approved Field Updates</h4>
                    {data.installation.updates.length === 0 && (
                      <p className="text-sm text-slate-500">No public field reports logged yet.</p>
                    )}
                    {data.installation.updates.map((upd) => (
                      <div
                        key={upd.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-[#061327]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-semibold text-[#081E3E] dark:text-white">
                            Stage {upd.stageNumber} · {upd.activityTitle}
                          </span>
                          <span className="font-mono-num">{upd.createdAt.slice(0, 10)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{upd.reportText}</p>
                        {upd.photos.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {upd.photos.map((ph) => (
                              <button
                                key={ph.id}
                                type="button"
                                onClick={() => setLightboxUrl(ph.fileUrl)}
                                className="h-16 w-20 overflow-hidden rounded border border-slate-300 dark:border-slate-700"
                              >
                                <img
                                  src={ph.fileUrl}
                                  alt={ph.originalName}
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                  Installation team scheduling begins after invoice verification and MD release.
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            aria-label="Close photo preview"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 rounded-full bg-white p-2 text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
          <img src={lightboxUrl} alt="Site evidence" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
