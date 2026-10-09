import { openingBalanceRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const listOpeningBalances = (params, signal) => openingBalanceRequest('', { params, signal });
export const createOpeningBalance = (body) => openingBalanceRequest('', { body });
export const getOpeningBalance = (id, signal) => openingBalanceRequest(`/${id}`, { signal });
export const editOpeningBalance = (record, values) => openingBalanceRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusOpeningBalance = (record, status) => openingBalanceRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteOpeningBalance = (record) => openingBalanceRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const openingBalanceDoctors = (params, signal) => openingBalanceRequest('/references', { params, signal });
export const reviewOpeningBalances = (file) => openingBalanceRequest('/import/review', { file, params: { filename: file.name } });
export const importOpeningBalances = (file, digest) => openingBalanceRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportOpeningBalances = (params, format, signal) => openingBalanceRequest('/export', { params: { ...params, format }, download: true, signal });
export const sampleOpeningBalances = (format, signal) => openingBalanceRequest('/sample', { params: { format }, download: true, signal });
export const downloadOpeningBalanceFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-opening-balances-${sample ? 'template' : 'master'}.${format}`);
