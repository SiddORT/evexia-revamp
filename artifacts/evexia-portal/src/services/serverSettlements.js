import { purchaseOrderRequest } from '../auth/adminSession.js';

export const request = (path, options) => purchaseOrderRequest(path, options, 'settlements');
export const VERIFICATION = ['All', 'No transactions', 'Not verified', 'Verified'];
export const KINDS = [['All', 'All types'], ['IT', 'Immunotherapy'], ['Kit', 'Kits & Consumables'], ['SPT', 'SPT'], ['Lupin', 'Lupin']];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card', 'Other'];
export const EMPTY_FILTERS = { search: '', order_from: '', order_to: '', payment_from: '', payment_to: '', doctor_id: '', mr_id: '', patient_id: '', verification: 'All', kind: 'All', order_status: 'All', payment_status: 'All' };
export const AMOUNT = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const money = (value) => typeof value === 'string' && /^(0|[1-9]\d{0,11})\.\d{2}$/.test(value);
const failure = () => { throw new Error('The server response could not be confirmed. Refresh or retry explicitly; no estimated figures are shown.'); };
const validPerson = (p) => p === null || (p && typeof p === 'object' && !Array.isArray(p)
  && (p.id === null || typeof p.id === 'string') && (p.name === null || typeof p.name === 'string')
  && (p.phone === null || typeof p.phone === 'string') && (p.email === null || typeof p.email === 'string')
  && typeof p.contactsMasked === 'boolean' && (!p.contactsMasked || (!p.phone && !p.email)));

export const VERIFY_LABEL = { 'No transactions': 'No transactions', 'Not verified': 'Unverified', Verified: 'Verified' };
export const verifyLabel = (v) => VERIFY_LABEL[v] || v || 'No transactions';
export const VERIFICATION_OPTIONS = VERIFICATION.map((v) => ({ value: v, label: v === 'All' ? 'All verification' : verifyLabel(v) }));
export const PAYMENT_STATUSES = ['All', 'Unpaid', 'Part paid', 'Paid', 'Unavailable'];
// Saved lifecycle statuses offered as filters; the server remains authoritative.
export const ORDER_STATUSES = ['All', 'Confirmed', 'Saved', 'In process', 'Shipped', 'Delivered', 'Returned', 'Rejected', 'Cancelled'];
export const BATCH_LIMIT = 100;
export const REFERENCE = /^[^\p{C}]{1,100}$/u;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

function validTransaction(t) {
  return Boolean(t && UUID.test(t.id) && UUID.test(t.batchId) && UUID.test(t.actorId)
    && DAY.test(t.date) && typeof t.createdAt === 'string' && MODES.includes(t.mode)
    && money(t.amount) && toPaise(t.amount) > 0n && ['Verified', 'Not verified'].includes(t.verification)
    && (t.reference == null || typeof t.reference === 'string')
    && (t.verifiedAt == null || (typeof t.verifiedAt === 'string' && !Number.isNaN(Date.parse(t.verifiedAt))))
    && (t.verifiedBy == null || typeof t.verifiedBy === 'string')
    && (t.verification === 'Verified' || (t.verifiedAt == null && t.verifiedBy == null)));
}

// Throws unless the record is internally consistent (exact paise arithmetic).
export function validateRecord(r) {
  if (!r || !Object.hasOwn(KIND_LABEL, r.kind) || r.kind === 'All' || !UUID.test(r.id) || r.key !== `${r.kind}:${r.id}`
    || typeof r.number !== 'string' || !r.number.trim() || !DAY.test(r.date)
    || typeof r.status !== 'string' || !r.status.trim() || typeof r.payable !== 'boolean'
    || !PAYMENT_STATUSES.slice(1).includes(r.paymentStatus)
    || !Number.isSafeInteger(r.version) || r.version < 1 || !validPerson(r.doctor) || !validPerson(r.mr)
    || !Array.isArray(r.patients) || !r.patients.every((p) => p && validPerson(p))
    || !(r.total === null || money(r.total)) || !money(r.paid) || !(r.balance === null || money(r.balance))
    || !VERIFICATION.slice(1).includes(r.verification) || !Array.isArray(r.transactions) || r.transactions.length > 50000) failure();
  let paid = 0n;
  const receipts = new Set();
  for (const t of r.transactions) {
    if (!validTransaction(t) || receipts.has(t.id)) failure();
    receipts.add(t.id);
    paid += toPaise(t.amount);
  }
  const status = !r.transactions.length ? 'No transactions'
    : r.transactions.every((t) => t.verification === 'Verified') ? 'Verified' : 'Not verified';
  if (fromPaise(paid) !== r.paid || r.verification !== status
    || (r.total === null ? r.balance !== null : r.balance === null || toPaise(r.total) - paid !== toPaise(r.balance))) failure();
  // A payable record must have a known positive balance.
  if (r.payable && !(r.balance !== null && toPaise(r.balance) > 0n)) failure();
  return r;
}

export async function listSettlements(filters, { offset, limit, signal }) {
  const params = { offset, limit };
  for (const [k, v] of Object.entries(filters)) {
    if (v === true) params[k] = 'true';
    else if (typeof v === 'string' && v.trim() && v !== 'All') params[k] = k === 'search' ? v.trim().slice(0, 100) : v;
  }
  const page = await request('', { params, signal });
  if (!page || !Array.isArray(page.items) || page.items.length > limit || page.offset !== offset || page.limit !== limit
    || !Number.isSafeInteger(page.total) || page.total < 0
    || page.items.length !== Math.min(limit, Math.max(0, page.total - offset))) failure();
  const keys = new Set();
  for (const r of page.items) {
    validateRecord(r);
    if (keys.has(r.key) || (filters.payable_only && !r.payable)) failure();
    keys.add(r.key);
  }
  return page;
}

export async function fetchHistory(kind, id, signal) {
  if (!Object.hasOwn(KIND_LABEL, kind) || kind === 'All' || !UUID.test(id)) failure();
  const record = validateRecord(await request(`/history/${kind}/${id}`, { signal }));
  if (record.kind !== kind || record.id !== id) failure();
  return record;
}

export async function verifyEntry(record, entryId, signal) {
  if (!UUID.test(entryId)) failure();
  const next = validateRecord(await request(`/transactions/${entryId}/verify`, { body: {}, signal }));
  const entry = next.transactions.find((t) => t.id === entryId);
  if (next.key !== record.key || !entry || entry.verification !== 'Verified') failure();
  return next;
}

// Adapter: shared reference selectors speak cursor; settlements speak offset.
export async function referenceRequester(path, { params = {}, signal } = {}) {
  const offset = Number(params.cursor) || 0;
  const limit = params.limit || 25;
  const res = await request(path, { params: { search: params.search || '', offset, limit }, signal });
  if (!res || !Array.isArray(res.items) || res.items.length > limit || res.offset !== offset || res.limit !== limit
    || !Number.isSafeInteger(res.total) || res.total < 0
    || res.items.length !== Math.min(limit, Math.max(0, res.total - offset))
    || res.items.some((p) => !p || !UUID.test(p.id) || typeof p.name !== 'string' || !p.name.trim())) failure();
  const items = res.items;
  const next = offset + items.length;
  return { items, nextCursor: items.length && next < (res?.total ?? 0) ? String(next) : null };
}

export const postTransaction = (body, signal) => request('/transactions', { body, signal });
export async function lookupRequest(key, signal) {
  const result = await request(`/requests/${key}`, { signal });
  if (!result || !['committed', 'absent', 'rejected'].includes(result.status)
    || (result.status === 'committed' ? result.batch?.id !== key : result.batch !== null)
    || (result.status === 'rejected' && (typeof result.rejection?.message !== 'string' || typeof result.rejection?.code !== 'string'))) failure();
  return result;
}

export function confirmBatch(batch, frozen) {
  if (!batch || batch.id !== frozen.idempotency_key || batch.date !== frozen.date || batch.mode !== frozen.mode
    || (batch.reference ?? null) !== (frozen.reference ?? null)
    || !Array.isArray(batch.entries) || batch.entries.length !== frozen.entries.length) failure();
  let total = 0n;
  const expected = new Map(frozen.entries.map((e) => [`${e.kind}:${e.id}`, e.amount]));
  for (const entry of batch.entries) {
    const key = `${entry.kind}:${entry.id}`;
    if (!money(entry.amount) || entry.amount !== expected.get(key)) failure();
    expected.delete(key); total += toPaise(entry.amount);
  }
  if (expected.size || batch.total !== fromPaise(total)) failure();
  return batch;
}

// Exact money in paise via BigInt; no floating point anywhere.
export function toPaise(value) {
  if (typeof value !== 'string' || !AMOUNT.test(value.trim())) return null;
  const [r, f = ''] = value.trim().split('.');
  return BigInt(r) * 100n + BigInt((f + '00').slice(0, 2));
}
export function fromPaise(p) {
  const neg = p < 0n; const a = neg ? -p : p;
  const r = (a / 100n).toString();
  return `${neg ? '-' : ''}${r}.${(a % 100n).toString().padStart(2, '0')}`;
}
export function inr(value) {
  if (value == null) return null;
  const raw = String(value);
  const p = typeof value === 'bigint' ? value
    : /^(0|[1-9]\d{0,13})\.\d{2}$/.test(raw)
      ? BigInt(raw.replace('.', '')) : toPaise(raw);
  if (p == null) return String(value);
  const [r, f] = fromPaise(p).split('.');
  const neg = r.startsWith('-'); const digits = neg ? r.slice(1) : r;
  const last = digits.slice(-3); const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last}` : last;
  return `${neg ? '-' : ''}\u20B9${grouped}.${f}`;
}
export const eligible = (row) => row.payable === true && row.total != null && row.balance != null && (toPaise(row.balance) ?? 0n) > 0n;
export const rowKey = (row) => row.key || `${row.kind}:${row.id}`;
