import { calculateLine, totals, validPODate } from './purchaseOrders.js';
import { renderPOInvoicePages } from './poInvoiceRender.js';

export const PO_TEMPLATE_KEY = 'evexia.admin.document-templates.v1';
export const PO_TEMPLATES = [
  { id: 'classic', name: 'EVEXIA Classic', description: 'A supplier document based on your sample, with a formal header, item grid and signature box.' },
  { id: 'modern', name: 'EVEXIA Modern', description: 'A branded layout with clear order details and a prominent final total.' },
  { id: 'compact', name: 'EVEXIA Compact', description: 'A space-efficient layout for orders with many product lines.' },
];
const company = {
  name: 'EVEXIA LIFE SCIENCES PVT. LTD.',
  address: '2nd floor, Laud Mansion, Mumbai - 400 004',
  email: 'info@evexialifesciences.com',
  website: 'www.evexialifesciences.com',
};
function checkTemplate(id) {
  if (!PO_TEMPLATES.some((template) => template.id === id)) throw new Error('Choose a supported PO invoice template.');
  return id;
}
export function loadPOTemplatePreference() {
  let raw;
  try { raw = window.localStorage.getItem(PO_TEMPLATE_KEY); }
  catch { throw new Error('Template preferences could not be read. Check browser storage settings.'); }
  if (raw === null) return 'classic';
  let preference;
  try { preference = JSON.parse(raw); }
  catch { throw new Error('Saved template preferences are unreadable. Reset the template preference in Settings > Templates; purchase orders will not be changed.'); }
  if (!preference || Array.isArray(preference) || preference.version !== 1 ||
    Object.keys(preference).length !== 2 || !Object.hasOwn(preference, 'defaultPOInvoiceTemplate') ||
    !PO_TEMPLATES.some((template) => template.id === preference.defaultPOInvoiceTemplate)) {
    throw new Error('Saved template preferences are invalid. Reset the template preference in Settings > Templates; purchase orders will not be changed.');
  }
  return preference.defaultPOInvoiceTemplate;
}
export function setDefaultPOTemplate(id) {
  checkTemplate(id);
  loadPOTemplatePreference();
  try { window.localStorage.setItem(PO_TEMPLATE_KEY, JSON.stringify({ version: 1, defaultPOInvoiceTemplate: id })); }
  catch { throw new Error('The default template could not be saved. Check browser storage settings and try again.'); }
  return id;
}
export function resetPOTemplatePreference() {
  try { window.localStorage.removeItem(PO_TEMPLATE_KEY); }
  catch { throw new Error('The template preference could not be reset. Check browser storage settings and try again.'); }
  return 'classic';
}
// Read the current value, not event.newValue: another tab may have written again.
export function subscribePOTemplatePreference(onChange) {
  function refresh(event) {
    if (event.key !== PO_TEMPLATE_KEY && event.key !== null) return;
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      // Let the loader report storage access failures to the gallery.
    }
    let state;
    try { state = { id: loadPOTemplatePreference(), error: '' }; }
    catch (error) { state = { id: null, error: error.message }; }
    onChange(state);
  }
  window.addEventListener('storage', refresh);
  return () => window.removeEventListener('storage', refresh);
}
function documentFromModel(model, templateId) {
  checkTemplate(templateId);
  const figures = totals(model.lines);
  if (!figures || ['subtotal', 'gstAmount', 'total'].some((field) => figures[field] !== model[field]) ||
    !validPODate(model.poDate) || !validPODate(model.expectedDate)) {
    throw new Error('This order contains invalid invoice figures or dates. Refresh purchase orders and try again.');
  }
  return { templateId, number: model.number, model, pages: renderPOInvoicePages(model, templateId) };
}
export function makePOInvoiceDocument(order, refs, templateId = loadPOTemplatePreference()) {
  const vendor = refs.vendors.find((item) => item.id === order.vendorId);
  return documentFromModel({
    company, number: order.number, poDate: order.poDate, expectedDate: order.expectedDate,
    locationName: order.locationName, status: order.status, isSample: order.id.startsWith('sample-po-'),
    vendor: { name: order.vendorName, address: vendor?.registeredAddress || '', gstNo: vendor?.gstNo || '' },
    lines: order.lines.map((line) => ({
      ...line, hsnCode: refs.products.find((product) => product.id === line.productId)?.hsnCode || '',
    })),
    subtotal: order.subtotal, gstAmount: order.gstAmount, total: order.total,
  }, templateId);
}
export function makeSampleInvoiceDocument(templateId) {
  const lines = [
    { productName: 'Sample Diagnostic Reagent', hsnCode: '3822', quantity: 24, unitPrice: 425, gst: 12 },
    { productName: 'Sample Lab Buffer', hsnCode: '3822', quantity: 12, unitPrice: 115.5, gst: 18 },
  ].map((line) => ({ ...line, ...calculateLine(line) }));
  return documentFromModel({
    company, number: 'PO-SAMPLE-001', poDate: '2026-10-01', expectedDate: '2026-10-05',
    locationName: 'Sample Main Warehouse', status: 'open', isSample: true,
    vendor: { name: 'Sample North Supply', address: 'Demo address, North District', gstNo: '27AAAAA0000A1Z5' },
    lines, ...totals(lines),
  }, templateId);
}