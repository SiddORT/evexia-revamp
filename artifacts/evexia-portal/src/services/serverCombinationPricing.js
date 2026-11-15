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
const scopeKey = (body, categoryId, ids) => body.categoryScope === 'all'
  ? `${categoryId}:${memberKey(ids)}` : memberKey(ids);
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
  const all = body.categoryScope === 'all';
  if (!page || page.categoryId !== body.categoryId || page.categoryScope !== (body.categoryScope || 'single')
    || page.dosage !== body.dosage || page.size !== body.size
    || !token(page.eligibilityVersion) || !token(page.scopeVersion) || !integer(page.scopeTotal) || page.scopeTotal > 1000
    || !Array.isArray(page.scopeKeys) || page.scopeKeys.length !== page.scopeTotal
    || new Set(page.scopeKeys).size !== page.scopeKeys.length
    || !page.rowVersions || typeof page.rowVersions !== 'object' || Array.isArray(page.rowVersions)
    || Object.keys(page.rowVersions).length !== page.scopeTotal
    || page.scopeKeys.some((key) => !Object.hasOwn(page.rowVersions, key) || !integer(page.rowVersions[key]))
    || !Array.isArray(page.categories) || page.categories.length > 500
    || page.categories.some((c) => !c || !uuid(c.categoryId) || typeof c.categoryName !== 'string' || !c.categoryName.trim()
      || !integer(c.eligibleMembers) || c.eligibleMembers > 500 || !integer(c.ruleCount)
      || c.skipped !== (c.ruleCount === 0)
      || c.ruleCount !== (c.eligibleMembers < body.size ? 0 : body.size === 1 ? c.eligibleMembers
        : body.size === 2 ? c.eligibleMembers * (c.eligibleMembers - 1) / 2
          : c.eligibleMembers * (c.eligibleMembers - 1) * (c.eligibleMembers - 2) / 6))
    || new Set(page.categories.map((c) => c.categoryId)).size !== page.categories.length
    || page.categories.reduce((sum, c) => sum + c.ruleCount, 0) !== page.scopeTotal
    || (all ? page.categories.reduce((sum, c) => sum + c.eligibleMembers, 0) > 500
      : page.categories.length !== 1 || page.categories[0].categoryId !== body.categoryId)
    || page.scopeKeys.some((key) => {
      if (typeof key !== 'string') return true;
      const parts = key.split(':');
      const ids = parts.at(-1).split(',');
      return parts.length !== (all ? 2 : 1) || (all && !page.categories.some((c) => c.categoryId === parts[0]))
        || ids.length !== body.size || ids.some((id) => !uuid(id)) || memberKey(ids) !== parts.at(-1)
        || new Set(ids).size !== body.size || (body.allergenIds && ids.some((id) => !body.allergenIds.includes(id)));
    })
    || !integer(page.total) || page.total > page.scopeTotal || page.offset !== body.offset || page.limit !== body.limit
    || !Array.isArray(page.items) || page.items.length !== Math.min(body.limit, Math.max(0, page.total - body.offset))) malformed();
  page.items.forEach((row) => {
    if (!row) malformed();
    const category = page.categories.find((c) => c.categoryId === row.categoryId);
    if (!category || row.categoryName !== category.categoryName
      || !Array.isArray(row.members) || row.members.length !== body.size
      || scopeKey(body, row.categoryId, row.members.map(member).map((m) => m.id)) !== row.key
      || row.members.map((m) => m.id).join(',') !== memberKey(row.members.map((m) => m.id))
      || !page.scopeKeys.includes(row.key)
      || new Set(row.members.map((m) => m.id)).size !== body.size
      || (body.size > 1 && row.members.some((m) => !m.mix))
      || (body.allergenIds && row.members.some((m) => !body.allergenIds.includes(m.id)))) malformed();
    if (row.latest ? scopeKey(body, row.categoryId, revision(row.latest, row.categoryId, body.dosage).memberIds) !== row.key
      || row.latest.version !== page.rowVersions[row.key] : page.rowVersions[row.key] !== 0) malformed();
  });
  if (all && page.categories.some((c) => page.scopeKeys.filter((key) => key.startsWith(`${c.categoryId}:`)).length !== c.ruleCount)) malformed();
  if (new Set(page.items.map((r) => r.key)).size !== page.items.length) malformed();
  return page;
}
export async function saveCombinationBatch(body, expectedKeys, expectedVersions, owner) {
  const result = await request('/save', { body });
  if (result?.requestId !== body.idempotencyKey || result.categoryId !== body.categoryId || result.dosage !== body.dosage
    || (result.categoryScope || 'single') !== (body.categoryScope || 'single')
    || result.effectiveFrom !== body.effectiveFrom || result.eligibilityVersion !== body.eligibilityVersion
    || result.scopeVersion !== body.scopeVersion || !Array.isArray(result.saved) || result.saved.length !== expectedKeys.length) malformed();
  const edits = new Map(body.edits.map((e) => [memberKey(e.memberIds), e.totalMrp]));
  result.saved.forEach((row) => {
    revision(row, body.categoryScope === 'all' ? row.categoryId : body.categoryId, body.dosage);
    if (!uuid(row.categoryId)) malformed();
    const key = scopeKey(body, row.categoryId, row.memberIds);
    if (row.memberIds.length !== body.size || (body.size > 1 && row.members.some((m) => !m.mix))
      || (body.allergenIds && row.memberIds.some((id) => !body.allergenIds.includes(id)))
      || !expectedKeys.includes(key)
      || row.version !== expectedVersions[key] + 1 || row.actorId !== owner
      || row.effectiveFrom !== body.effectiveFrom || row.totalMrp !== (edits.get(key) ?? body.copyRate)) malformed();
  });
  if (new Set(result.saved.map((r) => scopeKey(body, r.categoryId, r.memberIds))).size !== result.saved.length) malformed();
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

function savedRule(value) {
  const r = value?.latest;
  if (!r || !uuid(r.categoryId) || !DOSAGES.includes(r.dosage)
    || !['active', 'inactive'].includes(value.status) || !integer(value.statusVersion) || value.statusVersion < 1) malformed();
  revision(r, r.categoryId, r.dosage);
  return value;
}
export async function listSavedCombinationRules(params, signal) {
  const page = await request('/rules', { params, signal });
  if (!Array.isArray(page?.items) || !integer(page.total) || !integer(page.filtered)
    || page.filtered > page.total || page.offset !== params.offset || page.limit !== params.limit
    || page.items.length !== Math.min(params.limit, Math.max(0, page.filtered - params.offset))) malformed();
  page.items.forEach((value) => {
    savedRule(value);
    if (params.status !== 'all' && value.status !== params.status) malformed();
  });
  const keys = page.items.map((v) => JSON.stringify([v.latest.categoryId, v.latest.dosage, v.latest.memberIds]));
  if (new Set(keys).size !== keys.length) malformed();
  return page;
}
export async function getSavedCombinationRule(id, signal) {
  return savedRule(await request(`/rules/${id}`, { signal }));
}
function statusEvent(e) {
  if (!e || !uuid(e.id) || !uuid(e.actorId) || !uuid(e.revisionId)
    || !['active', 'inactive'].includes(e.status) || !integer(e.version) || e.version < 1
    || typeof e.recordedAt !== 'string' || Number.isNaN(Date.parse(e.recordedAt))) malformed();
  return e;
}
export async function changeCombinationRuleStatus(record, body, owner) {
  const result = await request(`/rules/${record.latest.id}/status`, { body });
  savedRule(result?.rule); statusEvent(result?.event);
  const r = result.rule;
  if (result.requestId !== body.idempotencyKey || r.latest.id !== record.latest.id
    || r.latest.categoryId !== record.latest.categoryId || r.latest.dosage !== record.latest.dosage
    || r.latest.memberIds.join(',') !== record.latest.memberIds.join(',')
    || r.latest.totalMrp !== record.latest.totalMrp || r.latest.version !== record.latest.version
    || r.status !== body.status || r.statusVersion !== body.expectedVersion + 1
    || result.event.version !== r.statusVersion || result.event.status !== r.status
    || result.event.actorId !== owner || result.event.revisionId !== r.latest.id) malformed();
  return result;
}
export async function combinationStatusHistory(id, offset, signal) {
  const page = await request(`/rules/${id}/status-history`, { params: { offset, limit: 25 }, signal });
  if (!Array.isArray(page?.items) || page.items.length > 25
    || (page.nextOffset !== null && page.nextOffset !== offset + 25)) malformed();
  page.items.forEach(statusEvent);
  if (new Set(page.items.map((e) => e.id)).size !== page.items.length) malformed();
  return page;
}
