import { mrRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

// Server-backed MR Master. Separate from services/mrs.js, which serves the
// browser-local demo consumers and must stay untouched.
const clean = (params = {}) => Object.fromEntries(Object.entries(params)
  .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all'));

export const MR_FIELDS = ['name', 'phone', 'userId', 'email', 'contactRequirement', 'hq', 'zoneId', 'employeeCode',
  'dateOfJoining', 'designation', 'reportingManagerId', 'paymentLimit', 'doctorDaysLimit', 'status', 'pincode',
  'addressLine1', 'addressLine2', 'landmark', 'city', 'state', 'country'];
export const MAX_LENGTH = { name: 200, employeeCode: 64, addressLine1: 300, addressLine2: 300, landmark: 200, city: 100, state: 100, country: 100, phone: 20, email: 320, designation: 200 };
export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,31}$/;
export const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

export const listMRs = (params, signal) => mrRequest('', { params: clean(params), signal });
export const getMR = (id, signal) => mrRequest(`/${id}`, { signal });
export const resolveMRAccount = (username, signal) => mrRequest(`/account/${username}`, { signal });
export const mrReferences = (kind, { query = '', limit = 100, offset = 0, includeSaved } = {}, signal) =>
  mrRequest('/references', { params: clean({ kind, query, limit, offset, include_saved: includeSaved }), signal });
export const generateMRUsername = (signal) => mrRequest('/username', { signal });
export const lookupPincode = (pin, signal) => mrRequest(`/postal/${pin}`, { signal });
export const createMR = (values, initialPassword) => mrRequest('', { body: { ...values, initialPassword: initialPassword || null } });
export const editMR = (record, values) => mrRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusMR = (record, status) => mrRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const contactMR = (record, contactRequirement) => mrRequest(`/${record.id}/contact`, { body: { contactRequirement, expected_version: record.version } });
export const deleteMR = (record) => mrRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const resetMRPassword = (record) => mrRequest(`/${record.id}/reset`, { body: { expected_version: record.version } });
export const reviewMRs = (file) => mrRequest('/import/review', { file, params: { filename: file.name } });
export const importMRs = (file, digest) => mrRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportMRs = (params, format, signal) => mrRequest('/export', { params: clean({ ...params, format }), download: true, signal });
export const sampleMRs = (format, signal) => mrRequest('/sample', { params: { format }, download: true, signal });

export function downloadMRFile(blob, format, sample = false) {
  downloadServerBlob(blob, `evexia-mr-${sample ? 'template' : 'master'}.${format}`);
}

export function emptyMRValues(mr) {
  return Object.fromEntries(MR_FIELDS.map((key) => [key,
    key === 'contactRequirement' ? (mr?.contactRequirement || 'required')
      : key === 'status' ? (mr?.status || 'active')
      : key === 'country' ? (mr ? (mr.country ?? '') : 'India')
      : key === 'paymentLimit' ? (mr ? String(mr.paymentLimit ?? '0.00') : '')
      : key === 'doctorDaysLimit' ? (mr ? String(mr.doctorDaysLimit ?? 0) : '')
      : key === 'dateOfJoining' ? String(mr?.[key] ?? '').slice(0, 10)
      : String(mr?.[key] ?? '')]));
}

function istToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function validateMRValues(values, { creating, password = '', confirm = '' } = {}) {
  values = normalizedValues(values);
  const errors = {};
  const optionalContact = values.contactRequirement === 'optional';
  const required = ['name', 'userId', 'hq', 'zoneId', 'employeeCode', 'dateOfJoining', 'designation', 'pincode', 'addressLine1', 'landmark', 'city', 'state', 'country'];
  if (!optionalContact) required.push('phone', 'email');
  required.forEach((key) => { if (!values[key].trim()) errors[key] = 'This field is required.'; });
  for (const [key, max] of Object.entries(MAX_LENGTH)) if (values[key].length > max) errors[key] = `Use at most ${max} characters.`;
  for (const key of MR_FIELDS) if (/\p{C}/u.test(values[key])) errors[key] = 'Control and invisible characters are not permitted.';
  if (!['required', 'optional'].includes(values.contactRequirement)) errors.contactRequirement = 'Choose a contact requirement.';
  const phone = values.phone.replace(/[\s()-]/g, '');
  if (phone && !/^[0-9]{10}$/.test(phone)) errors.phone = 'Enter a 10-digit phone number.';
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Enter a valid email address.';
  if (values.userId && !USERNAME_PATTERN.test(values.userId)) errors.userId = 'Use 3-32 characters: lowercase letter first, then lowercase letters, digits, dot, underscore or hyphen.';
  if (values.dateOfJoining) {
    const date = values.dateOfJoining;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) errors.dateOfJoining = 'Enter a valid joining date.';
    else if (date > istToday()) errors.dateOfJoining = 'Joining date cannot be in the future (India time).';
  }
  if (values.pincode && !/^[1-9][0-9]{5}$/.test(values.pincode)) errors.pincode = 'Enter a 6-digit pincode.';
  if (values.paymentLimit && (!/^\d{1,9}(\.\d{1,2})?$/.test(values.paymentLimit))) errors.paymentLimit = 'Enter an amount from 0 to 999999999.99 with up to 2 decimals.';
  if (values.doctorDaysLimit && (!/^\d{1,4}$/.test(values.doctorDaysLimit) || Number(values.doctorDaysLimit) > 3650)) errors.doctorDaysLimit = 'Enter a whole number from 0 to 3650.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose a valid status.';
  for (const key of ['hq', 'zoneId', 'reportingManagerId']) if (values[key] && !UUID_PATTERN.test(values[key])) errors[key] = 'Select a saved server record.';
  if (creating && (password || confirm)) {
    if (password.length < 12 || password.length > 128) errors.password = 'Use 12 to 128 characters, or leave blank to generate one.';
    else if (password !== confirm) errors.confirmPassword = 'Passwords do not match.';
  }
  return errors;
}

export function payloadFromValues(values) {
  const trimmed = normalizedValues(values);
  return {
    ...trimmed,
    phone: trimmed.phone.replace(/[\s()-]/g, ''),
    email: trimmed.email,
    reportingManagerId: trimmed.reportingManagerId || null,
    paymentLimit: trimmed.paymentLimit === '' ? '0.00' : trimmed.paymentLimit,
    doctorDaysLimit: trimmed.doctorDaysLimit === '' ? 0 : Number(trimmed.doctorDaysLimit),
  };
}

function normalizedValues(values) {
  const normalized = Object.fromEntries(MR_FIELDS.map((key) => [key, String(values[key] ?? '').trim()]));
  normalized.userId = normalized.userId.toLowerCase();
  normalized.email = normalized.email.toLowerCase();
  normalized.phone = normalized.phone.replace(/[\s()-]/g, '').replace(/^\+91(?=\d{10}$)/, '');
  return normalized;
}
