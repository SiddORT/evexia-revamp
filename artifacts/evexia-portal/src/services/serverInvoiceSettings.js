import { purchaseOrderRequest } from '../auth/adminSession.js';

// Shared, protected Invoice Details. Nothing here is written to browser storage
// or local activity; values live in component memory only.
const RESOURCE = 'invoice-settings';

export const INVOICE_FIELDS = Object.freeze([
  'company_name', 'address', 'email', 'website', 'customer_care', 'drug_licenses', 'gstin', 'pan',
  'bank_name', 'account_holder', 'account_number', 'branch', 'ifsc', 'payment_on', 'upi_id', 'declaration', 'terms',
]);

export const FIELD_LIMITS = Object.freeze({ address: 2000, drug_licenses: 1000, declaration: 4000, terms: 12000 });
export const fieldLimit = (field) => FIELD_LIMITS[field] ?? 200;
export const MULTILINE_FIELDS = Object.freeze(['address', 'drug_licenses', 'declaration', 'terms']);

export const FIELD_LABELS = Object.freeze({
  company_name: 'Company / legal name', address: 'Address', email: 'Email', website: 'Website',
  customer_care: 'Customer care number', drug_licenses: 'Drug license number(s)', gstin: 'GSTIN', pan: 'PAN',
  bank_name: 'Bank name', account_holder: 'Account holder name', account_number: 'Account number', branch: 'Branch',
  ifsc: 'IFSC', payment_on: 'Payment on (contact)', upi_id: 'UPI ID', declaration: 'Declaration', terms: 'Terms of sale',
  qr: 'Payment QR image',
});

export const QR_MAX_BYTES = 512 * 1024;
export const QR_MIN_SIDE = 32;
export const QR_MAX_SIDE = 2048;
const QR_TYPES = ['image/png', 'image/jpeg'];

export const blankDetails = () => Object.fromEntries(INVOICE_FIELDS.map((field) => [field, '']));
export const sameDetails = (a, b) => Boolean(a && b) && INVOICE_FIELDS.every((field) => a[field] === b[field]);

// Terms are newline-separated authored lines, kept in the authored order.
export const termLines = (terms) => String(terms || '').split('\n').map((line) => line.trim()).filter(Boolean);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBSITE = /^(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?(?:\/[^\s]*)?$/i;

export function validateDetails(details) {
  const errors = {};
  for (const field of INVOICE_FIELDS) {
    const value = details[field];
    if (typeof value !== 'string') { errors[field] = 'Enter text or leave blank.'; continue; }
    if (value.length > fieldLimit(field)) errors[field] = `Use ${fieldLimit(field).toLocaleString()} characters or fewer.`;
    else if (!MULTILINE_FIELDS.includes(field) && /[\r\n]/.test(value)) errors[field] = 'Use a single line.';
  }
  if (!errors.email && details.email.trim() && !EMAIL.test(details.email.trim())) errors.email = 'Enter an email such as name@example.in, or leave blank.';
  if (!errors.website && details.website.trim() && !WEBSITE.test(details.website.trim())) errors.website = 'Enter a website such as www.example.in, or leave blank.';
  return errors;
}

const CODE_MESSAGES = {
  too_long: 'This value is too long.', invalid: 'This value was not accepted.', invalid_email: 'Enter a valid email address.',
  invalid_website: 'Enter a valid website address.', invalid_image: 'Choose a valid PNG or JPEG image.',
  too_large: 'The QR image is larger than 512 KiB.', dimensions: 'The QR image must be 32 to 2048 pixels on each side.',
  unsupported_type: 'Only PNG or JPEG images are accepted.',
};

// 422 responses carry field names and codes only. Map known names/codes to our
// own copy so no server text or submitted value is reflected into the page.
export function fieldErrorsFrom(cause) {
  if (cause?.code === 'invoice_qr_invalid') return { qr: 'Choose a valid PNG or JPEG, up to 512 KiB and 32–2048 pixels per side.' };
  const raw = cause?.fields ?? cause?.details ?? cause?.detail ?? cause?.body?.detail ?? cause?.data?.detail;
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([field, code]) => ({ field, code })) : [];
  const errors = {};
  for (const entry of entries.slice(0, 40)) {
    const loc = Array.isArray(entry?.loc) ? entry.loc : [];
    const path = typeof entry?.field === 'string' ? entry.field : '';
    const knownField = path.startsWith('body.details.') ? path.slice('body.details.'.length)
      : path === 'body.qr_data' || path.startsWith('body.qr_data.') ? 'qr_data' : path;
    const name = [knownField, ...loc.slice().reverse()].find((part) => typeof part === 'string' && (INVOICE_FIELDS.includes(part) || part === 'qr_data' || part === 'qr'));
    if (!name) continue;
    const key = name === 'qr_data' ? 'qr' : name;
    const code = typeof entry?.code === 'string' ? entry.code : typeof entry?.type === 'string' ? entry.type : '';
    errors[key] = CODE_MESSAGES[code] || (key === 'qr' ? CODE_MESSAGES.invalid_image : CODE_MESSAGES.invalid);
  }
  return errors;
}

const isInt = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const isIso = (value) => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

function checkQRMeta(qr) {
  return qr === null || (qr && typeof qr === 'object' && isInt(qr.version, 1) && QR_TYPES.includes(qr.content_type)
    && isInt(qr.size, 1) && qr.size <= QR_MAX_BYTES && typeof qr.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(qr.sha256));
}

function checkDetails(details) {
  return details && typeof details === 'object' && !Array.isArray(details)
    && Object.keys(details).length === INVOICE_FIELDS.length
    && INVOICE_FIELDS.every((field) => typeof details[field] === 'string' && details[field].length <= fieldLimit(field));
}

function malformed(message) {
  const error = new Error(message);
  error.ambiguous = true;
  error.malformed = true;
  return error;
}

function checkView(data, mutation = false) {
  const ok = data && typeof data.configured === 'boolean' && isInt(data.version) && checkDetails(data.details)
    && checkQRMeta(data.qr) && (!data.qr || data.qr.version <= data.version)
    && (data.configured ? data.version > 0 && isIso(data.updated_at)
      : data.version === 0 && data.qr === null && data.updated_at === null && INVOICE_FIELDS.every((field) => data.details[field] === ''));
  if (!ok) {
    throw malformed(mutation
      ? 'The save result could not be confirmed. Your edits are kept; check the save outcome before doing anything else.'
      : 'The saved Invoice Details response could not be read. Retry loading.');
  }
  return Object.freeze({
    configured: data.configured, version: data.version,
    details: Object.freeze(Object.fromEntries(INVOICE_FIELDS.map((field) => [field, data.details[field]]))),
    qr: data.qr ? Object.freeze({ ...data.qr }) : null, updated_at: data.updated_at ?? null,
  });
}

// A transport failure, 5xx or malformed result means the outcome is unknown.
export function isUncertain(cause) {
  return Boolean(cause?.ambiguous || cause?.malformed || !cause?.status || cause.status >= 500);
}

function mutationError(cause) {
  if (cause && isUncertain(cause)) cause.uncertain = true;
  return cause;
}

export const loadInvoiceSettings = async ({ signal } = {}) => checkView(await purchaseOrderRequest('', { signal }, RESOURCE));

export async function saveInvoiceSettings(body) {
  let data;
  try { data = await purchaseOrderRequest('', { body }, RESOURCE); }
  catch (cause) { throw mutationError(cause); }
  try {
    const saved = checkView(data, true);
    if (![body.expected_version, body.expected_version + 1].includes(saved.version)
      || !sameDetails(saved.details, body.details)
      || (body.qr_action === 'remove' && saved.qr !== null)
      || (body.qr_action === 'replace' && !saved.qr)) {
      throw malformed('The saved values could not be matched to this submission. Your edits are kept; check the save outcome.');
    }
    return saved;
  }
  catch (cause) { throw mutationError(cause); }
}

export async function reconcileInvoiceSave(requestId) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('The pending request could not be identified.');
  const data = await purchaseOrderRequest(`/requests/${requestId}/reconcile`, { body: {} }, RESOURCE);
  if (!data || !['committed', 'cancelled'].includes(data.outcome)
    || (data.outcome === 'committed' ? !isInt(data.committed_version, 1) : data.committed_version !== null)) {
    throw malformed('The save outcome could not be confirmed yet. Your edits are kept; check the outcome again.');
  }
  const saved = checkView(data.saved);
  if (data.outcome === 'committed' && data.committed_version > saved.version) {
    throw malformed('The save history and current version disagree. Check the save outcome again.');
  }
  return Object.freeze({ outcome: data.outcome, committed_version: data.committed_version, saved });
}

function checkChange(change) {
  return change && (INVOICE_FIELDS.includes(change.field) || change.field === 'qr')
    && typeof change.before === 'string' && typeof change.after === 'string'
    && change.before.length <= (change.field === 'qr' ? 300 : fieldLimit(change.field))
    && change.after.length <= (change.field === 'qr' ? 300 : fieldLimit(change.field));
}

export async function loadInvoiceHistory(beforeVersion = null) {
  const params = { limit: 10, ...(beforeVersion ? { before_version: beforeVersion } : {}) };
  const data = await purchaseOrderRequest('/history', { params }, RESOURCE);
  const ok = data && Array.isArray(data.items) && data.items.length <= 10
    && (data.next_before_version === null || isInt(data.next_before_version, 1))
    && data.items.every((item) => item && isInt(item.version, 1) && isIso(item.changed_at)
      && item.actor && /^[0-9a-f-]{36}$/i.test(item.actor.id) && typeof item.actor.label === 'string' && item.actor.label.length <= 200
      && Array.isArray(item.changes) && item.changes.length <= INVOICE_FIELDS.length + 1 && item.changes.every(checkChange)
      && checkQRMeta(item.qr_before ?? null) && checkQRMeta(item.qr_after ?? null));
  if (!ok) throw new Error('Change history could not be read. Retry loading.');
  return data;
}

const MAGIC = { 'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/jpeg': [0xff, 0xd8, 0xff] };

function matchesMagic(bytes, type) {
  return MAGIC[type].every((byte, index) => bytes[index] === byte);
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function dimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The image could not be decoded.'));
    image.src = dataUrl;
  });
}

// Validates bytes we were explicitly handed, then builds an in-memory data URL.
async function inspectBytes(bytes, contentType) {
  if (!QR_TYPES.includes(contentType)) throw new Error('Choose a PNG or JPEG image. SVG, HTML and other formats are not accepted.');
  if (!bytes.length || bytes.length > QR_MAX_BYTES) throw new Error('Choose an image of 512 KiB or smaller.');
  if (!matchesMagic(bytes, contentType)) throw new Error('The file content is not a valid PNG or JPEG image.');
  const base64 = toBase64(bytes);
  const dataUrl = `data:${contentType};base64,${base64}`;
  const size = await dimensions(dataUrl);
  if (size.width < QR_MIN_SIDE || size.height < QR_MIN_SIDE || size.width > QR_MAX_SIDE || size.height > QR_MAX_SIDE) {
    throw new Error(`Image must be ${QR_MIN_SIDE} to ${QR_MAX_SIDE} pixels on each side (selected: ${size.width} × ${size.height}).`);
  }
  return Object.freeze({ content_type: contentType, base64, dataUrl, size: bytes.length, ...size });
}

export async function readQRFile(file) {
  if (!file) throw new Error('No file selected.');
  if (!QR_TYPES.includes(file.type)) throw new Error('Choose a PNG or JPEG image. SVG, HTML and other formats are not accepted.');
  if (file.size > QR_MAX_BYTES) throw new Error('Choose an image of 512 KiB or smaller.');
  return inspectBytes(new Uint8Array(await file.arrayBuffer()), file.type);
}

// Protected editor/history only. Never called by template renderers.
export async function loadInvoiceQR(version) {
  if (!isInt(version, 1)) throw new Error('Choose a saved QR version.');
  const data = await purchaseOrderRequest(`/qr/${version}`, {}, RESOURCE);
  if (!data || data.version !== version || !QR_TYPES.includes(data.content_type) || typeof data.base64 !== 'string'
    || data.base64.length > Math.ceil(QR_MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) {
    throw new Error('The saved QR image could not be read. Retry.');
  }
  let bytes;
  try { bytes = fromBase64(data.base64); } catch { throw new Error('The saved QR image could not be read. Retry.'); }
  return inspectBytes(bytes, data.content_type);
}

export function describeQR(meta) {
  if (!meta) return 'No QR image';
  const kind = meta.content_type === 'image/png' ? 'PNG' : 'JPEG';
  return `${kind} · ${(meta.size / 1024).toFixed(1)} KiB · version ${meta.version} · ${meta.sha256.slice(0, 12)}…`;
}
