import { request, orderInput } from './serverKits.js';
import { safeJson, parseDate, readContext } from './orderTransfers.js';
import { readOrderCsv, writeOrderCsv, decodeTransferCell, TRANSFER_MAX_BYTES } from './orderTransferCsv.js';
import { readOrderWorkbook, writeOrderWorkbook } from './orderTransferWorkbook.js';
import { exportDate } from './exportDatePresentation.js';
import { downloadBlob } from './downloads.js';
import { getSession, reportingIdentityGuard } from '../auth/adminSession.js';

const HEADERS = ['Schema', 'Order type', 'Date context JSON', 'Order ID', 'Order number', 'Order date', 'Order details JSON', 'Patient snapshot JSON'];
const SCHEMA = 'evexia.kits-orders/1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function output(orders, preferences, format) {
  const context = JSON.stringify({ dateFormat: preferences.dateFormat, timeZone: preferences.resolvedTimeZone || preferences.timeZone, clock: preferences.clock, cellEncoding: 'apostrophe-v1' });
  const rows = [HEADERS, ...orders.map(({ id, number, date, ...details }) => [
    SCHEMA, 'kits', context, id, number, exportDate(date, preferences), JSON.stringify(details), JSON.stringify(details.patient || null),
  ])];
  const blob = format === 'csv' ? new Blob([writeOrderCsv(rows)], { type: 'text/csv;charset=utf-8' }) : writeOrderWorkbook(rows);
  if (blob.size > TRANSFER_MAX_BYTES) throw new Error('Export exceeds 8 MB. Narrow filters; no partial download.');
  return blob;
}
export function createKitsTransferAdapter(filters, onSaved) {
  const prepared = new WeakMap();
  const ownerGuard = reportingIdentityGuard();
  return {
    release: (blob, filename, template, format) => {
      const guard = prepared.get(blob);
      if (!guard) throw new Error('Prepare this export again before downloading.');
      return downloadBlob(blob, filename, { source: 'kits_orders', kind: template ? 'template' : 'export', format: format === 'xlsx' ? 'XLSX' : 'CSV' }, { guard });
    },
    instructions: `${getSession().user?.identity_kind === 'mr' ? `Every row must retain your signed-in saved MR ID (${getSession().user.mr_id}); other or empty MR assignments are rejected. ` : ''}Use the eight-column Kits template. Order details are JSON: doctorId (required real UUID), mrId and patientId (optional real UUIDs in Admin), orderFor (doctor/mr), kit (product, custom, volume, quantity as strings), lancets/applicators/tray (whole-count strings or blank), shipping (doctor/mr/other), other (name, phone, address), remarks, status and paymentStatus (Unpaid/Paid/Partial). No dosage, bottles or clinical history. Keep decimal values in quoted text and retain the declared date context, or use ISO YYYY-MM-DD. Patient snapshot JSON is informational only. New orders have blank ID/number and no files.`,
    async download(template, preferences, format) {
      const guard = ownerGuard;
      guard();
      const blob = output(template ? [] : (await request('/export', { params: filters })).items, preferences, format);
      guard(); prepared.set(blob, guard);
      return blob;
    },
    async review(file) {
      ownerGuard();
      if (!file.size || file.size > TRANSFER_MAX_BYTES) throw new Error('Choose a nonempty CSV/XLSX up to 8 MB.');
      let rows;
      if (/\.csv$/i.test(file.name)) rows = readOrderCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      else if (/\.xlsx$/i.test(file.name)) rows = await readOrderWorkbook(file);
      else throw new Error('Choose CSV or genuine Excel (.xlsx).');
      ownerGuard();
      if (rows.length < 2 || rows.length > 501) throw new Error('Review 1–500 orders per atomic server import.');
      if (rows[0].cells.length !== 8 || HEADERS.some((h, i) => rows[0].cells[i] !== h)) throw new Error('Keep the original eight Kits headers in order.');
      const entries = [], failures = [];
      let firstContext;
      for (const { line, cells } of rows.slice(1)) {
        ownerGuard();
        try {
          if (cells.length !== 8) throw new Error('Expected eight columns.');
          const [schema, kind, rawContext, id, number, rawDate, rawDetails, rawPatient] = cells.map(decodeTransferCell);
          if (schema !== SCHEMA || kind !== 'kits') throw new Error('Not a saved Kits order transfer. Fictional session records are not accepted.');
          const context = readContext(rawContext);
          if (firstContext && firstContext !== JSON.stringify(context)) throw new Error('Keep one date context throughout the file.');
          firstContext = JSON.stringify(context);
          const date = parseDate(rawDate, context), details = safeJson(rawDetails, 'Order details');
          safeJson(rawPatient, 'Historical patient snapshot'); // Informational only; never create a master.
          if (!UUID.test(details.doctorId) || [details.mrId, details.patientId].some((v) => v && !UUID.test(v))) throw new Error('Use real Doctor/MR/Patient UUIDs; optional IDs may be empty.');
          let previous = null;
          if (id) {
            if (!UUID.test(id)) throw new Error('Use a real saved order ID.');
            previous = await request(`/${id}`);
            if (number !== previous.number || details.version !== previous.version) throw new Error('Updates require the current saved ID, number and version.');
            if (date !== previous.date) throw new Error('Saved order date is immutable.');
          } else if (number) throw new Error('Leave new order numbers blank; the server assigns them.');
          const values = orderInput({ ...details, attachments: previous?.attachments || [] });
          values.orderDate = date;
          entries.push({ id: previous?.id || null, number: number || '', expected_version: previous?.version || null, values });
        } catch (e) { failures.push({ line, action: 'reject', errors: [e.message], changed: [], patients: [] }); }
      }
      if (failures.length) return { valid: false, entries: failures, rejected: failures.length, additions: 0, updates: 0, unchanged: 0, patientAdditions: 0 };
      const payload = { entries, idempotencyKey: crypto.randomUUID(), reviewToken: '', confirmUpdates: false };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 1000000) throw new Error('Validated request exceeds 1 MiB. Import a smaller batch.');
      const reviewed = await request('/import/review', { body: payload });
      ownerGuard();
      return { ...reviewed, payload: { ...payload, reviewToken: reviewed.reviewToken } };
    },
    async commit(review, confirmed) {
      ownerGuard();
      const result = await request('/import/commit', { body: { ...review.payload, confirmUpdates: confirmed } });
      ownerGuard();
      onSaved();
      return result;
    },
  };
}
