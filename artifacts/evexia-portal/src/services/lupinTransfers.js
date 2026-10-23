import { request, orderInput } from './serverLupin.js';
import { safeJson, parseDate, readContext } from './orderTransfers.js';
import { readOrderCsv, writeOrderCsv, decodeTransferCell, TRANSFER_MAX_BYTES } from './orderTransferCsv.js';
import { readOrderWorkbook, writeOrderWorkbook } from './orderTransferWorkbook.js';
import { exportDate } from './exportDatePresentation.js';
import { downloadBlob } from './downloads.js';

const HEADERS = ['Schema', 'Order type', 'Date context JSON', 'Order ID', 'Order number', 'Order date', 'Order details JSON', 'Patient snapshot JSON'];
const SCHEMA = 'evexia.lupin-orders/1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function output(orders, preferences, format) {
  const context = JSON.stringify({ dateFormat: preferences.dateFormat, timeZone: preferences.resolvedTimeZone || preferences.timeZone, clock: preferences.clock, cellEncoding: 'apostrophe-v1' });
  const rows = [HEADERS, ...orders.map(({ id, number, date, ...details }) => [
    SCHEMA, 'lupin', context, id, number, exportDate(date, preferences),
    JSON.stringify({ ...details, attachments: [], attachmentIds: [] }), JSON.stringify(details.patients || []),
  ])];
  const blob = format === 'csv' ? new Blob([writeOrderCsv(rows)], { type: 'text/csv;charset=utf-8' }) : writeOrderWorkbook(rows);
  if (blob.size > TRANSFER_MAX_BYTES) throw new Error('Export exceeds 8 MB. Narrow filters; no partial download.');
  return blob;
}
export function createLupinTransferAdapter(filters, onSaved) {
  return {
    retainUncertain: true,
    scope: 'Export includes all saved orders matching applied filters across pagination, or rejects completeness limits. File contents, usable URLs and credentials are excluded.',
    instructions: 'Use the eight-column Lupin template. Order details JSON: doctorId and mrId (required real UUIDs), patientIds (optional array of up to 200 existing Patient UUIDs), patientCount (integer 1–1,000,000), price (positive INR text, up to nine whole digits and two decimal places), remarks, status and paymentStatus. Patient count is manually supplied and independent of linked Patients, including zero links. For new rows use Confirmed / Unpaid, blank ID and number, and no attachments. Include version for updates. Names, total and snapshot columns are informational only and cannot override server history.',
    matching: 'Updates require the current ID, number and exported version. Dates and order/payment classifications cannot change. Existing file associations are retained regardless of imported metadata. New imported orders may have no files because transfers cannot restore uploads; Add Order requires private verified attachments. No masters are created and no orders are deleted.',
    release: (blob, filename, template, format) => downloadBlob(blob, filename, { source: 'lupin_orders', kind: template ? 'template' : 'export', format: format === 'xlsx' ? 'XLSX' : 'CSV' }),
    async download(template, preferences, format) {
      return output(template ? [] : (await request('/export', { params: filters })).items, preferences, format);
    },
    async review(file) {
      if (!file.size || file.size > TRANSFER_MAX_BYTES) throw new Error('Choose a nonempty CSV/XLSX up to 8 MB.');
      let rows;
      if (/\.csv$/i.test(file.name)) rows = readOrderCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      else if (/\.xlsx$/i.test(file.name)) rows = await readOrderWorkbook(file);
      else throw new Error('Choose CSV or genuine Excel (.xlsx).');
      if (rows.length < 2 || rows.length > 501) throw new Error('Review 1–500 orders per atomic server import.');
      if (rows[0].cells.length !== 8 || HEADERS.some((h, i) => rows[0].cells[i] !== h)) throw new Error('Keep the eight Lupin headers in order.');
      const entries = [], failures = [];
      let firstContext;
      for (const { line, cells } of rows.slice(1)) {
        try {
          if (cells.length !== 8) throw new Error('Expected eight columns.');
          const [schema, kind, rawContext, id, number, rawDate, rawDetails, rawPatients] = cells.map(decodeTransferCell);
          if (schema !== SCHEMA || kind !== 'lupin') throw new Error('Not a saved Lupin transfer. Fictional session records are not accepted.');
          const context = readContext(rawContext);
          if (firstContext && firstContext !== JSON.stringify(context)) throw new Error('Keep one date context throughout the file.');
          firstContext = JSON.stringify(context);
          const date = parseDate(rawDate, context), details = safeJson(rawDetails, 'Order details');
          safeJson(rawPatients, 'Patient snapshots'); // Never used to create or replace a master.
          if (!details || Array.isArray(details) || typeof details !== 'object') throw new Error('Order details must be an object.');
          if (!UUID.test(details.doctorId) || !UUID.test(details.mrId) || !Array.isArray(details.patientIds || [])
            || (details.patientIds || []).some((p) => !UUID.test(p))) throw new Error('Use real Doctor/MR UUIDs and optional Patient UUIDs.');
          if (!Number.isInteger(details.patientCount)) throw new Error('patientCount must be an independent integer, not a string or Patient list size.');
          let previous = null;
          if (id) {
            if (!UUID.test(id)) throw new Error('Use a real saved order ID.');
            previous = await request(`/${id}`);
            if (number !== previous.number || details.version !== previous.version) throw new Error('Updates require current ID, number and version.');
            if (date !== previous.date) throw new Error('Saved order date is immutable.');
          } else if (number || details.version) throw new Error('Leave new order number and version empty.');
          const values = orderInput({ ...details, attachments: previous?.attachments || [] });
          values.orderDate = date;
          entries.push({ id: previous?.id || null, number: number || '', expected_version: previous?.version || null, values });
        } catch (e) { failures.push({ line, action: 'reject', errors: [e.message], changed: [], patients: [] }); }
      }
      if (failures.length) return { valid: false, entries: failures, rejected: failures.length, additions: 0, updates: 0, unchanged: 0, patientAdditions: 0 };
      const payload = { entries, idempotencyKey: crypto.randomUUID(), reviewToken: '', confirmUpdates: false };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 1000000) throw new Error('Validated request exceeds 1 MiB. Import a smaller batch.');
      const reviewed = await request('/import/review', { body: payload });
      return { ...reviewed, payload: { ...payload, reviewToken: reviewed.reviewToken } };
    },
    async commit(review, confirmed) {
      const result = await request('/import/commit', { body: { ...review.payload, confirmUpdates: confirmed } });
      onSaved();
      return result;
    },
  };
}
