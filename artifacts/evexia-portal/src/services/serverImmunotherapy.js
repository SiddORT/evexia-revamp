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

const RESULT = /^\d{1,6}(?:\.\d{1,2})?$/;
const RESULT_HELP = 'Enter a required non-negative result in mm, with up to six whole digits and two decimal places.';
export const skinResultError = (value) => RESULT.test(value) ? '' : RESULT_HELP;
const PRICE_HELP = 'Enter a required non-negative MRP in INR, with up to ten whole digits and two decimal places.';
export const PRESCRIPTION_HELP = 'Upload and attach at least one verified prescription for the selected patient. Pending, failed or removed files do not count.';

export function orderErrors(v, hasPrescription) {
  const errors = {};
  for (const [field, label] of [['patientId', 'patient'], ['doctorId', 'Doctor'], ['mrId', 'MR']]) {
    if (!v[field]) errors[field] = `Select a ${label}.`;
  }
  if (!DOSES.includes(v.dosage)) errors.dosage = 'Choose a dosage from PD, DD or B1–B8.';
  for (const field of ['histamine', 'saline']) if (!RESULT.test(v[field])) errors[field] = RESULT_HELP;
  if (!v.groups.length || v.groups.length > 100) errors.groups = 'Use between one and 100 bottles.';
  if (v.groups.reduce((n, g) => n + g.items.length, 0) > 1000) errors.groups = 'Use at most 1,000 allergen items across all bottles.';
  for (const group of v.groups) {
    if (!group.items.length || group.items.length > 100) errors[`group-${group.id}`] = 'Add between one and 100 allergens to this group in Allergen Details.';
    else if (groupingError(group.items)) errors[`group-${group.id}`] = groupingError(group.items);
    if (parseAmount(group.mrp) === null) errors[`mrp-${group.id}`] = PRICE_HELP;
    for (const item of group.items) if (!RESULT.test(item.result)) errors[`result-${group.id}-${item.allergenId}`] = RESULT_HELP;
  }
  if (totalMinor(v.groups) > 10000000000n) errors.groups = 'Order value must not exceed ₹10 crore.';
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
    else if (/^attachmentIds(?:\.\d+)?$/.test(key)) errors.attachments = PRESCRIPTION_HELP;
    else if (key === 'groups') errors.groups = 'Use one to 100 bottles, with unique IDs and at most 1,000 allergen items.';
    else {
      const match = /^groups\.(\d+)(?:\.(id|mrp|items)(?:\.(\d+)(?:\.(allergenId|result))?)?)?$/.exec(key);
      const group = match && v.groups[Number(match[1])];
      const item = group && match[3] !== undefined && group.items[Number(match[3])];
      if (group) {
        if (match[2] === 'mrp') errors[`mrp-${group.id}`] = PRICE_HELP;
        else if (item && match[4] === 'result') errors[`result-${group.id}-${item.allergenId}`] = RESULT_HELP;
        else errors[`group-${group.id}`] = match[2] === 'id'
          ? 'Bottle IDs must be unique and contain 1–100 characters. Retain saved IDs; remove and recreate only an unsaved bottle.'
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
  return Object.keys(errors).length ? errors : { form: cause.status === 422
    ? 'Order details were rejected. Check all required fields, bottle contents and prescriptions. Your draft is preserved.'
    : cause.message };
}
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
