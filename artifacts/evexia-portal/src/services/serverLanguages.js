import { languageRequest, SessionError } from '../auth/adminSession.js';

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
    error.ambiguous = Boolean(options?.body);
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
