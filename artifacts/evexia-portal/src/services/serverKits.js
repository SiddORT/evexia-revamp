import { purchaseOrderRequest, immunotherapyFileRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';
export const request = (path = '', options) => purchaseOrderRequest(path, options, 'kits-orders');
export const KIT_PRODUCTS = Object.freeze(['200', '250', '100', '85', '70', '58', 'Customized']);
export const STATUSES = Object.freeze(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const PAYMENT_STATUSES = Object.freeze(['Unpaid', 'Paid', 'Partial']);
export function validateAttachments(files, existing = []) {
  if (files.length + existing.length > 10) return 'Select at most ten files.';
  const allowed = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
  for (const f of files) {
    if (!allowed[f.type]?.includes(f.name.split('.').at(-1).toLowerCase())) return 'Choose matching PDF, JPEG, PNG or WebP files.';
    if (!f.size || f.size > 10485760) return 'Each file must be nonempty and at most 10 MB.';
  }
  return '';
}
export const fileSize = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
export const addressText = (a) => a ? [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
export function productSummary(v) {
  const parts = [], kit = v.kit || {};
  if (kit.product) parts.push(`Stallergo Skin Prick Kit: ${kit.product === 'Customized' ? `Customized (${kit.custom})` : kit.product}, ${kit.volume} ml × ${kit.quantity}`);
  for (const [key, label] of [['lancets', 'Lancets'], ['applicators', 'Applicators'], ['tray', 'Tray']]) if (v[key]) parts.push(`${label}: ${v[key]}`);
  return parts.join('; ');
}
export const blankOrder = () => ({
  orderFor: 'doctor', doctorId: '', mrId: '', patientId: '',
  kit: { product: '', custom: '', volume: '', quantity: '' },
  lancets: '', applicators: '', tray: '', shipping: 'doctor', remarks: '',
  other: { name: '', phone: '', address: { line1: '', line2: '', landmark: '', country: '', state: '', city: '', pincode: '' } },
  status: 'Confirmed', paymentStatus: 'Unpaid', attachments: [],
});
export const orderInput = (v) => ({
  orderFor: v.orderFor, doctorId: v.doctorId, mrId: v.mrId || null, patientId: v.patientId || null,
  kit: { product: v.kit.product, custom: v.kit.product === 'Customized' ? v.kit.custom : '', volume: v.kit.volume, quantity: v.kit.quantity },
  lancets: v.lancets, applicators: v.applicators, tray: v.tray, shipping: v.shipping,
  other: v.other, remarks: v.remarks, status: v.status || 'Confirmed', paymentStatus: v.paymentStatus || 'Unpaid',
  attachmentIds: (v.attachments || []).map((f) => f.id),
});
export async function uploadAttachment(file) {
  const result = await immunotherapyFileRequest('', { file, kits: true });
  if (result.state !== 'verified' || result.scanner_status !== 'clean') {
    throw new Error('File is quarantined or rejected and cannot be attached. Keep the original file and retry only when scanning is available.');
  }
  return { id: result.id, name: file.name, size: result.size, type: result.content_type, state: result.state };
}
export async function downloadAttachment(file) {
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true, kits: true });
  downloadServerBlob(blob, file.name);
}
