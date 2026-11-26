import { calculateDocumentTotals, formatNgn } from './solar';
import { amountInNairaWords } from './currency-words';
import type { BankDetails, LineItem } from './types';

export interface DocumentPdfData {
  type: 'quote' | 'invoice';
  documentCode: string;
  customerName: string;
  location: string;
  phone: string;
  email: string;
  refCode: string;
  issuedDate: string;
  dueDate: string;
  validUntil: string;
  status: string;
  scope: string;
  terms: string;
  note: string;
  discountNgn: number;
  taxPercent: number;
  items: LineItem[];
  bankDetails?: BankDetails;
  logoDataUrl?: string;
}

function printableText(value: string): string {
  return value
    .replace(/₦/g, 'NGN ')
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '|')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function titleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

export async function createDocumentPdf(data: DocumentPdfData): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 16;
  const right = pageWidth - 16;
  const width = right - left;
  let y = 16;

  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - 18) {
      pdf.addPage();
      y = 16;
    }
  };

  pdf.setFillColor(214, 31, 38);
  pdf.rect(0, 0, pageWidth, 4, 'F');
  pdf.setTextColor(8, 30, 62);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  if (data.logoDataUrl) pdf.addImage(data.logoDataUrl, 'PNG', left, y - 2, 12, 12);
  const brandLeft = data.logoDataUrl ? left + 15 : left;
  pdf.text('HI-SOTECH', brandLeft, y + 3);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(90, 101, 118);
  pdf.setFontSize(8);
  pdf.text('Solar Inverter Co. Ltd | No. 5 Adamu Fika St, Life Camp, Abuja', brandLeft, y + 9);

  const isInvoice = data.type === 'invoice';
  pdf.setTextColor(214, 31, 38);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text(isInvoice ? 'COMMERCIAL DOCUMENT' : 'TECHNICAL PROPOSAL', right, y + 2, { align: 'right' });
  pdf.setTextColor(8, 30, 62);
  pdf.setFontSize(16);
  pdf.text(isInvoice ? 'INVOICE' : 'QUOTATION', right, y + 10, { align: 'right' });
  y += 20;

  pdf.setDrawColor(220, 225, 232);
  pdf.line(left, y, right, y);
  y += 6;

  pdf.setTextColor(110, 120, 134);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('PREPARED FOR', left, y);
  pdf.text('DOCUMENT DETAILS', 116, y);
  y += 5;

  pdf.setTextColor(8, 30, 62);
  pdf.setFontSize(11);
  pdf.text(printableText(data.customerName), left, y);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  const details = [
    data.location,
    [data.phone, data.email].filter(Boolean).join(' | '),
  ].filter(Boolean);
  let customerY = y + 5;
  for (const detail of details) {
    pdf.text(pdf.splitTextToSize(printableText(detail), 88), left, customerY);
    customerY += 4;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Reference: ${printableText(data.refCode)}`, 116, y);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Issued: ${printableText(data.issuedDate)}`, 116, y + 5);
  pdf.text(
    `${isInvoice ? 'Payment due' : 'Valid until'}: ${printableText(isInvoice ? data.dueDate : data.validUntil)}`,
    116,
    y + 10
  );
  pdf.text(`Status: ${printableText(data.status)}`, 116, y + 15);
  y = Math.max(customerY, y + 20) + 3;

  if (data.scope) {
    pdf.setFillColor(247, 248, 250);
    pdf.setDrawColor(220, 225, 232);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    const scopeLines = pdf.splitTextToSize(`Scope: ${titleCase(printableText(data.scope))}`, width - 10) as string[];
    const scopeHeight = scopeLines.length * 4.5 + 7;
    ensureSpace(scopeHeight);
    pdf.roundedRect(left, y, width, scopeHeight, 2, 2, 'FD');
    pdf.setTextColor(55, 65, 81);
    scopeLines.forEach((line, index) => {
      const lineY = y + 5 + index * 4.5;
      pdf.text(line, left + 5, lineY);
      pdf.setDrawColor(55, 65, 81);
      pdf.setLineWidth(0.2);
      pdf.line(left + 5, lineY + 0.6, left + 5 + pdf.getTextWidth(line), lineY + 0.6);
    });
    y += scopeHeight + 5;
  }

  const columns = { number: left, description: left + 11, qty: right - 69, unit: right - 49, amount: right };
  const drawTableHeader = () => {
    ensureSpace(10);
    pdf.setFillColor(8, 30, 62);
    pdf.rect(left, y, width, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text('NO.', columns.number + 2, y + 5.3);
    pdf.text('DESCRIPTION', columns.description, y + 5.3);
    pdf.text('QTY', columns.qty, y + 5.3, { align: 'right' });
    pdf.text('UNIT PRICE', columns.unit, y + 5.3, { align: 'right' });
    pdf.text('AMOUNT', columns.amount - 2, y + 5.3, { align: 'right' });
    y += 8;
  };
  drawTableHeader();

  data.items.forEach((item, index) => {
    const description = pdf.splitTextToSize(printableText(`${item.description} | ${item.sku} | ${item.unit}`), 89) as string[];
    const rowHeight = Math.max(9, description.length * 3.8 + 4);
    if (y + rowHeight > pageHeight - 24) {
      pdf.addPage();
      y = 16;
      drawTableHeader();
    }
    pdf.setDrawColor(225, 229, 235);
    pdf.line(left, y + rowHeight, right, y + rowHeight);
    pdf.setTextColor(100, 110, 122);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.text(String(index + 1).padStart(2, '0'), columns.number + 2, y + 5);
    pdf.setTextColor(31, 41, 55);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text(description, columns.description, y + 4.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(String(item.qty), columns.qty, y + 5, { align: 'right' });
    pdf.text(printableText(formatNgn(item.unitPriceNgn)).replace('₦', 'NGN '), columns.unit, y + 5, { align: 'right' });
    pdf.setFont('helvetica', 'bold');
    pdf.text(printableText(formatNgn(item.qty * item.unitPriceNgn)).replace('₦', 'NGN '), columns.amount - 2, y + 5, { align: 'right' });
    y += rowHeight;
  });

  const totals = calculateDocumentTotals(data.items, data.discountNgn, data.taxPercent);
  const totalsWidth = 72;
  const totalsLeft = right - totalsWidth;
  const summaryHeight = 30;
  ensureSpace(summaryHeight + 12);
  y += 6;
  const totalRows = [
    ['Subtotal', formatNgn(totals.subtotal)],
    ['Discount', `- ${formatNgn(totals.discount)}`],
    [`VAT (${data.taxPercent}%)`, formatNgn(totals.tax)],
  ];
  pdf.setFontSize(8);
  pdf.setTextColor(100, 110, 122);
  totalRows.forEach(([label, amount], index) => {
    pdf.setFont('helvetica', 'normal');
    pdf.text(printableText(label), totalsLeft, y + index * 5);
    pdf.setTextColor(31, 41, 55);
    pdf.text(printableText(amount).replace('₦', 'NGN '), right, y + index * 5, { align: 'right' });
    pdf.setTextColor(100, 110, 122);
  });
  y += 17;
  pdf.setDrawColor(8, 30, 62);
  pdf.setLineWidth(0.7);
  pdf.line(totalsLeft, y, right, y);
  y += 6;
  pdf.setTextColor(8, 30, 62);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text(isInvoice ? 'TOTAL DUE' : 'QUOTATION TOTAL', totalsLeft, y);
  pdf.text(printableText(formatNgn(totals.total)).replace('₦', 'NGN '), right, y, { align: 'right' });
  y += 10;

  const amountWords = pdf.splitTextToSize(`Amount in words: ${amountInNairaWords(totals.total)}`, width) as string[];
  ensureSpace(amountWords.length * 4.8 + 6);
  pdf.setTextColor(75, 85, 99);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text(amountWords, left, y);
  y += amountWords.length * 4.8 + 6;

  if (isInvoice && data.bankDetails && Object.values(data.bankDetails).some(Boolean)) {
    ensureSpace(24);
    pdf.setTextColor(214, 31, 38);
    pdf.setFontSize(8);
    pdf.text('RECEIVING BANK ACCOUNT', left, y);
    y += 5;
    pdf.setTextColor(31, 41, 55);
    pdf.setFontSize(8);
    pdf.text(`Bank: ${printableText(data.bankDetails.bankName)}`, left, y);
    pdf.text(`Account name: ${printableText(data.bankDetails.accountName)}`, left, y + 4);
    pdf.text(`Account number: ${printableText(data.bankDetails.accountNumber)}`, left, y + 8);
    y += 13;
  }

  if (data.terms) {
    const termsLines = pdf.splitTextToSize(printableText(data.terms), width) as string[];
    ensureSpace(8 + termsLines.length * 3.84);
    pdf.setTextColor(8, 30, 62);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('COMMERCIAL TERMS', left, y);
    y += 4;
    pdf.setTextColor(75, 85, 99);
    pdf.setFont('helvetica', 'normal');
    pdf.text(termsLines, left, y);
    y += termsLines.length * 3.84 + 2;
  }

  if (data.note) {
    const noteLines = pdf.splitTextToSize(printableText(data.note), width) as string[];
    ensureSpace(8 + noteLines.length * 3.84);
    pdf.setTextColor(106, 73, 16);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('NOTE', left, y);
    y += 4;
    pdf.setTextColor(75, 85, 99);
    pdf.setFont('helvetica', 'normal');
    pdf.text(noteLines, left, y);
    y += noteLines.length * 3.84 + 2;
  }

  const warrantyItems = [
    {
      label: 'Installation warranty',
      text: "2 years on installation work only. Excludes theft, natural disasters, and end-user error. Product coverage is subject to each manufacturer's written warranty.",
    },
    {
      label: 'Expected service lifetime',
      text: 'Inverters 5-10 years; battery banks 5-15 years; solar panels 10-25 years. These are estimates, not guaranteed lifetimes.',
    },
  ].map((item) => ({
    ...item,
    lines: pdf.splitTextToSize(printableText(item.text), width - 10) as string[],
  }));
  const warrantyHeight = 10 + warrantyItems.reduce((height, item) => height + 4 + item.lines.length * 3.6 + 2, 0);
  ensureSpace(warrantyHeight);
  pdf.setFillColor(255, 249, 235);
  pdf.setDrawColor(240, 218, 172);
  pdf.roundedRect(left, y, width, warrantyHeight, 2, 2, 'FD');
  pdf.setTextColor(106, 73, 16);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('WARRANTY & EXPECTED EQUIPMENT LIFE', left + 5, y + 5);
  y += 9;
  for (const item of warrantyItems) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(`${item.label}:`, left + 5, y);
    y += 3.8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(item.lines, left + 5, y);
    y += item.lines.length * 3.6 + 2;
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setTextColor(130, 140, 152);
    pdf.setFontSize(7);
    pdf.text('HI-SOTECH Solar Inverter Co. Ltd', left, pageHeight - 8);
    pdf.text(`${page} / ${pageCount}`, right, pageHeight - 8, { align: 'right' });
  }

  return pdf.output('blob');
}

export function downloadDocumentPdf(blob: Blob, documentCode: string): string {
  const filename = `${documentCode.replace(/[^A-Za-z0-9._-]/g, '_') || 'document'}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
