import { vendorRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const listVendors = (params, signal) => vendorRequest('', { params, signal });
export const createVendor = (body) => vendorRequest('', { body });
export const getVendor = (id) => vendorRequest(`/${id}`);
export const editVendor = (record, values) => vendorRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusVendor = (record, status) => vendorRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteVendor = (record) => vendorRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewVendors = (file) => vendorRequest('/import/review', { file, params: { filename: file.name } });
export const importVendors = (file, digest) => vendorRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportVendors = (params, format, signal) => vendorRequest('/export', { params: { ...params, format }, download: true, signal });
export const sampleVendors = (format, signal) => vendorRequest('/sample', { params: { format }, download: true, signal });

export function downloadVendorFile(blob, format, sample = false) {
  downloadServerBlob(blob, `evexia-vendor-${sample ? 'template' : 'master'}.${format}`);
}
