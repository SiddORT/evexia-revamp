import { orderRequest } from './orderFreshness.js';

export const request = (path = '', options) => orderRequest(path, options, 'spt-orders');
export const STATUSES = Object.freeze(['Draft', 'Saved', 'In process', 'Rejected']);
export const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
export function parseAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const totalMinor = (patients) => patients.reduce((sum, p) => sum + (parseAmount(p.amount) ?? 0n), 0n);
export const money = (minor) => `₹${(minor / 100n).toLocaleString('en-IN')}.${String(minor % 100n).padStart(2, '0')}`;
export function validateOrder(values, status) {
  const errors = {};
  if (status === 'Saved') {
    if (!values.doctorId) errors.doctorId = 'Choose a Doctor.';
    if (!values.mrId) errors.mrId = 'Choose an MR.';
    if (!values.patients.length) errors.patients = 'Add at least one patient.';
  }
  if (values.patients.length > 200) errors.patients = 'Include at most 200 patients.';
  if (new Set(values.patients.map((p) => p.id)).size !== values.patients.length) errors.patients = 'Each patient may appear only once.';
  values.patients.forEach((p) => {
    if ((p.amount || status === 'Saved') && parseAmount(p.amount) === null) errors[`amount-${p.id}`] = 'Enter a non-negative amount with up to nine whole digits and two decimal places.';
  });
  return errors;
}
export const orderInput = (values, status = values.status) => ({
  doctorId: values.doctorId || null, mrId: values.mrId || null, remarks: values.remarks,
  patients: values.patients.map(({ id, source, amount }) => ({ id, source, amount })), status,
});
