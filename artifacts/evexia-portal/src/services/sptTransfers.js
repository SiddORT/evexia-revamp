import { request, orderInput } from './serverSpt.js';
import { safeJson, parseDate, readContext } from './orderTransfers.js';
import { readOrderCsv, writeOrderCsv, decodeTransferCell, TRANSFER_MAX_BYTES } from './orderTransferCsv.js';
import { readOrderWorkbook, writeOrderWorkbook } from './orderTransferWorkbook.js';
import { exportDate } from './exportDatePresentation.js';
import { downloadBlob } from './downloads.js';

const HEADERS = ['Schema', 'Order type', 'Date context JSON', 'Order ID', 'Order number', 'Order date', 'Order details JSON', 'Historical snapshots JSON'];
const SCHEMA = 'evexia.spt-orders/1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function output(orders, preferences, format) {
  const context = JSON.stringify({ dateFormat: preferences.dateFormat, timeZone: preferences.resolvedTimeZone || preferences.timeZone, clock: preferences.clock, cellEncoding: 'apostrophe-v1' });
  const rows = [HEADERS, ...orders.map((o) => [
    SCHEMA, 'spt', context, o.id, o.number, exportDate(o.date, preferences),
    JSON.stringify({ ...orderInput(o), sourceId: o.sourceId, version: o.version }),
    JSON.stringify({ doctor: o.doctor, mr: o.mr, patients: o.patients }),
  ])];
  const blob = format === 'csv' ? new Blob([writeOrderCsv(rows)], { type: 'text/csv;charset=utf-8' }) : writeOrderWorkbook(rows);
  if (blob.size > TRANSFER_MAX_BYTES) throw new Error('Export exceeds 8 MB. Narrow filters; no partial download.');
  return blob;
}
export function createSptTransferAdapter(filters, onSaved) {
  return {
    retainUncertain: true,
    release: (blob, filename, template, format) => downloadBlob(blob, filename,
      { source: 'spt_orders', kind: template ? 'template' : 'export', format: format === 'xlsx' ? 'XLSX' : 'CSV' }),
    downloadMessage: (template) => template ? 'Blank SPT server-order template downloaded. Use real reference IDs and a unique stable sourceId for each new order.'
      : 'All SPT orders matching applied filters downloaded, including historical snapshots. Store this personal information securely.',
    savedMessage: 'Saved atomically on the shared server. No patients, masters or accounts created or merged.',
    scope: 'Export all SPT orders matching the applied filters across all pages, including encrypted-on-server historical snapshots. Amounts are not payment records.',
    description: 'Review validates existing Doctor, MR and patient references on the server. Confirmation saves the entire batch atomically. No patients, masters or accounts are created by import.',
    matching: 'Keep ID, number, sourceId and version for matching orders. Only Drafts may change; identical Saved orders remain unchanged. New orders require blank ID/number, a unique stable UUID sourceId and real existing patient references. Historical snapshots are informational and cannot create or overwrite identities. No order is deleted because it is absent from this file.',
    instructions: 'Use the eight SPT headers. Details JSON: sourceId (stable UUID required, including for new rows), version (existing only), doctorId/mrId (UUID or null), status (Draft/Saved), remarks, patients [{id: UUID, source: "master" or "spt", amount: "250.00" or blank for Draft}]. Keep exact amounts as quoted strings. At most 200 patients per order. Saved requires Doctor, MR and at least one patient with an amount. Retain the declared date context or use ISO YYYY-MM-DD. New rows use {} for historical snapshots. Fictional demo/session files are incompatible.',
    async download(template, preferences, format) {
      return output(template ? [] : (await request('/export', { params: filters })).items, preferences, format);
    },
    async review(file) {
      if (!file.size || file.size > TRANSFER_MAX_BYTES) throw new Error('Choose a nonempty CSV/XLSX up to 8 MB.');
      let rows;
      if (/\.csv$/i.test(file.name)) rows = readOrderCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      else if (/\.xlsx$/i.test(file.name)) rows = await readOrderWorkbook(file);
      else throw new Error('Choose CSV or genuine Excel (.xlsx).');
      if (rows.length < 2 || rows.length > 501) throw new Error('Import 1–500 orders per atomic batch.');
      if (rows[0].cells.length !== 8 || HEADERS.some((h, i) => rows[0].cells[i] !== h)) throw new Error('Use the eight SPT server-transfer headers. Demo/session files are incompatible.');
      const entries = [], failures = [];
      let firstContext;
      for (const { line, cells } of rows.slice(1)) {
        try {
          if (cells.length !== 8) throw new Error('Expected eight columns.');
          const [schema, kind, rawContext, id, number, rawDate, rawDetails, snapshots] = cells.map(decodeTransferCell);
          if (schema !== SCHEMA || kind !== 'spt') throw new Error('Not an SPT server transfer. Fictional demo/session records are not accepted.');
          const context = readContext(rawContext);
          if (firstContext && firstContext !== JSON.stringify(context)) throw new Error('Keep one date context throughout the file.');
          firstContext = JSON.stringify(context);
          const details = safeJson(rawDetails, 'Order details');
          safeJson(snapshots, 'Historical snapshots'); // Never authoritative; no import-driven identity merging.
          if (!details || Array.isArray(details) || typeof details !== 'object') throw new Error('Details must be a JSON object.');
          const { sourceId, version, ...values } = details;
          if (!UUID.test(sourceId)) throw new Error('Provide a stable UUID sourceId; keep it unchanged on retries.');
          if (id && !UUID.test(id)) throw new Error('Existing order ID must be a real UUID.');
          if (!id && (number || version != null)) throw new Error('Leave new order number and version blank.');
          entries.push({ id: id || null, sourceId, number, expected_version: version ?? null,
            values: { ...values, orderDate: parseDate(rawDate, context) } });
        } catch (error) { failures.push({ line, action: 'reject', errors: [error.message], changed: [], patients: [] }); }
      }
      if (failures.length) return { valid: false, entries: failures, rejected: failures.length, additions: 0, updates: 0, unchanged: 0, patientAdditions: 0 };
      const payload = { entries, idempotencyKey: crypto.randomUUID(), reviewToken: '', confirmUpdates: false };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 1000000) throw new Error('Request exceeds 1 MiB; use a smaller batch.');
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
