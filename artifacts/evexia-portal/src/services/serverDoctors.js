import { doctorRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all'));
export const listDoctors = (params, signal) => doctorRequest('', { params: clean(params), signal });
export const getDoctor = (id, signal) => doctorRequest(`/${id}`, { signal });
export const doctorFilters = (signal) => doctorRequest('/filters', { signal });
export const doctorMRChoices = (params, signal) => doctorRequest('/references', { params: clean(params), signal });
// Initial section plus saved-selection hydration only. The UI explicitly
// searches/continues choices; never traverse the complete directory silently.
export async function allDoctorMRChoices(signal, saved) {
  const result = await doctorMRChoices({ limit: 100, offset: 0, include_saved: saved }, signal);
  return result.items;
}
export const createDoctor = (body) => doctorRequest('', { body });
export const editDoctor = (record, body) => doctorRequest(`/${record.id}/edit`, { body: { ...body, expected_version: record.version } });
export const statusDoctor = (record, status) => doctorRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteDoctor = (record) => doctorRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const contactDoctor = (record, contactRequirement) => doctorRequest(`/${record.id}/contact`, { body: { contactRequirement, expected_version: record.version } });
export const bulkDoctors = (records, operation, value) => doctorRequest('/bulk', { body: {
  selected: records.map((record) => ({ id: record.id, expected_version: record.version })), operation,
  ...(operation === 'shift' ? { mrId: value } : { verification: value }),
} });
export const lookupDoctorPIN = (pin, signal, action = 'add') => doctorRequest(`/postal/${pin}`, { signal, params: { action } });
export const sampleDoctors = (format, signal) => doctorRequest('/sample', { params: { format }, download: true, signal });
export const exportDoctors = (params, format, signal) => doctorRequest('/export', { params: { ...clean(params), format }, download: true, signal });
export const reviewDoctors = (file, signal) => doctorRequest('/import/review', { file, params: { filename: file.name }, signal });
export const importDoctors = (file, digest) => doctorRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const downloadDoctorFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-doctor-${sample ? 'sample' : 'master'}.${format}`);
