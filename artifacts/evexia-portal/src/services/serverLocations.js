import { locationRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const listLocations = (params, signal) => locationRequest('', { params, signal });
export const createLocation = (body) => locationRequest('', { body });
export const getLocation = (id) => locationRequest(`/${id}`);
export const editLocation = (record, values) => locationRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusLocation = (record, status) => locationRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteLocation = (record) => locationRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewLocations = (file) => locationRequest('/import/review', { file, params: { filename: file.name } });
export const importLocations = (file, digest) => locationRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportLocations = (params, format) => locationRequest('/export', { params: { ...params, format }, download: true });

export function downloadLocationFile(blob, format) {
  downloadServerBlob(blob, `evexia-storage-location-master.${format}`);
}
