import { salesTargetRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));

export const listSalesTargets = (params, signal) => salesTargetRequest('', { params: clean(params), signal });
export const salesTargetChoices = (params, signal) => salesTargetRequest('/choices', { params: clean(params), signal });
export const createSalesTarget = (body) => salesTargetRequest('', { body });
export const getSalesTarget = (id, signal) => salesTargetRequest(`/${id}`, { signal });
export const editSalesTarget = (record, values) => salesTargetRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusSalesTarget = (record, status) => salesTargetRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteSalesTarget = (record) => salesTargetRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewSalesTargets = (file) => salesTargetRequest('/import/review', { file, params: { filename: file.name } });
export const importSalesTargets = (file, digest) => salesTargetRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportSalesTargets = (params, format, signal) => salesTargetRequest('/export', { params: { ...clean(params), format }, download: true, signal });
export const sampleSalesTargets = (format, signal) => salesTargetRequest('/sample', { params: { format }, download: true, signal });

export function downloadSalesTargetFile(blob, format, sample = false) {
  downloadServerBlob(blob, `evexia-sales-target-${sample ? 'template' : 'master'}.${format}`);
}
