import { request, orderInput, mrEditable } from './serverImmunotherapy.js';
import { safeJson, parseDate, readContext } from './orderTransfers.js';
import { readOrderCsv, writeOrderCsv, decodeTransferCell, TRANSFER_MAX_BYTES } from './orderTransferCsv.js';
import { readOrderWorkbook, writeOrderWorkbook } from './orderTransferWorkbook.js';
import { exportDate } from './exportDatePresentation.js';
import { getSession, reportingIdentityGuard } from '../auth/adminSession.js';
import { releaseBlob } from './downloadRelease.js';

const HEADERS = ['Schema', 'Order type', 'Date context JSON', 'Order ID', 'Order number', 'Order date', 'Order details JSON', 'Session patients JSON'];
const SCHEMA = 'evexia.immunotherapy-orders/1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function output(orders, preferences, format) {
  const context = JSON.stringify({ dateFormat: preferences.dateFormat, timeZone: preferences.resolvedTimeZone || preferences.timeZone, clock: preferences.clock, cellEncoding: 'apostrophe-v1' });
  const rows = [HEADERS, ...orders.map(({ id, number, date, ...details }) => [
    SCHEMA, 'immunotherapy', context, id, number, exportDate(date, preferences), JSON.stringify(details), '[]',
  ])];
  const blob = format === 'csv' ? new Blob([writeOrderCsv(rows)], { type: 'text/csv;charset=utf-8' }) : writeOrderWorkbook(rows);
  if (blob.size > TRANSFER_MAX_BYTES) throw new Error('Export exceeds 8 MB. Narrow filters; no partial download.');
  return blob;
}
export function createImmunotherapyTransferAdapter(filters, onSaved) {
  const prepared = new WeakMap();
  const ownerGuard = reportingIdentityGuard();
  return {
    instructions: getSession().user?.identity_kind === 'mr'
      ? `Use the original eight-column template and real associated Patient/Doctor IDs. The MR assignment must be your signed-in saved MR ID (${getSession().user.mr_id}); other MR assignments are rejected. Create new orders in the order form with a verified prescription first. Imports can update only unpriced Confirmed orders, not Admin-reviewed or historically priced orders. Do not supply MRP, allergen rates or PO number. Attachment metadata in a spreadsheet cannot attach files. Retain saved dates, versions, bottle IDs and file associations. Patient snapshots never create masters.`
      : 'Create new orders in the order form and upload a verified prescription first. New pricing totals one INR rate per suborder; approval requires every rate and PO number. Reject without fabricated prices. Historical bottle-MRP totals remain unchanged unless pricingBasis is explicitly changed to allergen_rates with every rate entered. Fulfillment requires prior explicit approval. Attachment metadata cannot attach files. Retain saved dates, versions, internal group IDs and issued suborder IDs; the server alone issues new identities on supported writes.',
    release(blob, filename) {
      const guard = prepared.get(blob);
      if (!guard) throw new Error('Prepare this export again before downloading.');
      releaseBlob(blob, filename, guard);
    },
    async download(template, preferences, format) {
      // Blank template: no fictional or automatically created personal records.
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
      if (HEADERS.some((h, i) => rows[0].cells[i] !== h) || rows[0].cells.length !== 8) throw new Error('Keep the original eight-column headers and order.');
      const entries = [];
      const failures = [];
      let firstContext;
      for (const { line, cells } of rows.slice(1)) {
        ownerGuard();
        try {
          if (cells.length !== 8) throw new Error('Expected eight columns.');
          const decoded = cells.map((v) => decodeTransferCell(v));
          const [schema, kind, rawContext, id, number, rawDate, rawDetails, rawPatients] = decoded;
          const schemas = getSession().user?.identity_kind === 'mr' ? [SCHEMA] : [SCHEMA, 'evexia.session-orders/1'];
          if (!schemas.includes(schema) || kind !== 'immunotherapy') throw new Error('Not a saved Immunotherapy order transfer. Fictional session transfers are not accepted in the MR portal.');
          const context = readContext(rawContext);
          if (firstContext && JSON.stringify(context) !== firstContext) throw new Error('Keep the same date context on every row.');
          firstContext = JSON.stringify(context);
          const date = parseDate(rawDate, context);
          const details = safeJson(rawDetails, 'Order details');
          const dependencies = safeJson(rawPatients, 'Legacy patient details');
          if (!Array.isArray(dependencies)) throw new Error('Legacy patient column must be an array; it never creates or updates masters.');
          if (![details.patientId, details.doctorId, details.mrId].every((v) => UUID.test(v))) throw new Error('Patient, Doctor and MR must be resolvable real master UUIDs. Fictional session IDs cannot be imported.');
           // Person, recipient, allergen-name and attachment claims remain
           // non-authoritative. Admin pricing/PO follows the normal write policy.
          let previous = null;
          if (id) {
            if (!UUID.test(id)) throw new Error('Use a real saved order ID for updates, or leave ID and number blank for creation.');
            previous = await request(`/${id}`);
            if (number !== previous.number || !Number.isInteger(details.version) || details.version !== previous.version) throw new Error('Matching updates require the current order number and exported version. Export current data before reviewing again.');
            if (date !== previous.date) throw new Error('Saved order dates are immutable.');
          } else if (number) throw new Error('Leave a new order number blank; it is assigned by the server.');
          // External attachment claims never become upload evidence. The API
          // rechecks these saved associations during review and commit.
          if (!previous?.attachments?.length) throw new Error('A verified prescription is required. Use the order form to create this order or add a prescription to the existing order, then export and review again.');
           if (getSession().user?.identity_kind === 'mr' && (
             !mrEditable(previous) || details.status !== 'Confirmed' || details.poNumber != null
             || details.groups.some((g) => g.mrp != null || g.items.some((i) => i.rate != null))
           )) throw new Error('MR imports may only update unpriced Confirmed orders and cannot supply Admin pricing, PO number or review decisions.');
           // Older exports lack new optional fields. Retain saved financial data
           // by occurrence instead of clearing it or inferring historical rates.
           const groups = details.groups.map((g) => {
             const saved = previous.groups.find((p) => p.id === g.id);
             return { ...g, items: g.items.map((i) => ({ ...i,
               suborderId: Object.hasOwn(i, 'suborderId') ? i.suborderId : saved?.items.find((p) => p.allergenId === i.allergenId)?.suborderId ?? null,
               rate: Object.hasOwn(i, 'rate') ? i.rate : saved?.items.find((p) => p.allergenId === i.allergenId)?.rate ?? null,
             })) };
           });
           const values = orderInput({ ...details, groups,
             pricingBasis: details.pricingBasis || previous.pricingBasis || 'legacy_bottle_mrp',
             poNumber: Object.hasOwn(details, 'poNumber') ? details.poNumber : previous.poNumber ?? null,
             attachments: previous.attachments });
          values.orderDate = date;
          entries.push({ id: previous?.id || null, expected_version: previous?.version || null, values });
        } catch (e) { failures.push({ line, action: 'reject', errors: [e.message], changed: [], patients: [] }); }
      }
      if (failures.length) return { valid: false, entries: failures, rejected: failures.length, additions: 0, updates: 0, unchanged: 0, patientAdditions: 0 };
      const payload = { entries, idempotencyKey: crypto.randomUUID(), reviewToken: '', confirmUpdates: false };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 1000000) throw new Error('Validated request exceeds the server 1 MiB JSON limit. Import a smaller batch.');
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
