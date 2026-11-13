import { purchaseOrderRequest } from '../auth/adminSession.js';
import { catalogueRate } from './rates.js';
import { validDate, MalformedResponseError } from './serverPricingRules.js';

const request = (path, options) => purchaseOrderRequest(`/count-tariffs${path}`, options, 'pricing-rules');
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function checked(row, categoryId) {
  if (!row || !uuid(row.id) || row.categoryId !== categoryId || ![1, 2, 3].includes(row.allergenCount)
      || !Number.isInteger(row.version) || row.version < 1 || !validDate(row.effectiveFrom)
      || !uuid(row.actorId) || typeof row.recordedAt !== 'string' || Number.isNaN(Date.parse(row.recordedAt))
      || typeof row.totalMrp !== 'string' || catalogueRate(row.totalMrp) !== row.totalMrp) {
    throw new MalformedResponseError('dated category/count tariff');
  }
  return row;
}
export async function loadCountTariffs(id, signal) {
  const value = await request(`/${id}`, { signal });
  if (value?.categoryId !== id || typeof value.categoryName !== 'string'
      || !Number.isInteger(value.categoryVersion) || value.categoryVersion < 1
      || (value.suggestedUnitPrice !== null && (typeof value.suggestedUnitPrice !== 'string' || catalogueRate(value.suggestedUnitPrice) !== value.suggestedUnitPrice))
      || (value.suggestedUnitPrice === null && typeof value.suggestionError !== 'string')
      || !Array.isArray(value.history)) throw new MalformedResponseError('tariff history and Unit Price suggestion');
  value.history.forEach((row) => checked(row, id));
  if (new Set(value.history.map((r) => `${r.allergenCount}:${r.effectiveFrom}`)).size !== value.history.length
      || new Set(value.history.map((r) => r.id)).size !== value.history.length) throw new MalformedResponseError('tariff history');
  return value;
}
export async function tariffCategories(params, signal) {
  const value = await request('/categories', { params, signal });
  if (!Array.isArray(value?.items) || value.items.some((r) => !uuid(r.id) || typeof r.name !== 'string'
      || !['active', 'inactive'].includes(r.status))
      || (value.nextOffset !== null && (!Number.isInteger(value.nextOffset) || value.nextOffset < 1))) {
    throw new MalformedResponseError('tariff category choices');
  }
  return value;
}
export async function appendCountTariff(body) {
  const row = checked(await request('', { body }), body.categoryId);
  if (row.allergenCount !== body.allergenCount || row.totalMrp !== body.totalMrp
      || row.effectiveFrom !== body.effectiveFrom || row.version !== body.expected_version + 1) {
    throw new MalformedResponseError('saved tariff');
  }
  return row;
}
