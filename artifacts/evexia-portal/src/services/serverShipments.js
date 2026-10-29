import { purchaseOrderRequest } from '../auth/adminSession.js';
import { writeOrderCsv } from './orderTransferCsv.js';
import { writeOrderWorkbook } from './orderTransferWorkbook.js';
import { presentExportTable } from './exportDatePresentation.js';
import { captureExportPreferences } from './exportPreferences.js';
import { downloadBlob, prepareDownload } from './downloads.js';
import { announceOrderChange } from './orderFreshness.js';

export const SHIPMENT_STATUSES = ['All', 'In process', 'Shipped', 'Returned'];
export const SHIPMENT_TYPES = ['All', 'Kit', 'IT', 'Lupin', 'SPT'];
export const TYPE_LABELS = { Kit: 'Kits & Consumables', IT: 'Immunotherapy', Lupin: 'Lupin', SPT: 'SPT' };
export const TYPE_PATHS = { Kit: 'Kit', IT: 'IT', Lupin: 'Lupin', SPT: 'SPT' };
// Source listing freshness channels (see orderFreshness.js useOrderListFreshness).
export const TYPE_FRESHNESS = { Kit: 'kits', IT: 'immunotherapy', Lupin: 'lupin', SPT: 'spt' };
export const EMPTY_FILTERS = { search: '', status: 'All', type: 'All', from_date: '', to_date: '' };
export const EXPORT_LIMIT = 5000;


export const shipmentRequest = (path, options) => purchaseOrderRequest(path, options, 'shipments');

function clean(filters) {
  const out = {};
  for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

export const listShipments = (filters, { offset, limit, signal }) =>
  shipmentRequest('', { params: { ...clean(filters), offset, limit }, signal });

export async function fetchCourierPage(query, offset, signal) {
  const data = await shipmentRequest('/couriers', { params: { search: query || undefined, offset, limit: 25 }, signal });
  return { items: (data.items || []).map((c) => ({ value: c.id, label: c.name, raw: c })), total: data.total ?? 0 };
}

// Mutation path resolved from the row's server identity only.
export const mutationPath = (row, action) => `/${encodeURIComponent(TYPE_PATHS[row.type] || row.type)}/${encodeURIComponent(row.id)}/${action}`;

export async function sendFrozen(frozen, row) {
  const updated = await shipmentRequest(frozen.path, { body: frozen.body });
  if (!updated || String(updated.id) !== String(row.id) || updated.type !== row.type || typeof updated.version !== 'number' || updated.version <= row.version) {
    const error = new Error('The server reply did not confirm this order and version.');
    error.ambiguous = true;
    throw error;
  }
  return updated;
}

const FRESHNESS = { Kit: 'kits-orders', IT: 'immunotherapy-orders', Lupin: 'lupin-orders', SPT: 'spt-orders' };
export function announceShipmentChange(type) {
  try { if (FRESHNESS[type]) announceOrderChange(FRESHNESS[type]); announceOrderChange('shipments-orders'); }
  catch { /* Visible lists still refresh periodically. */ }
}

export const todayISO = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
export const isoDatePart = (value) => (value ? String(value).slice(0, 10) : '');

const HEADERS = ['Type', 'Order number', 'Order date', 'Value', 'Doctor', 'MR', 'Recipient', 'Shipping address', 'Courier', 'Tracking ID', 'Expected delivery date', 'Actual delivery date', 'Shipment event (UTC)', 'Shipped on', 'Order status', 'Payment status'];
const UNAVAILABLE = 'Unavailable';

const shippedDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

// Value stays the server's exact decimal string; never parsed to a float.
export function shipmentExportRows(items) {
  return items.map((r) => [
    TYPE_LABELS[r.type] || r.type, r.number, r.date, r.value ?? UNAVAILABLE, r.doctor ?? UNAVAILABLE, r.mr ?? UNAVAILABLE,
    r.recipient ?? UNAVAILABLE, r.address ?? UNAVAILABLE, r.courier ?? '', r.trackingId ?? '', r.expectedDeliveryDate ?? '',
    r.actualDeliveryDate ?? '', r.shippedAt ?? '', shippedDay(r.shippedAt), r.status, r.paymentStatus ?? UNAVAILABLE,
  ].map((v) => (v == null ? '' : String(v))));
}

// One trusted click => one complete file. All matching rows come from /export, never visible rows.
export function exportShipments(filters, format) {
  const fmt = format === 'xlsx' ? 'XLSX' : 'CSV';
  return prepareDownload(`shipments/${fmt}`, async () => {
    const preferences = captureExportPreferences();
    const snapshot = todayISO();
    const data = await shipmentRequest('/export', { params: clean(filters) });
    const items = data?.items || [];
    if (!Number.isSafeInteger(data?.total) || data.total !== items.length || items.length > EXPORT_LIMIT) {
      throw new Error(`Export incomplete: ${items.length} of ${data.total} matching shipments returned. No file was released. Narrow the filters and export again.`);
    }
    if (!items.length) throw new Error('No shipments match the applied filters. No file was released.');
    const table = presentExportTable(HEADERS, shipmentExportRows(items), { calendarColumns: [2, 10, 11, 13], timestampColumns: [12] }, preferences);
    const blob = fmt === 'CSV' ? new Blob([writeOrderCsv(table)], { type: 'text/csv;charset=utf-8' }) : writeOrderWorkbook(table);
    await downloadBlob(blob, `evexia-shipments-${snapshot}.${fmt.toLowerCase()}`, { source: 'shipments', kind: 'export', format: fmt });
    return items.length;
  });
}
