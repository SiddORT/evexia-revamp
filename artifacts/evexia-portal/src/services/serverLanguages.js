import { languageRequest, SessionError } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const recordOK = (r) => r && uuid(r.id) && typeof r.name === 'string' && r.name.trim() === r.name
  && [...r.name].length >= 1 && [...r.name].length <= 200 && count(r.version) && r.version > 0
  && typeof r.createdBy === 'string' && typeof r.updatedBy === 'string' && date(r.createdAt) && date(r.updatedAt)
  && ((r.deletedAt === null && r.deletedBy === null) || (date(r.deletedAt) && typeof r.deletedBy === 'string'));
const pageOK = (p) => p && Array.isArray(p.items) && count(p.total) && count(p.limit)
  && p.limit >= 1 && p.limit <= 100 && p.items.length <= p.limit && count(p.offset);

async function request(path, options, valid) {
  const data = await languageRequest(path, options);
  if (!valid(data)) {
    const error = new SessionError('Language response could not be confirmed. Your draft is preserved; review current server records before retrying.');
    error.ambiguous = Boolean(options?.body || path === '/import/commit');
    throw error;
  }
  return data;
}

export const listLanguages = (params, signal) => request('', { params, signal },
  (p) => pageOK(p) && count(p.filtered) && p.filtered <= p.total && p.items.every(recordOK));
export const getLanguage = (id, signal) => request(`/${id}`, { signal }, (r) => recordOK(r) && r.id === id);
export const createLanguage = (body) => request('', { body }, recordOK);
export const editLanguage = (record, values) => request(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } },
  (r) => recordOK(r) && r.id === record.id && r.version === record.version + 1 && r.deletedAt === null);
export const deleteLanguage = (record) => request(`/${record.id}/delete`, { body: { expected_version: record.version } },
  (r) => recordOK(r) && r.id === record.id && r.version === record.version + 1 && date(r.deletedAt));
export const getLanguageHistory = (id, { limit = 10, offset = 0 } = {}, signal) => request(`/${id}/history`, { params: { limit, offset }, signal },
  (p) => pageOK(p) && recordOK(p.record) && p.record.id === id
    && p.items.every((h) => uuid(h.id) && ['create', 'edit', 'delete'].includes(h.action)
      && count(h.version) && h.version > 0 && typeof h.actor === 'string' && date(h.at)
      && (h.beforeName === null || typeof h.beforeName === 'string') && typeof h.afterName === 'string')
    && p.summary && typeof p.summary.scope === 'string'
    && ['creates', 'edits', 'deletes', 'total'].every((key) => count(p.summary[key]))
    && p.summary.total === p.total && p.summary.creates + p.summary.edits + p.summary.deletes === p.total
    && (p.summary.latestChange === null || date(p.summary.latestChange)));

export const reviewLanguages = (file) => request('/import/review', { file, params: { filename: file.name } },
  (p) => p && Array.isArray(p.rows) && p.rows.length >= 1 && p.rows.length <= 1000
    && p.rows.every((row, index) => row.row === index + 2 && typeof row.values?.name === 'string'
      && Array.isArray(row.errors) && row.errors.every((error) => typeof error === 'string'))
    && typeof p.valid === 'boolean' && /^[0-9a-f]{64}$/.test(p.digest)
    && count(p.validCount) && count(p.invalidCount) && p.validCount + p.invalidCount === p.rows.length
    && p.invalidCount === p.rows.filter((row) => row.errors.length).length && p.valid === (p.invalidCount === 0));
export const importLanguages = (file, digest, expectedCount) => {
  if (!/^[0-9a-f]{64}$/.test(digest || '') || !count(expectedCount) || expectedCount < 1 || expectedCount > 1000) {
    throw new Error('Review this file before confirming import.');
  }
  return request('/import/commit', { file, params: { filename: file.name, digest, confirm: true } },
    (p) => p && p.imported === expectedCount);
};
export const exportLanguages = (query, format, signal) => languageRequest('/export', { params: { query, format }, download: true, signal });
export const sampleLanguages = (format, signal) => languageRequest('/sample', { params: { format }, download: true, signal });
export function downloadLanguageFile(blob, format, sample = false) {
  downloadServerBlob(blob, `evexia-language-${sample ? 'template' : 'master'}.${format}`);
}
