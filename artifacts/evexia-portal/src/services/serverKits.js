import { purchaseOrderRequest, immunotherapyFileRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';
import { privateUploadMessage } from '../auth/privateFileErrors.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error, stage) {
  const upload = stage === 'upload';
  const messages = {
    kits_stale: 'Another save changed this order. Your draft is preserved. Open the saved View in a separate tab to compare; this draft will not overwrite the newer version.',
    kits_pricing: 'Enter unit rates for each included item, valid nonnegative amounts, and a percent discount from 0–100 or fixed discount no greater than gross.',
    kits_relationship: 'Review the current Doctor/MR assignment and any selected Patient’s billing Doctor.',
    mr_order_assignment: 'The order MR must be your signed-in MR. Ask an administrator to review your saved assignment.',
    kits_attachment: 'An attachment is no longer eligible. Ask the operator to review its private upload state.',
    kits_retry: 'Keep this draft unchanged. Ask the operator to review the original submission before starting another order.',
  };
  const detail = upload ? privateUploadMessage(error?.code, error?.status)
    : (Object.hasOwn(messages, error?.code) ? messages[error.code] : '')
    || (error?.status === 401 ? 'Check your sign-in before retrying this draft.'
      : error?.status === 403 ? 'Access was denied. Ask an administrator to review your access.'
      : error?.status === 413 ? 'The request exceeds the service limit. Review the selected file sizes.'
      : error?.status === 429 ? 'The service is busy. Wait before retrying.'
      : !upload && error?.status === 422 ? 'Check kit product, positive volume and whole quantities, billing Doctor, MR shipping and any selected Patient’s assignment. Patient remains optional.'
      : 'The service could not complete or confirm this step. Check your connection; ask the operator to review the request if it persists.');
  const reference = typeof error?.requestId === 'string' && UUID.test(error.requestId)
    ? ` Request reference: ${error.requestId}.` : '';
  const ambiguous = !upload && (Boolean(error?.ambiguous) || error?.code === 'kits_retry');
  const result = new Error(`${upload ? 'Attachment upload failed. The order request was not sent.' : 'Order save failed or could not be confirmed.'} ${detail} ${upload
    ? 'Your values and selected files remain here; previously verified uploads will be reused.'
    : ambiguous ? 'Keep this draft open and use Retry unchanged save; do not start a duplicate order.'
      : 'Your draft and verified uploads remain here.'}${reference}`);
  result.stage = !upload && error?.status === 422 ? 'validation' : stage;
  result.ambiguous = ambiguous;
  return result;
}

export async function request(path = '', options) {
  // Other Kits reads/transfers keep their existing transport contract.
  if (path !== '' || options?.body === undefined) return purchaseOrderRequest(path, options, 'kits-orders');
  try {
    const result = await purchaseOrderRequest(path, options, 'kits-orders');
    if (!UUID.test(result?.id || '')) {
      // A successful HTTP status alone does not identify the persisted order.
      // Keep the original key/payload when a committed result cannot be read.
      const error = new Error();
      error.ambiguous = true;
      throw error;
    }
    return result;
  } catch (error) { throw failure(error, 'save'); }
}
export async function updateOrder(id, body) {
  try {
    const result = await purchaseOrderRequest(`/${id}/edit`, { body }, 'kits-orders');
    if (result?.id !== id || result.version !== body.expected_version + 1) {
      const error = new Error(); error.ambiguous = true; throw error;
    }
    return result;
  } catch (error) { throw failure(error, 'save'); }
}
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
  let result;
  try {
    result = await immunotherapyFileRequest('', { file, kits: true });
  } catch (error) { throw failure(error, 'upload'); }
  if (!UUID.test(result?.id || '') || result.state !== 'verified' || result.scanner_status !== 'clean'
      || result.size !== file.size || result.content_type !== file.type) {
    const error = new Error('Attachment verification was not confirmed. The order request was not sent. Your values and files remain here. Ask the operator to check scanning and the upload response before retrying.');
    error.stage = 'upload';
    throw error;
  }
  return { id: result.id, name: file.name, size: result.size, type: result.content_type, state: result.state };
}
export async function downloadAttachment(file) {
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true, kits: true });
  downloadServerBlob(blob, file.name);
}
