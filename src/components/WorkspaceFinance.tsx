import { CheckCircle2, ExternalLink, Plus, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { calculateInvoiceBalance, formatNgn, getOverdueAgeBand, hasPermission } from '../lib/solar';
import type { InvoiceRecord, PaymentRecord, StaffMember } from '../lib/types';

interface WorkspaceFinanceProps {
  mode: 'invoices' | 'finance';
  user: StaffMember;
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  staff: StaffMember[];
  onRefresh: () => Promise<void>;
  onOpenDocument: (type: 'quote' | 'invoice', id: string) => void;
  onNotify: (msg: string) => void;
}

export function WorkspaceFinance({
  mode,
  user,
  invoices,
  payments,
  staff,
  onRefresh,
  onOpenDocument,
  onNotify,
}: WorkspaceFinanceProps) {
  const [payInvoice, setPayInvoice] = useState<InvoiceRecord | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('Bank Transfer (NIP)');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');

  const [releaseInv, setReleaseInv] = useState<InvoiceRecord | null>(null);
  const [releaseType, setReleaseType] = useState<'Full Payment' | 'MD Exception'>('Full Payment');
  const [releaseNote, setReleaseNote] = useState('');
  const [releaseEng, setReleaseEng] = useState('');
  const [releaseDate, setReleaseDate] = useState(
    new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  );
  const [releaseSummary, setReleaseSummary] = useState('Hybrid Solar & LiFePO4 Installation');

  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Confirmed' | 'Rejected'>('All');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const canLogReceipts = hasPermission(user, 'manage_invoices');
  const canVerifyPayments = hasPermission(user, 'verify_payments');
  const canReleaseJobs = hasPermission(user, 'release_installations');
  const technicians = staff.filter(
    (s) => (s.role === 'technician' || hasPermission(s, 'update_installations')) && s.status === 'Active'
  );

  const invoiceSummaries = useMemo(() => {
    return invoices.map((inv) => {
      const invPayments = payments.filter((p) => p.invoiceId === inv.id);
      const bal = calculateInvoiceBalance(inv.totalNgn, invPayments);
      const band = getOverdueAgeBand(inv.dueDate, bal.balance, today);
      return { inv, ...bal, band };
    });
  }, [invoices, payments, today]);

  const financeMetrics = useMemo(() => {
    const totalInvoiced = invoiceSummaries.reduce((s, x) => s + x.inv.totalNgn, 0);
    const totalConfirmed = invoiceSummaries.reduce((s, x) => s + x.confirmedPaid, 0);
    const totalPending = invoiceSummaries.reduce((s, x) => s + x.pendingAmount, 0);
    const totalOutstanding = invoiceSummaries.reduce((s, x) => s + x.balance, 0);
    const bands = {
      Current: 0,
      '1-30 Days': 0,
      '31-60 Days': 0,
      '61+ Days': 0,
    };
    for (const item of invoiceSummaries) {
      if (item.band !== 'Settled') {
        bands[item.band] += item.balance;
      }
    }
    return { totalInvoiced, totalConfirmed, totalPending, totalOutstanding, bands };
  }, [invoiceSummaries]);

  async function handleLogPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payInvoice) return;
    setError('');
    setBusy(true);
    try {
      await api.logPayment({
        invoiceId: payInvoice.id,
        amountNgn: Number(payAmount),
        paymentDate: payDate,
        method: payMethod,
        reference: payRef,
        evidenceNote: payNote,
      });
      setPayInvoice(null);
      setPayAmount('');
      setPayRef('');
      setPayNote('');
      await onRefresh();
      onNotify('Payment receipt logged for MD verification.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyPayment(paymentId: string, decision: 'Confirmed' | 'Rejected') {
    setError('');
    setBusy(true);
    try {
      await api.verifyPayment(
        paymentId,
        decision,
        decision === 'Rejected' ? 'Unverified against corporate bank statement' : undefined
      );
      await onRefresh();
      onNotify(`Receipt ${decision}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRelease(e: React.FormEvent) {
    e.preventDefault();
    if (!releaseInv) return;
    setError('');
    setBusy(true);
    try {
      const res = await api.releaseInstallation({
        invoiceId: releaseInv.id,
        releaseType,
        releaseNote,
        assignedEngineerId: releaseEng || null,
        targetDate: releaseDate,
        systemSummary: releaseSummary,
      });
      setReleaseInv(null);
      setReleaseNote('');
      await onRefresh();
      onNotify(`Installation ${res.jobCode} released for delivery.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filteredPayments = payments.filter((p) => (statusFilter === 'All' ? true : p.status === statusFilter));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
          {error}
        </div>
      )}

      {mode === 'finance' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Invoiced</div>
              <div className="font-mono-num mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">
                {formatNgn(financeMetrics.totalInvoiced)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">MD-Confirmed Receipts</div>
              <div className="font-mono-num mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {formatNgn(financeMetrics.totalConfirmed)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Pending Verification</div>
              <div className="font-mono-num mt-1 text-2xl font-bold text-amber-600">
                {formatNgn(financeMetrics.totalPending)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Outstanding Balance</div>
              <div className="font-mono-num mt-1 text-2xl font-bold text-[#D61F26]">
                {formatNgn(financeMetrics.totalOutstanding)}
              </div>
            </div>
          </div>

          {/* Overdue Ageing + Collection Bar */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
              <h3 className="text-base font-bold text-[#081E3E] dark:text-white">Overdue Ageing Schedule</h3>
              <div className="mt-4 space-y-3 text-sm">
                {Object.entries(financeMetrics.bands).map(([band, val]) => (
                  <div key={band} className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                    <span className="text-slate-600 dark:text-slate-300">{band}</span>
                    <span className="font-mono-num font-bold text-[#081E3E] dark:text-white">{formatNgn(val)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
              <h3 className="text-base font-bold text-[#081E3E] dark:text-white">Collection Ratio</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Only MD-confirmed receipts count toward collected revenue.
              </p>
              <div className="mt-5">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Confirmed Collection</span>
                  <span className="font-mono-num">
                    {financeMetrics.totalInvoiced > 0
                      ? Math.round((financeMetrics.totalConfirmed / financeMetrics.totalInvoiced) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{
                      width: `${
                        financeMetrics.totalInvoiced > 0
                          ? Math.min(100, Math.round((financeMetrics.totalConfirmed / financeMetrics.totalInvoiced) * 100))
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Invoices Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
        <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">
          {mode === 'invoices' ? 'Invoices & Release Gate' : 'Invoice Balances'}
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <tr>
                <th className="py-2.5 pr-4">Invoice</th>
                <th className="py-2.5 pr-4">Customer</th>
                <th className="py-2.5 pr-4 text-right">Total</th>
                <th className="py-2.5 pr-4 text-right">Confirmed Paid</th>
                <th className="py-2.5 pr-4 text-right">Balance</th>
                <th className="py-2.5 pr-4">Acceptance</th>
                <th className="py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {invoiceSummaries.map(({ inv, confirmedPaid, balance, band }) => (
                <tr key={inv.id}>
                  <td className="font-mono-num py-3 pr-4 font-bold text-[#081E3E] dark:text-white">
                    {inv.invoiceCode}
                    <div className="text-[11px] font-normal text-slate-500">Due {inv.dueDate} · {band}</div>
                  </td>
                  <td className="py-3 pr-4 font-medium">{inv.customerName}</td>
                  <td className="font-mono-num py-3 pr-4 text-right">{formatNgn(inv.totalNgn)}</td>
                  <td className="font-mono-num py-3 pr-4 text-right text-emerald-700 dark:text-emerald-400">
                    {formatNgn(confirmedPaid)}
                  </td>
                  <td className="font-mono-num py-3 pr-4 text-right font-bold text-[#D61F26]">
                    {formatNgn(balance)}
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    {inv.customerAccepted ? 'Accepted' : 'Pending Customer'}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenDocument('invoice', inv.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold hover:border-[#081E3E] dark:border-slate-700"
                      >
                        PDF <ExternalLink className="h-3 w-3" />
                      </button>
                      {canLogReceipts && balance > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayInvoice(inv);
                            setPayAmount(String(balance));
                          }}
                          className="inline-flex items-center gap-1 rounded bg-[#081E3E] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#D61F26]"
                        >
                          <Plus className="h-3 w-3" /> Log Receipt
                        </button>
                      )}
                      {canReleaseJobs && (
                        <button
                          type="button"
                          onClick={() => {
                            setReleaseInv(inv);
                            setReleaseType(balance <= 1 ? 'Full Payment' : 'MD Exception');
                          }}
                          className="rounded bg-[#D61F26] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#B0171D]"
                        >
                          Release Job
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Payments Ledger */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Payment Receipts & MD Verification</h3>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#061327]">
            {(['All', 'Pending', 'Confirmed', 'Rejected'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${
                  statusFilter === tab
                    ? 'bg-white text-[#081E3E] shadow-sm dark:bg-[#0B1D39] dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {filteredPayments.length === 0 && (
            <p className="text-sm text-slate-500">No payment receipts match this filter.</p>
          )}
          {filteredPayments.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
            >
              <div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono-num font-bold text-[#081E3E] dark:text-white">{p.paymentCode}</span>
                  <span>·</span>
                  <span className="font-mono-num">{p.paymentDate}</span>
                  <span>·</span>
                  <span>{p.method}</span>
                  <span>·</span>
                  <span className="font-semibold">{p.status}</span>
                </div>
                <div className="font-mono-num mt-1 text-base font-bold text-slate-900 dark:text-white">
                  {formatNgn(p.amountNgn)}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Ref: {p.reference} · {p.evidenceNote}
                </p>
              </div>

              {canVerifyPayments && p.status === 'Pending' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleVerifyPayment(p.id, 'Confirmed')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Receipt
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleVerifyPayment(p.id, 'Rejected')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Log Payment Modal */}
      {payInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleLogPayment}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h4 className="text-lg font-bold text-[#081E3E] dark:text-white">
              Log Payment Receipt · {payInvoice.invoiceCode}
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Receipt enters Pending state until confirmed by Managing Director Oseni.
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium">Amount (₦)</span>
                <input
                  type="number"
                  required
                  min={1}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Payment Date</span>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Method</span>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  >
                    <option>Bank Transfer (NIP)</option>
                    <option>POS / Cheque</option>
                    <option>Cash Deposit</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium">Bank Reference *</span>
                <input
                  type="text"
                  required
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="e.g. NIP-9938401"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Evidence Note *</span>
                <textarea
                  rows={2}
                  required
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Sender name, bank alert timestamp..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayInvoice(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
              >
                Submit for MD Verification
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Installation Release Modal (MD Only) */}
      {releaseInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleRelease}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h4 className="text-lg font-bold text-[#081E3E] dark:text-white">
              Release Installation · {releaseInv.invoiceCode}
            </h4>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium">Release Basis</span>
                <select
                  value={releaseType}
                  onChange={(e) => setReleaseType(e.target.value as 'Full Payment' | 'MD Exception')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="Full Payment">Full Payment Confirmed</option>
                  <option value="MD Exception">MD Exception (Partial Payment Release)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">System Summary</span>
                <input
                  type="text"
                  required
                  value={releaseSummary}
                  onChange={(e) => setReleaseSummary(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Assign Technician</span>
                  <select
                    value={releaseEng}
                    onChange={(e) => setReleaseEng(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  >
                    <option value="">Assign later</option>
                    {technicians.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        {eng.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Target Date</span>
                  <input
                    type="date"
                    required
                    value={releaseDate}
                    onChange={(e) => setReleaseDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium">
                  Authorisation / Exception Note {releaseType === 'MD Exception' ? '*' : ''}
                </span>
                <textarea
                  rows={2}
                  required={releaseType === 'MD Exception'}
                  value={releaseNote}
                  onChange={(e) => setReleaseNote(e.target.value)}
                  placeholder="Record payment clearance or MD exception terms..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReleaseInv(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
              >
                Authorize Installation Release
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
