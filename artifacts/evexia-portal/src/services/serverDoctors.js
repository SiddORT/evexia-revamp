import { doctorRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all'));
export const listDoctors = (params, signal) => doctorRequest('', { params: clean(params), signal });
export const getDoctor = (id, signal) => doctorRequest(`/${id}`, { signal });
export const getDoctorOrders = (id, params, signal) => doctorRequest(`/${id}/orders`, { params: clean(params), signal });
export const doctorFilters = (signal) => doctorRequest('/filters', { signal });
export const doctorMRChoices = (params, signal) => doctorRequest('/references', { params: clean(params), signal });
// Exact Doctor location reference choices (zones / headquarters / areas), strictly
// parent-scoped by the server including saved-selection hydration.
export const doctorTerritoryChoices = (kind, { query = '', limit = 100, offset = 0, includeSaved, zoneId, hqIds } = {}, signal) =>
  doctorRequest('/territory-choices', { params: clean({ kind, query: query || undefined, limit: Math.min(limit, 100), offset, include_saved: includeSaved, zone_id: zoneId, hq_ids: hqIds?.length ? hqIds.join(',') : undefined }), signal });
// Initial section plus saved-selection hydration only. The UI explicitly
// searches/continues choices; never traverse the complete directory silently.
export async function allDoctorMRChoices(signal, saved) {
  const result = await doctorMRChoices({ limit: 100, offset: 0, include_saved: saved }, signal);
  return result.items;
}
export const createDoctor = (body) => doctorRequest('', { body });
// Exact location corrections carry their separate Area version and reason.
// Other fields still use the ordinary Doctor version.
export const editDoctor = (record, body) => {
  return doctorRequest(`/${record.id}/edit`, { body: { ...body, expected_version: record.version } });
};
export const statusDoctor = (record, status) => doctorRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteDoctor = (record) => doctorRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const contactDoctor = (record, contactRequirement) => doctorRequest(`/${record.id}/contact`, { body: { contactRequirement, expected_version: record.version } });
export const bulkDoctors = (records, operation, value, reason) => doctorRequest('/bulk', { body: {
  selected: records.map((record) => ({ id: record.id, expected_version: record.version })), operation,
  ...(operation === 'shift' ? { mrId: value, ...(reason ? { reason } : {}) } : { verification: value }),
} });
// Doctor MR Mapping (bounded: list limit <= 100, references/history limit <= 50).
export const listDoctorMappings = (params, signal) => doctorRequest('/mapping', { params: clean({ ...params, limit: Math.min(Number(params?.limit) || 25, 100) }), signal });
export const doctorMappingReferences = (kind, params = {}, signal) => doctorRequest('/mapping/references', { params: clean({
  kind, query: params.query, limit: Math.min(Number(params.limit) || 50, 50), offset: params.offset,
  include_saved: params.includeSaved ?? params.include_saved, cursor: params.cursor,
}), signal });
export const doctorAssignmentHistory = (id, params = {}, signal) => doctorRequest(`/${id}/assignment-history`, { params: clean({ limit: Math.min(Number(params.limit) || 20, 50), offset: params.offset }), signal });
export const setDoctorArea = (record, areaId, reason) => doctorRequest(`/${record.id}/area`, { body: { expected_area_version: Number(record.areaVersion ?? 0), areaId: areaId || null, reason } });
export const lookupDoctorPIN = (pin, signal, action = 'add') => doctorRequest(`/postal/${pin}`, { signal, params: { action } });
export const sampleDoctors = (format, signal) => doctorRequest('/sample', { params: { format }, download: true, signal });
export const exportDoctors = (params, format, signal) => doctorRequest('/export', { params: { ...clean(params), format }, download: true, signal });
export const reviewDoctors = (file, signal) => doctorRequest('/import/review', { file, params: { filename: file.name }, signal });
export const importDoctors = (file, digest) => doctorRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const downloadDoctorFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-doctor-${sample ? 'sample' : 'master'}.${format}`);
