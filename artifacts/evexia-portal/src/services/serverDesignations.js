import { designationRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const listDesignations = (params, signal) => designationRequest('', { params, signal });
export const createDesignation = (body) => designationRequest('', { body });
export const getDesignation = (id) => designationRequest(`/${id}`);
export const editDesignation = (record, values) => designationRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusDesignation = (record, status) => designationRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteDesignation = (record) => designationRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewDesignations = (file) => designationRequest('/import/review', { file, params: { filename: file.name } });
export const importDesignations = (file, digest) => designationRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportDesignations = (params, format, signal) => designationRequest('/export', { params: { ...params, format }, download: true, signal });
export const sampleDesignations = (format, signal) => designationRequest('/sample', { params: { format }, download: true, signal });

export function downloadDesignationFile(blob, format, sample = false) {
  downloadServerBlob(blob, `evexia-designation-${sample ? 'template' : 'master'}.${format}`);
}

export async function activeDesignationChoices(signal) {
  // One bounded directory operation, not automatic traversal.
  const result = await listDesignations({ status: 'active', limit: 100, offset: 0 }, signal);
  if (result.filtered > 100) throw new Error('More than 100 active designations. Narrow the active catalogue before choosing; no partial list was accepted.');
  return result.items;
}
