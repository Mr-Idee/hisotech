import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { calculateDocumentTotals, formatNgn } from '../lib/solar';
import type { LineItem } from '../lib/types';

interface DocumentViewProps {
  type: 'quote' | 'invoice';
  id: string;
  onBack: () => void;
}

export function DocumentView({ type, id, onBack }: DocumentViewProps) {
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getDocument(type, id)
      .then(setDoc)
      .catch((err) => setError((err as Error).message));
  }, [type, id]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
        <button type="button" onClick={onBack} className="mt-4 text-sm font-semibold text-[#081E3E] underline">
          Back
        </button>
      </div>
    );
  }

  if (!doc) {
    return <div className="mx-auto max-w-4xl px-4 py-12 text-sm text-slate-500">Loading document...</div>;
  }

  const items = (doc.items as LineItem[]) || [];
  const totals = calculateDocumentTotals(items, Number(doc.discountNgn || 0), Number(doc.taxPercent || 0));
  const isInvoice = doc.type === 'invoice';
  const bank = doc.bankDetails as { bankName?: string; accountName?: string; accountNumber?: string } | undefined;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="no-print mb-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-[#081E3E]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#081E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#D61F26]"
        >
          <Printer className="h-4 w-4" />
          Print / Save PDF
        </button>
      </div>

      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
        <div className="h-2 bg-[#D61F26]" />
        <div className="p-8 sm:p-10">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <img src="/assets/hisotech-logo-mark.png" alt="HI-SOTECH" className="h-12 w-12 object-contain" />
              <div>
                <div className="font-display text-xl font-extrabold text-[#081E3E]">HI-SOTECH</div>
                <div className="text-xs font-medium text-slate-500">
                  Solar Inverter Co. Ltd · No. 5 Adamu Fika St, Life Camp, Abuja
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs font-semibold tracking-wider text-[#D61F26]">
                {isInvoice ? 'COMMERCIAL DOCUMENT' : 'TECHNICAL PROPOSAL'}
              </div>
              <h1 className="mt-1 text-2xl font-extrabold text-[#081E3E]">
                {isInvoice ? 'PROFORMA INVOICE' : 'QUOTATION'}
              </h1>
              <div className="font-mono-num mt-1 text-sm font-bold text-slate-700">
                {String(doc.documentCode)}
                {!isInvoice && doc.revisionNo ? ` / R${String(doc.revisionNo)}` : ''}
              </div>
            </div>
          </header>

          <section className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Prepared For</div>
              <div className="mt-1 text-lg font-bold text-[#081E3E]">{String(doc.customerName)}</div>
              <p className="mt-1 text-sm text-slate-600">{String(doc.location || '')}</p>
              <p className="font-mono-num text-xs text-slate-500">
                {String(doc.phone || '')} {doc.email ? `· ${String(doc.email)}` : ''}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-xs">
              <div>
                <dt className="text-slate-500">Enquiry Ref</dt>
                <dd className="font-mono-num mt-0.5 font-bold text-slate-900">{String(doc.refCode)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Issued Date</dt>
                <dd className="font-mono-num mt-0.5 font-bold text-slate-900">{String(doc.issuedDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{isInvoice ? 'Payment Due' : 'Valid Until'}</dt>
                <dd className="font-mono-num mt-0.5 font-bold text-slate-900">
                  {String(isInvoice ? doc.dueDate : doc.validUntil)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="mt-0.5 font-bold text-[#081E3E]">
                  {isInvoice
                    ? doc.customerAccepted
                      ? 'Customer Accepted'
                      : 'Issued'
                    : String(doc.status)}
                </dd>
              </div>
            </dl>
          </section>

          {Boolean(doc.scope) && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <strong className="text-[#081E3E]">Scope: </strong>
              {String(doc.scope)}
            </div>
          )}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-[#081E3E] text-xs uppercase text-slate-600">
                <tr>
                  <th className="py-2.5 pr-3">No.</th>
                  <th className="py-2.5 pr-3">Description</th>
                  <th className="py-2.5 pr-3 text-right">Qty</th>
                  <th className="py-2.5 pr-3 text-right">Unit Price</th>
                  <th className="py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item, idx) => (
                  <tr key={`${item.sku}-${idx}`}>
                    <td className="font-mono-num py-3 pr-3 text-xs text-slate-500">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-slate-900">{item.description}</div>
                      <div className="font-mono-num text-xs text-slate-500">
                        {item.sku} · {item.unit}
                      </div>
                    </td>
                    <td className="font-mono-num py-3 pr-3 text-right">{item.qty}</td>
                    <td className="font-mono-num py-3 pr-3 text-right">{formatNgn(item.unitPriceNgn)}</td>
                    <td className="font-mono-num py-3 text-right font-semibold text-slate-900">
                      {formatNgn(item.qty * item.unitPriceNgn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
            <div>
              {isInvoice && bank ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                  <div className="font-semibold uppercase tracking-wider text-[#D61F26]">
                    Receiving Bank Account
                  </div>
                  <div className="mt-2 text-sm font-bold text-[#081E3E]">{bank.bankName}</div>
                  <div className="text-slate-600">{bank.accountName}</div>
                  <div className="font-mono-num mt-1 text-base font-bold text-slate-900">
                    {bank.accountNumber}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  <div className="font-semibold text-[#081E3E]">Commercial Terms</div>
                  <p className="mt-1">{String(doc.terms || 'Subject to site inspection and MD sign-off.')}</p>
                </div>
              )}
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="font-mono-num font-semibold">{formatNgn(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Discount</dt>
                <dd className="font-mono-num font-semibold text-emerald-700">− {formatNgn(totals.discount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">VAT ({String(doc.taxPercent || 0)}%)</dt>
                <dd className="font-mono-num font-semibold">{formatNgn(totals.tax)}</dd>
              </div>
              <div className="flex justify-between border-t-2 border-[#081E3E] pt-3 text-base font-extrabold text-[#081E3E]">
                <dt>{isInvoice ? 'TOTAL DUE' : 'QUOTATION TOTAL'}</dt>
                <dd className="font-mono-num">{formatNgn(totals.total)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </article>
    </div>
  );
}
