import { zoneRequest } from '../auth/adminSession.js';

export const listZones = (params, signal) => zoneRequest('', { params, signal });
export const createZone = (body) => zoneRequest('', { body });
export const getZone = (id) => zoneRequest(`/${id}`);
export const editZone = (record, values) => zoneRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusZone = (record, status) => zoneRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteZone = (record) => zoneRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewZones = (file) => zoneRequest('/import/review', { file, params: { filename: file.name } });
export const importZones = (file, digest) => zoneRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportZones = (params, format) => zoneRequest('/export', { params: { ...params, format }, download: true });

export function downloadZoneFile(blob, format) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `evexia-zone-master.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
