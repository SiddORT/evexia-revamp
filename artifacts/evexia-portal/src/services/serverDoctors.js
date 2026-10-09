import { doctorRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all'));
export const listDoctors = (params, signal) => doctorRequest('', { params: clean(params), signal });
export const getDoctor = (id, signal) => doctorRequest(`/${id}`, { signal });
export const doctorFilters = (signal) => doctorRequest('/filters', { signal });
export const doctorMRChoices = (params, signal) => doctorRequest('/references', { params: clean(params), signal });
// Explicitly traverse every page; no first-page-only selector.
export async function allDoctorMRChoices(signal, saved) {
  const items = new Map();
  let offset = 0;
  let result;
  do {
    result = await doctorMRChoices({ limit: 100, offset, include_saved: saved }, signal);
    if (!Number.isInteger(result.total) || result.total < 0 || result.total > 10000 || result.limit !== 100) {
      throw new Error('Doctor reference choices exceed the supported 10,000-record bound or returned an invalid page. No partial choices were loaded.');
    }
    for (const item of result.items) items.set(item.id, item);
    offset += result.limit;
  } while (offset < result.total);
  return [...items.values()];
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
