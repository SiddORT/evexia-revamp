import { purchaseOrderRequest } from '../auth/adminSession.js';
import { MalformedResponseError, validDate } from './serverPricingRules.js';
import { DOSES } from './serverImmunotherapy.js';

export const DOSAGES = DOSES;
const request = (path, options) => purchaseOrderRequest(`/combinations${path}`, options, 'pricing-rules');
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const token = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const malformed = () => { throw new MalformedResponseError('combination pricing'); };
export const memberKey = (ids) => [...ids].sort().join(',');
export function exactCombinationRate(value) {
  const input = String(value).trim();
  if (!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(input)) {
    throw new Error('Enter a nonnegative INR amount with at most two decimals. Blank is unconfigured, not zero.');
  }
  const [whole, fraction = ''] = input.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}
function member(m) {
  if (!m || !uuid(m.id) || typeof m.name !== 'string' || !m.name.trim()
    || typeof m.mix !== 'boolean' || !integer(m.version) || m.version < 1) malformed();
  return m;
}
function revision(r, categoryId, dosage) {
  if (!r || !uuid(r.id) || r.categoryId !== categoryId || r.dosage !== dosage
    || typeof r.categoryName !== 'string' || !Array.isArray(r.members) || !r.members.length || r.members.length > 3
    || !Array.isArray(r.memberIds) || r.memberIds.join(',') !== memberKey(r.memberIds)
    || new Set(r.memberIds).size !== r.memberIds.length || r.members.map(member).map((m) => m.id).join(',') !== r.memberIds.join(',')
    || !integer(r.version) || r.version < 1 || !validDate(r.effectiveFrom)
    || typeof r.totalMrp !== 'string' || exactCombinationRate(r.totalMrp) !== r.totalMrp
    || !uuid(r.actorId) || typeof r.recordedAt !== 'string' || Number.isNaN(Date.parse(r.recordedAt))) malformed();
  return r;
}
export async function combinationCategories(params, signal) {
  const page = await request('/categories', { params, signal });
  if (!Array.isArray(page?.items) || page.items.length > (params.limit || 50)
    || page.items.some((r) => !uuid(r.id) || typeof r.name !== 'string' || !r.name.trim()
      || !['active', 'inactive', 'deleted'].includes(r.status))
    || new Set(page.items.map((r) => r.id)).size !== page.items.length
    || (page.nextOffset !== null && page.nextOffset !== (params.offset || 0) + (params.limit || 50))) malformed();
  return page;
}
export async function combinationAllergens(id, params, signal) {
  const page = await request(`/allergens/${id}`, { params, signal });
  if (!Array.isArray(page?.items) || !integer(page.total) || page.offset !== params.offset || page.limit !== params.limit
    || page.items.length !== Math.min(params.limit, Math.max(0, page.total - params.offset))) malformed();
  page.items.forEach(member);
  if (new Set(page.items.map((m) => m.id)).size !== page.items.length) malformed();
  return page;
}
export async function generateCombinations(body, signal) {
  const page = await request('/generate', { body, signal });
  if (!page || page.categoryId !== body.categoryId || page.dosage !== body.dosage || page.size !== body.size
    || !token(page.eligibilityVersion) || !token(page.scopeVersion) || !integer(page.scopeTotal) || page.scopeTotal > 1000
    || !Array.isArray(page.scopeKeys) || page.scopeKeys.length !== page.scopeTotal
    || new Set(page.scopeKeys).size !== page.scopeKeys.length
    || !page.rowVersions || typeof page.rowVersions !== 'object' || Array.isArray(page.rowVersions)
    || Object.keys(page.rowVersions).length !== page.scopeTotal
    || page.scopeKeys.some((key) => !Object.hasOwn(page.rowVersions, key) || !integer(page.rowVersions[key]))
    || page.scopeKeys.some((key) => typeof key !== 'string' || key.split(',').length !== body.size
      || key.split(',').some((id) => !uuid(id)) || memberKey(key.split(',')) !== key
      || new Set(key.split(',')).size !== body.size
      || (body.allergenIds && key.split(',').some((id) => !body.allergenIds.includes(id))))
    || !integer(page.total) || page.total > page.scopeTotal || page.offset !== body.offset || page.limit !== body.limit
    || !Array.isArray(page.items) || page.items.length !== Math.min(body.limit, Math.max(0, page.total - body.offset))) malformed();
  page.items.forEach((row) => {
    if (!Array.isArray(row.members) || row.members.length !== body.size
      || row.members.map(member).map((m) => m.id).join(',') !== row.key
      || memberKey(row.members.map((m) => m.id)) !== row.key || !page.scopeKeys.includes(row.key)
      || new Set(row.members.map((m) => m.id)).size !== body.size
      || (body.size > 1 && row.members.some((m) => !m.mix))
      || (body.allergenIds && row.members.some((m) => !body.allergenIds.includes(m.id)))) malformed();
    if (row.latest ? revision(row.latest, body.categoryId, body.dosage).memberIds.join(',') !== row.key
      || row.latest.version !== page.rowVersions[row.key] : page.rowVersions[row.key] !== 0) malformed();
  });
  if (new Set(page.items.map((r) => r.key)).size !== page.items.length) malformed();
  return page;
}
export async function saveCombinationBatch(body, expectedKeys, expectedVersions, owner) {
  const result = await request('/save', { body });
  if (result?.requestId !== body.idempotencyKey || result.categoryId !== body.categoryId || result.dosage !== body.dosage
    || result.effectiveFrom !== body.effectiveFrom || result.eligibilityVersion !== body.eligibilityVersion
    || result.scopeVersion !== body.scopeVersion || !Array.isArray(result.saved) || result.saved.length !== expectedKeys.length) malformed();
  const edits = new Map(body.edits.map((e) => [memberKey(e.memberIds), e.totalMrp]));
  result.saved.forEach((row) => {
    revision(row, body.categoryId, body.dosage);
    const key = row.memberIds.join(',');
    if (row.memberIds.length !== body.size || (body.size > 1 && row.members.some((m) => !m.mix))
      || (body.allergenIds && row.memberIds.some((id) => !body.allergenIds.includes(id)))
      || !expectedKeys.includes(key)
      || row.version !== expectedVersions[key] + 1 || row.actorId !== owner
      || row.effectiveFrom !== body.effectiveFrom || row.totalMrp !== (edits.get(key) ?? body.copyRate)) malformed();
  });
  if (new Set(result.saved.map((r) => r.memberIds.join(','))).size !== result.saved.length) malformed();
  return result;
}
export async function combinationHistory(id, dosage, key, offset, signal) {
  const page = await request(`/history/${id}`, { params: { dosage, memberKey: key, offset, limit: 25 }, signal });
  if (!Array.isArray(page?.items) || page.items.length > 25 || (page.nextOffset !== null && page.nextOffset !== offset + 25)) malformed();
  page.items.forEach((r) => {
    revision(r, id, dosage);
    if (key && r.memberIds.join(',') !== key) malformed();
  });
  return page;
}
