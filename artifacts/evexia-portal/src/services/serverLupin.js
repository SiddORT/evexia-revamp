import { immunotherapyFileRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';
import { orderRequest } from './orderFreshness.js';
export { validateAttachments, fileSize } from './serverKits.js';

export const request = (path = '', options) => orderRequest(path, options, 'lupin-orders');
export const STATUSES = Object.freeze(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const PAYMENT_STATUSES = Object.freeze(['Unpaid', 'Paid', 'Partial']);
export const blankOrder = () => ({ doctorId: '', mrId: '', patientIds: [], patientCount: '', price: '1000.00', remarks: '', attachments: [] });
export function priceMinor(value) {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return n > 0n ? n : null;
}
export function totalMinor(count, price) {
  const c = String(count);
  if (!/^\d{1,7}$/.test(c) || Number(c) < 1 || Number(c) > 1000000 || priceMinor(price) === null) return null;
  return BigInt(c) * priceMinor(price);
}
export const money = (minor) => minor === null ? '—' : `₹${(minor / 100n).toLocaleString('en-IN')}.${String(minor % 100n).padStart(2, '0')}`;
export const amountMoney = (value) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) return '—';
  const [whole, fraction = ''] = String(value).split('.');
  return money(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
};
export function orderInput(v) {
  return {
    doctorId: v.doctorId, mrId: v.mrId, patientIds: v.patientIds || [],
    patientCount: typeof v.patientCount === 'number' ? v.patientCount : (/^\d{1,7}$/.test(v.patientCount) ? Number(v.patientCount) : 0),
    price: v.price, remarks: v.remarks || '',
    attachmentIds: (v.attachments || []).map((f) => f.id),
    status: v.status || 'Confirmed', paymentStatus: v.paymentStatus || 'Unpaid',
  };
}
export async function uploadAttachment(file, uploadId) {
  let result;
  try { result = await immunotherapyFileRequest('', { file, lupin: true, uploadId }); }
  catch (e) {
    e.fileId = uploadId;
    e.ambiguous = !e.status || e.status >= 500 || e.status === 409 || e.status === 401;
    throw e;
  }
  if (result.state !== 'verified' || result.scanner_status !== 'clean') {
    const error = new Error(`File is ${result.state}; scanner ${result.scanner_status}. It is not attached. Keep the original and retry only when scanning is available.`);
    error.fileId = result.id;
    throw error;
  }
  return { id: result.id, name: file.name, size: result.size, type: result.content_type, state: result.state };
}
export async function downloadAttachment(file, signal) {
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true, lupin: true, signal });
  signal?.throwIfAborted();
  downloadServerBlob(blob, file.name);
}
export async function attachmentBlob(file, signal) {
  if (file.restricted || file.state !== 'verified') throw new Error('This attachment is restricted or is not verified.');
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true, lupin: true, signal });
  signal?.throwIfAborted();
  if (!blob.size) throw new Error('The attachment is empty.');
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    const error = new Error('This attachment type cannot be previewed. Use Download instead.');
    error.code = 'unsupported_file_type';
    throw error;
  }
  return blob;
}
export async function removeUpload(id) {
  return request(`/attachments/${id}/cancel`, { body: {} });
}
