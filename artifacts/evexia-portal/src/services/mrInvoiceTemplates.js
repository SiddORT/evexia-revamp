import { createSamplePreference } from './immunotherapyTemplates.js';
import { INVOICE_FIELDS } from './serverInvoiceSettings.js';
export { termLines } from './serverInvoiceSettings.js';

// Settings samples only. Not connected to MR Accounts, orders, payments or downloads.
export const MR_INVOICE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'evexia-mr-invoice-modern-v1', name: 'Modern Professional',
    description: 'A4 with the EVEXIA logo, teal and slate headings, thin rules, a clear total and three aligned information panels.',
  }),
  Object.freeze({
    id: 'evexia-mr-invoice-classic-v1', name: 'Reference Classic',
    description: 'Keeps the supplied reference’s bordered boxes and section order, with cleaner type and spacing.',
  }),
]);

export const mrInvoiceTemplatePreference = createSamplePreference({ type: 'mr-invoice', label: 'MR invoice', templates: MR_INVOICE_TEMPLATES });

const ITEMS = Object.freeze([
  { description: 'Sample allergen extract vial set', hsn: '30049099', batch: 'SMP-24A', qty: 2, rate: 145000 },
  { description: 'Sample sterile diluent 10 ml', hsn: '30049099', batch: 'SMP-17C', qty: 4, rate: 18550 },
  { description: 'Sample dosing syringe pack', hsn: '90183100', batch: 'SMP-09K', qty: 1, rate: 31275 },
]);

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n) {
  const h = Math.floor(n / 100); const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}
export function rupeesInWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000); const lakh = Math.floor(n / 100000) % 100; const thousand = Math.floor(n / 1000) % 100;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n % 1000) parts.push(below1000(n % 1000));
  return parts.join(' ');
}

export const money = (paise) => `${paise < 0 ? '-' : ''}${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function sampleTransaction() {
  const items = ITEMS.map((item) => ({ ...item, taxable: item.qty * item.rate }));
  const subtotal = items.reduce((sum, item) => sum + item.taxable, 0);
  const tax = Math.round(subtotal * 0.05);
  const discount = 15000;
  const beforeRound = subtotal + tax - discount;
  const total = Math.round(beforeRound / 100) * 100;
  return Object.freeze({
    invoiceNo: 'SAMPLE-MR-0417', orderNo: 'SAMPLE-ORD-2291', date: '14 Aug 2025',
    supplyDate: '14 Aug 2025', transport: 'Sample courier', mr: 'Sample MR',
    doctor: { name: 'Dr. Meera Raghunathan (sample)', clinic: 'Sample Allergy Clinic', city: 'Coimbatore, Tamil Nadu' },
    patient: { name: 'Arjun Sethi (sample)', ref: 'SMP-PT-0083', age: '34 years' },
    items, subtotal, tax, taxLabel: 'Illustrative tax (5%)', discount, roundOff: total - beforeRound, total,
    words: `Rupees ${rupeesInWords(total / 100)} Only`,
  });
}

// snapshot: one immutable saved Invoice Details view (or null). access tells the
// renderer why details may be absent. QR bytes are never part of this document.
export function makeSampleMRInvoiceDocument(templateId, snapshot = null, access = 'restricted') {
  mrInvoiceTemplatePreference.checkTemplate(templateId);
  const details = snapshot?.configured ? Object.freeze(Object.fromEntries(INVOICE_FIELDS.map((f) => [f, snapshot.details[f]]))) : null;
  return Object.freeze({
    type: 'mr-invoice', templateId, style: templateId === MR_INVOICE_TEMPLATES[1].id ? 'classic' : 'modern',
    access, details, version: snapshot?.version ?? null, qrConfigured: Boolean(snapshot?.qr), transaction: sampleTransaction(),
  });
}
