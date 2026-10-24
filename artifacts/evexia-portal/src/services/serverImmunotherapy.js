import { getSession, immunotherapyFileRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';
import { orderRequest } from './orderFreshness.js';

export const request = (path = '', options) => orderRequest(path, options, 'immunotherapy-orders');
const optionalPO = (value) => typeof value === 'string' && !value.trim() ? null : value || null;
export const STATUSES = Object.freeze(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const PRELIMINARY_DOSES = Object.freeze(['PD', 'DD']);
export const DOSES = Object.freeze([...PRELIMINARY_DOSES, ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`)]);
export const GENDERS = Object.freeze(['male', 'female', 'other', 'prefer not to say']);
export function parseAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const totalMinor = (groups, basis = 'legacy_bottle_mrp') => {
  const amounts = basis === 'allergen_rates' ? groups.flatMap((g) => g.items.map((i) => i.rate)) : groups.map((g) => g.mrp);
  return !amounts.length || amounts.some((value) => parseAmount(value) === null) ? null : amounts.reduce((sum, value) => sum + parseAmount(value), 0n);
};
// Read/print/export consumers use the authoritative saved amount, never reprice.
export const orderTotalMinor = (order) => order.totalMinor == null ? null : BigInt(order.totalMinor);
export const money = (minor) => minor === null ? 'Awaiting pricing' : `₹${(minor / 100n).toLocaleString('en-IN')}.${String(minor % 100n).padStart(2, '0')}`;
export const mrEditable = (order) => Boolean(order.mrEditable);
// Callers retain issued IDs for the editor lifetime, including removed bottles.
export function newGroup(issuedIds = []) {
  const used = new Set(issuedIds);
  let number = 1;
  while (used.has(`BOT-${String(number).padStart(3, '0')}`)) number += 1;
  return { id: `BOT-${String(number).padStart(3, '0')}`, mrp: '', items: [] };
}
export const bottleLabel = (group, index) => /^BOT-\d{3,6}$/.test(group.id) ? group.id : `Saved bottle ${index + 1}`;
export const groupingError = (items) => new Set(items.map((i) => i.allergenId)).size === items.length ? '' : 'Duplicate allergens within a bottle are not allowed.';
export const nextDose = () => ({ dosage: '', explanation: 'No administration history is recorded by this order workflow. Choose a dosage explicitly; order status is not evidence of a given dose.' });
export function shippingRecipient(order) { return order.recipient || order[order.shipping] || null; }
export function orderInput(v) {
  const mr = getSession().user?.identity_kind === 'mr';
  return Object.fromEntries(Object.entries({
    patientId: v.patientId, doctorId: v.doctorId, mrId: v.mrId, dosage: v.dosage, histamine: v.histamine, saline: v.saline,
    ...(!mr && v.pricingBasis ? { pricingBasis: v.pricingBasis } : {}),
    groups: v.groups.map((g) => ({ id: g.id, ...(!mr ? { mrp: g.mrp || null } : {}),
      items: g.items.map(({ allergenId, result, rate, suborderId }) => ({ allergenId, result,
        ...(suborderId ? { suborderId } : {}), ...(!mr ? { rate: rate || null } : {}) })) })),
    remarks: v.remarks, shipping: v.shipping, status: v.status || 'Confirmed',
    ...(!mr ? { poNumber: optionalPO(v.poNumber), ...(v.decision ? { decision: v.decision } : {}) } : {}),
    attachmentIds: v.attachments.map((f) => f.id),
  }));
}
// Capture wire values once: retrying never re-derives portal fields or version.
export const prepareOrderSave = (v, order, key) => ({
  path: order ? `/${order.id}/edit` : '', owner: getSession().user?.id,
  body: structuredClone({ ...orderInput(v), idempotencyKey: key, expected_version: order?.version ?? null }),
});
export const submitOrderSave = (submission) => {
  if (!submission.owner || getSession().user?.id !== submission.owner) {
    const error = new Error('Only the original signed-in account can recover this save. Your draft is preserved.');
    error.status = 401;
    throw error;
  }
  return request(submission.path, { body: submission.body });
};
export const saveOrder = (v, order, key) => submitOrderSave(prepareOrderSave(v, order, key));

const RESULT = /^\d{1,6}(?:\.\d{1,2})?$/;
const RESULT_HELP = 'Enter a required non-negative result in mm, with up to six whole digits and two decimal places.';
export const skinResultError = (value) => RESULT.test(value) ? '' : RESULT_HELP;
const PRICE_HELP = 'Enter a required non-negative MRP in INR, with up to ten whole digits and two decimal places.';
export const PRESCRIPTION_HELP = 'Upload and attach at least one verified prescription for the selected patient. Pending, failed or removed files do not count.';
const financialFingerprint = (groups) => JSON.stringify(groups.map((g) => [
  g.id, parseAmount(g.mrp)?.toString() ?? null,
  g.items.map((i) => [i.allergenId, parseAmount(i.rate)?.toString() ?? null]).sort(([a], [b]) => a.localeCompare(b)),
]).sort(([a], [b]) => a.localeCompare(b)));

export function orderErrors(v, hasPrescription, { mr = false, previous = null } = {}) {
  const errors = {};
  for (const [field, label] of [['patientId', 'patient'], ['doctorId', 'Doctor'], ['mrId', 'MR']]) {
    if (!v[field]) errors[field] = `Select a ${label}.`;
  }
  if (!DOSES.includes(v.dosage)) errors.dosage = 'Choose a dosage from PD, DD or B1–B8.';
  for (const field of ['histamine', 'saline']) if (!RESULT.test(v[field])) errors[field] = RESULT_HELP;
  if (!v.groups.length || v.groups.length > 100) errors.groups = 'Use between one and 100 saved groups.';
  if (v.groups.reduce((n, g) => n + g.items.length, 0) > 1000) errors.groups = 'Use at most 1,000 allergen suborders across all saved groups.';
  for (const group of v.groups) {
    if (!group.items.length || group.items.length > 100) errors[`group-${group.id}`] = 'Add between one and 100 allergens to this group in Allergen Details.';
    else if (groupingError(group.items)) errors[`group-${group.id}`] = groupingError(group.items);
    if (!mr && group.mrp != null && group.mrp !== '' && parseAmount(group.mrp) === null) errors[`mrp-${group.id}`] = PRICE_HELP;
    for (const item of group.items) if (!mr && item.rate != null && item.rate !== '' && parseAmount(item.rate) === null) errors[`rate-${group.id}-${item.allergenId}`] = 'Enter a non-negative INR rate with up to ten whole digits and two decimal places.';
    for (const item of group.items) if (!RESULT.test(item.result)) errors[`result-${group.id}-${item.allergenId}`] = RESULT_HELP;
  }
  const basis = v.pricingBasis || previous?.pricingBasis || (previous ? 'legacy_bottle_mrp' : 'allergen_rates');
  const enteredTotal = v.groups.reduce((sum, g) => sum + (basis === 'allergen_rates'
    ? g.items.reduce((n, i) => n + (parseAmount(i.rate) ?? 0n), 0n) : (parseAmount(g.mrp) ?? 0n)), 0n);
  if (enteredTotal > 10000000000n) errors.groups = 'Order value must not exceed ₹10 crore.';
  const sameFinancials = !v.decision && previous && v.status === previous.status
    && basis === (previous.pricingBasis || 'legacy_bottle_mrp')
    && financialFingerprint(v.groups) === financialFingerprint(previous.groups);
  if (!mr && ['In process', 'Shipped', 'Delivered', 'Returned'].includes(v.status) && !sameFinancials) {
    for (const group of v.groups) {
      for (const item of group.items) if (parseAmount(item.rate) === null) errors[`rate-${group.id}-${item.allergenId}`] = 'Enter the INR rate for this allergen occurrence before approval.';
    }
    if (basis !== 'allergen_rates') errors.groups = 'Explicitly select allergen-rate pricing and enter every suborder rate before approval or a new fulfillment decision.';
  }
  if (!mr && previous && (previous.pricingBasis || 'legacy_bottle_mrp') === 'legacy_bottle_mrp' && basis === 'allergen_rates') {
    for (const group of v.groups) for (const item of group.items) {
      if (parseAmount(item.rate) === null) errors[`rate-${group.id}-${item.allergenId}`] = 'Enter every rate before changing the historical pricing basis.';
    }
  }
  if (!mr && ['In process', 'Shipped', 'Delivered', 'Returned'].includes(v.status) && (!previous || ['Confirmed', 'Rejected'].includes(previous.status))) errors.status = 'Approve this order explicitly before moving it to fulfillment.';
  if (optionalPO(v.poNumber)?.length > 100) errors.poNumber = 'Use at most 100 characters.';
  if ((v.remarks || '').length > 4000) errors.remarks = 'Use at most 4,000 characters.';
  if (!['patient', 'doctor'].includes(v.shipping)) errors.shipping = 'Choose Patient or Doctor for shipping.';
  if (!STATUSES.includes(v.status)) errors.status = 'Choose a listed order status.';
  if (!hasPrescription) errors.attachments = PRESCRIPTION_HELP;
  if (v.attachments.length > 10) errors.attachments = 'Attach at most ten verified prescriptions.';
  return errors;
}

// Only structural, allowlisted server paths/codes reach this mapper, never values
// or arbitrary validator messages. Indexes resolve against the submitted draft.
export function saveErrors(cause, v) {
  const errors = {};
  for (const { field, code } of cause.validationFields || []) {
    if (code === 'extra_forbidden') {
      errors.form = 'The submitted order contains an unsupported field. Your draft is preserved; ask the operator to check the form/API versions.';
      continue;
    }
    const key = field.replace(/^body\./, '');
    if (['patientId', 'doctorId', 'mrId'].includes(key)) errors[key] = 'Select an available saved reference.';
    else if (key === 'dosage') errors.dosage = 'Choose a dosage from PD, DD or B1–B8.';
    else if (['histamine', 'saline'].includes(key)) errors[key] = RESULT_HELP;
    else if (key === 'shipping') errors.shipping = 'Choose Patient or Doctor for shipping.';
    else if (key === 'status') errors.status = 'Choose a listed order status.';
    else if (key === 'remarks') errors.remarks = 'Use at most 4,000 characters.';
    else if (key === 'poNumber') errors.poNumber = 'Leave PO number blank, or use at most 100 characters.';
    else if (key === 'pricingBasis') errors.groups = 'Use a supported saved pricing basis. Historical repricing requires the explicit allergen-rate choice.';
    else if (/^attachmentIds(?:\.\d+)?$/.test(key)) errors.attachments = PRESCRIPTION_HELP;
    else if (key === 'groups') errors.groups = 'Use one to 100 saved groups, retaining their internal IDs, and at most 1,000 allergen suborders.';
    else {
      const match = /^groups\.(\d+)(?:\.(id|mrp|items)(?:\.(\d+)(?:\.(allergenId|result|rate|suborderId))?)?)?$/.exec(key);
      const group = match && v.groups[Number(match[1])];
      const item = group && match[3] !== undefined && group.items[Number(match[3])];
      if (group) {
        if (match[2] === 'mrp') errors[`group-${group.id}`] = 'Historical bottle MRP is read-only. Use the explicit allergen-rate pricing choice rather than editing it.';
        else if (item && match[4] === 'result') errors[`result-${group.id}-${item.allergenId}`] = RESULT_HELP;
        else if (item && match[4] === 'rate') errors[`rate-${group.id}-${item.allergenId}`] = 'Enter a non-negative INR rate with at most two decimal places.';
        else errors[`group-${group.id}`] = match[2] === 'id'
          ? 'Internal group IDs must be unique and contain 1–100 characters. Retain saved group and occurrence identities.'
          : 'Add one to 100 valid saved allergens without duplicates; check each result in mm.';
      } else errors.form = 'The submitted order was rejected. Your draft is preserved; check the details or ask the operator to check the form/API versions.';
    }
  }
  if (cause.code === 'imm_attachment' || cause.code === 'imm_prescription_required') errors.attachments = PRESCRIPTION_HELP;
  if (cause.code === 'imm_relationship') {
    for (const key of ['patientId', 'doctorId', 'mrId']) errors[key] = 'Patient, Doctor and MR must match their current saved assignments. Re-select the patient and check these choices.';
  }
  if (cause.code === 'mr_order_assignment') errors.mrId = 'The order must use your signed-in saved MR assignment. Re-select an associated patient and Doctor.';
  if (cause.code === 'imm_total') errors.groups = 'Order value must not exceed ₹10 crore.';
  if (cause.code === 'imm_pricing') errors.form = 'Approval requires a rate for every suborder. PO number is optional. Reject without invented prices if the order will not proceed.';
  if (cause.code === 'imm_pricing_basis') errors.groups = 'Historical pricing is preserved until you explicitly select allergen-rate pricing and enter every rate. Bottle MRP cannot be edited for rate-sum orders.';
  if (cause.code === 'imm_suborder') errors.groups = 'Retain saved suborder IDs and group associations. New occurrence identities are issued by the server on save. Your draft is preserved.';
  if (cause.code === 'imm_admin_review') errors.status = cause.status === 403
    ? 'MR cannot change reviewed or historically priced orders, Admin prices, PO numbers or decisions. Reopen the saved order to see the current status.'
    : 'A reviewed order cannot return to Confirmed. Explicitly approve the order before moving it to fulfillment.';
  return Object.keys(errors).length ? errors : { form: cause.status === 422
    ? 'Order details were rejected. Check all required fields, allergen suborders and prescriptions. Your draft is preserved.'
    : cause.message };
}
export async function downloadPrescription(file, signal) {
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true, signal });
  signal?.throwIfAborted();
  downloadServerBlob(blob, file.name);
}
export async function prescriptionBlob(file, signal) {
  if (file.restricted || file.state !== 'verified') throw new Error('This prescription is restricted or is not verified.');
  const blob = await immunotherapyFileRequest(`/${file.id}/download`, { download: true, signal });
  signal?.throwIfAborted();
  if (!blob.size) throw new Error('The prescription is empty.');
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    const error = new Error('Only verified PDF, JPEG, PNG and WebP prescriptions can be viewed. Use Download if the viewer is unavailable.');
    error.code = 'unsupported_file_type';
    throw error;
  }
  return blob;
}
export const uploadPrescription = (file, patientId) => immunotherapyFileRequest('', { file, patientId });
export const prescriptionMetadata = (id) => immunotherapyFileRequest(`/${id}`);
export function validateAttachments(files, existing = [], maxBytes = 10485760) {
  if (files.length + existing.length > 10) return 'Select at most ten prescription files.';
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return 'Upload limit is unavailable. Reload the upload policy before retrying.';
  const measured = (size) => `${size.toLocaleString('en-IN')} bytes (${(size / 1024).toFixed(2)} KiB)`;
  const limit = `Enforced limit: ${measured(maxBytes)}.`;
  const allowed = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
  for (const f of files) {
    let size;
    try { size = f?.size; } catch { return `The selected file's byte size is unreadable. Reselect the original file. ${limit}`; }
    if (!Number.isSafeInteger(size) || size < 0 || typeof f?.slice !== 'function' || typeof f?.arrayBuffer !== 'function') return `The selected file or its byte size is unreadable. Reselect the original file. ${Number.isSafeInteger(size) ? `Measured size: ${measured(size)}. ` : ''}${limit}`;
    if (size === 0) return `The selected file is empty. Measured size: ${measured(size)}. ${limit}`;
    if (size > maxBytes) return `The selected file exceeds the upload limit. Measured size: ${measured(size)}. ${limit}`;
    if (!allowed[f.type]?.includes(f.name.split('.').at(-1).toLowerCase())) return 'Choose matching PDF, JPEG, PNG or WebP files.';
  }
  return '';
}
