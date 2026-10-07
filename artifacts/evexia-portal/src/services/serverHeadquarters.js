import { headquarterRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const listHeadquarters = (params, signal) => headquarterRequest('', { params, signal });
export const createHeadquarter = (body) => headquarterRequest('', { body });
export const getHeadquarter = (id) => headquarterRequest(`/${id}`);
export const editHeadquarter = (record, values) => headquarterRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusHeadquarter = (record, status) => headquarterRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteHeadquarter = (record) => headquarterRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const reviewHeadquarters = (file) => headquarterRequest('/import/review', { file, params: { filename: file.name } });
export const importHeadquarters = (file, digest) => headquarterRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportHeadquarters = (params, format, signal) => headquarterRequest('/export', { params: { ...params, format }, download: true, signal });
export const sampleHeadquarters = (format, signal) => headquarterRequest('/sample', { params: { format }, download: true, signal });
export const downloadHeadquarterFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-headquarter-${sample ? 'template' : 'master'}.${format}`);
