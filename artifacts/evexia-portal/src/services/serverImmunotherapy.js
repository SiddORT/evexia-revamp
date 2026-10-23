import { purchaseOrderRequest, immunotherapyFileRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const request = (path = '', options) => purchaseOrderRequest(path, options, 'immunotherapy-orders');
export const STATUSES = Object.freeze(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const PRELIMINARY_DOSES = Object.freeze(['PD', 'DD']);
export const DOSES = Object.freeze([...PRELIMINARY_DOSES, ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`)]);
export const GENDERS = Object.freeze(['male', 'female', 'other', 'prefer not to say']);
export function parseAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const totalMinor = (groups) => groups.reduce((sum, g) => sum + (parseAmount(g.mrp) ?? 0n), 0n);
export const money = (minor) => `₹${(minor / 100n).toLocaleString('en-IN')}.${String(minor % 100n).padStart(2, '0')}`;
export const newGroup = () => ({ id: crypto.randomUUID(), mrp: '', items: [] });
export const groupingError = (items) => new Set(items.map((i) => i.allergenId)).size === items.length ? '' : 'Duplicate allergens within a bottle are not allowed.';
export const nextDose = () => ({ dosage: '', explanation: 'No administration history is recorded by this order workflow. Choose a dosage explicitly; order status is not evidence of a given dose.' });
export function shippingRecipient(order) { return order.recipient || order[order.shipping] || null; }
export function orderInput(v) {
  return Object.fromEntries(Object.entries({
    patientId: v.patientId, doctorId: v.doctorId, mrId: v.mrId, dosage: v.dosage, histamine: v.histamine, saline: v.saline,
    groups: v.groups.map((g) => ({ id: g.id, mrp: g.mrp, items: g.items.map(({ allergenId, result }) => ({ allergenId, result })) })),
    remarks: v.remarks, shipping: v.shipping, status: v.status,
    attachmentIds: v.attachments.map((f) => f.id),
  }));
}
export const saveOrder = (v, order, key) => request(order ? `/${order.id}/edit` : '', { body: {
  ...orderInput(v), idempotencyKey: key, expected_version: order?.version ?? null,
} });
export async function downloadPrescription(file) {
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true });
  downloadServerBlob(blob, file.name);
}
export const uploadPrescription = (file, patientId) => immunotherapyFileRequest('', { file, patientId });
export const prescriptionMetadata = (id) => immunotherapyFileRequest(`/${id}`);
export function validateAttachments(files, existing = [], maxBytes = 10485760) {
  if (files.length + existing.length > 10) return 'Select at most ten prescription files.';
  const allowed = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
  for (const f of files) {
    if (!allowed[f.type]?.includes(f.name.split('.').at(-1).toLowerCase())) return 'Choose matching PDF, JPEG, PNG or WebP files.';
    if (!f.size || f.size > maxBytes) return `Each file must be nonempty and at most ${(maxBytes / 1048576).toFixed(1)} MiB.`;
  }
  return '';
}
