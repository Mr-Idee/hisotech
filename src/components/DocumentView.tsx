import { ArrowLeft, Download, Mail, Printer, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { listenForCustomerLogout } from '../lib/auth-sync';
import { calculateDocumentTotals, formatNgn } from '../lib/solar';
import { createDocumentPdf, downloadDocumentPdf } from '../lib/document-pdf';
import { amountInNairaWords } from '../lib/currency-words';
import type { BankDetails, LineItem } from '../lib/types';

let companyLogoPromise: Promise<string> | null = null;

function loadCompanyLogoDataUrl(): Promise<string> {
  if (!companyLogoPromise) {
    companyLogoPromise = fetch('/assets/hisotech-logo-mark.png')
      .then(async (response) => {
        if (!response.ok) throw new Error('The company logo could not be loaded for the PDF.');
        return response.blob();
      })
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('The company logo could not be read for the PDF.'));
        reader.onload = () => {
          if (typeof reader.result !== 'string') {
            reject(new Error('The company logo could not be converted for the PDF.'));
            return;
          }
          resolve(reader.result);
        };
        reader.readAsDataURL(blob);
      }))
      .catch((error: unknown) => {
        companyLogoPromise = null;
        throw error;
      });
  }
  return companyLogoPromise;
}

interface DocumentViewProps {
  type: 'quote' | 'invoice';
  id: string;
  canEmail: boolean;
  bankDetails: BankDetails;
  onBack: () => void;
}

function sampleDocument(type: 'quote' | 'invoice', bankDetails: BankDetails): Record<string, unknown> {
  const issuedDate = new Date();
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);
  const validUntil = new Date(issuedDate);
  validUntil.setDate(validUntil.getDate() + 7);
  const dueDate = new Date(issuedDate);
  dueDate.setDate(dueDate.getDate() + 7);
  const items: LineItem[] = [
    { sku: 'SAMPLE-INV-3KVA', description: '3KVA 24V Hybrid Inverter', unit: 'unit', qty: 1, unitPriceNgn: 400_000 },
    { sku: 'SAMPLE-BAT-5KWH', description: '5KWH 24V Lithium Ion Battery Bank', unit: 'unit', qty: 1, unitPriceNgn: 1_230_000 },
    { sku: 'SAMPLE-PV-2.5KW', description: '2.5KW Monocrystalline Solar Array', unit: 'panel', qty: 6, unitPriceNgn: 120_000 },
    { sku: 'SAMPLE-ACCESSORIES', description: 'Installation Accessories', unit: 'lot', qty: 1, unitPriceNgn: 430_000 },
    { sku: 'SAMPLE-INSTALLATION', description: 'Logistics and Installation', unit: 'lot', qty: 1, unitPriceNgn: 350_000 },
  ];

  return {
    type,
    documentCode: type === 'invoice' ? 'SAMPLE-INV-001' : 'SAMPLE-QUO-001',
    refCode: 'SAMPLE-REF-001',
    customerName: 'Sample Customer',
    location: 'Sample Site, Abuja',
    phone: 'N/A',
    email: '',
    status: type === 'invoice' ? 'Sample' : 'Approved',
    customerAccepted: false,
    issuedDate: formatDate(issuedDate),
    validUntil: formatDate(validUntil),
    dueDate: formatDate(dueDate),
    scope: 'Supply and installation of a 3kVA-5kWh-2.5kW solar hybrid inverter system.',
    terms: 'This example follows the supplied quotation. Quotation validity: 7 days.',
    note: 'Installation warranty is limited to installation work for 2 years. Product warranty coverage is subject to the manufacturer.',
    discountNgn: 0,
    taxPercent: 0,
    bankDetails,
    items,
  };
}

function documentPdfData(doc: Record<string, unknown>, type: 'quote' | 'invoice') {
  const bank = doc.bankDetails && typeof doc.bankDetails === 'object'
    ? doc.bankDetails as BankDetails
    : undefined;
  return {
    type,
    documentCode: String(doc.documentCode || 'document'),
    customerName: String(doc.customerName || 'Customer'),
    location: String(doc.location || ''),
    phone: String(doc.phone || ''),
    email: String(doc.email || ''),
    refCode: String(doc.refCode || ''),
    issuedDate: String(doc.issuedDate || ''),
    dueDate: String(doc.dueDate || ''),
    validUntil: String(doc.validUntil || ''),
    status: String(doc.status || ''),
    scope: String(doc.scope || ''),
    terms: String(doc.terms || ''),
    note: String(doc.note || ''),
    discountNgn: Number(doc.discountNgn || 0),
    taxPercent: Number(doc.taxPercent || 0),
    items: Array.isArray(doc.items) ? doc.items as LineItem[] : [],
    bankDetails: bank,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function DocumentView({ type, id, canEmail, bankDetails, onBack }: DocumentViewProps) {
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const isSample = id === 'sample-quote' || id === 'sample-invoice';

  useEffect(() => {
    let active = true;
    setDoc(null);
    setError('');
    setActionMessage('');
    if (isSample) {
      setDoc(sampleDocument(type, bankDetails));
      return () => {
        active = false;
      };
    }

    api
      .getDocument(type, id)
      .then((result) => {
        if (active) setDoc(result);
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      });
    return () => {
      active = false;
    };
  }, [type, id, bankDetails, isSample]);

  useEffect(() => {
    if (canEmail || isSample) return;
    return listenForCustomerLogout(() => {
      setDoc(null);
      setError('Your customer session ended in another tab. Sign in again to view this document.');
    });
  }, [canEmail, isSample]);

  async function createPdf() {
    if (!doc) throw new Error('Document is not ready.');
    return createDocumentPdf({
      ...documentPdfData(doc, type),
      logoDataUrl: await loadCompanyLogoDataUrl(),
    });
  }

  async function handleDownload() {
    setBusy(true);
    setActionMessage('');
    try {
      const blob = await createPdf();
      downloadDocumentPdf(blob, String(doc?.documentCode || type));
      setActionMessage('PDF downloaded.');
    } catch (actionError) {
      setActionMessage((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    setActionMessage('');
    try {
      const blob = await createPdf();
      const filename = `${String(doc?.documentCode || type).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (typeof navigator.share !== 'function' || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
        setActionMessage('This browser cannot share PDF attachments. Download the PDF, then attach it in WhatsApp or your mail app.');
        return;
      }
      await navigator.share({
        title: String(doc?.documentCode || (type === 'invoice' ? 'Invoice' : 'Quotation')),
        files: [file],
      });
      setActionMessage('PDF shared.');
    } catch (actionError) {
      if ((actionError as Error).name !== 'AbortError') {
        setActionMessage((actionError as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail() {
    if (isSample) return;
    setBusy(true);
    setActionMessage('');
    try {
      const blob = await createPdf();
      if (blob.size > 2 * 1024 * 1024) {
        throw new Error('This PDF exceeds the 2MB email attachment limit.');
      }
      const filename = `${String(doc?.documentCode || type).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
      await api.sendDocumentEmail({
        type,
        id,
        attachment: {
          name: filename,
          mimeType: 'application/pdf',
          data: await blobToBase64(blob),
          size: blob.size,
        },
      });
      setActionMessage('PDF emailed to the customer address on file.');
    } catch (actionError) {
      setActionMessage((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
  const hasBankDetails = Boolean(bank && Object.values(bank).some(Boolean));

  return (
    <div className="document-print mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-[#081E3E]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={handleDownload} className="inline-flex items-center gap-2 rounded-lg bg-[#081E3E] px-3 py-2 text-sm font-semibold text-white hover:bg-[#D61F26] disabled:opacity-60">
            <Download className="h-4 w-4" /> Download PDF
          </button>
          <button type="button" disabled={busy} onClick={handleShare} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#081E3E] disabled:opacity-60">
            <Share2 className="h-4 w-4" /> Share PDF
          </button>
          {canEmail && !isSample && (
            <button type="button" disabled={busy} onClick={handleEmail} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#081E3E] disabled:opacity-60">
              <Mail className="h-4 w-4" /> Email customer
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#081E3E] disabled:opacity-60">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>
      {actionMessage && <p role="status" className="no-print mb-4 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-200">{actionMessage}</p>}

      <article className="document-print-sheet overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
        <div className="h-2 bg-[#D61F26]" />
        <div className="document-print-content p-8 sm:p-10">
          {isSample && (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
              Sample document for layout and pricing reference only. Do not use for payment or fulfilment.
            </div>
          )}
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
                {isInvoice ? 'INVOICE' : 'QUOTATION'}
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
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-[15px] font-bold capitalize text-slate-700 underline decoration-slate-500 underline-offset-2">
              Scope: {String(doc.scope)}
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
                    <td className="font-mono-num py-3 pr-3 text-right">{item.isTbd ? 'TBD' : formatNgn(item.unitPriceNgn)}</td>
                    <td className="font-mono-num py-3 text-right font-semibold text-slate-900">
                      {item.isTbd ? 'To Be Determined' : formatNgn(item.qty * item.unitPriceNgn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
            <div>
              {isInvoice && hasBankDetails && bank ? (
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
              ) : doc.terms ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  <div className="font-semibold text-[#081E3E]">Commercial Terms</div>
                  <p className="mt-1">{String(doc.terms)}</p>
                </div>
              ) : null}
              {String(doc.note || '').trim() && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                  <div className="font-semibold text-[#704B00]">Note</div>
                  <p className="mt-1 whitespace-pre-wrap">{String(doc.note)}</p>
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
          <p className="mt-4 text-sm font-medium leading-relaxed text-slate-700 sm:text-base">
            <strong className="text-[#081E3E]">Amount in words: </strong>
            {amountInNairaWords(totals.total)}
          </p>

          <section aria-label="Warranty and expected equipment life" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
            <h2 className="font-bold uppercase tracking-wide">Warranty &amp; expected equipment life</h2>
            <p className="mt-1"><strong>Installation warranty:</strong> 2 years on installation work only; excludes theft, natural disasters, and end-user error. Product warranty coverage is subject to each manufacturer’s written terms.</p>
            <p className="mt-1"><strong>Expected service lifetime:</strong> inverters 5–10 years; battery banks 5–15 years; solar panels 10–25 years. These are estimates, not guaranteed lifetimes.</p>
          </section>
        </div>
      </article>
    </div>
  );
}
