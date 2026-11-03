import { purchaseOrderRequest } from '../auth/adminSession.js';
import { catalogueRate } from './rates.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['active', 'inactive', 'deleted'];
const req = (path, options) => purchaseOrderRequest(path, options, 'pricing-rules');

export class MalformedResponseError extends Error {
  constructor(what) { super(`The server response for ${what} was not in the expected format.`); this.malformed = true; }
}

const isUuid = (v) => typeof v === 'string' && UUID.test(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const MAX_RATE_LENGTH = 16; // 12 integer digits + '.' + 2 decimals
export const MAX_ALLERGENS = 100;
const isRate = (v) => {
  if (typeof v !== 'string' || v.length > MAX_RATE_LENGTH || !/^\d{1,12}\.\d{2}$/.test(v)) return false;
  try { return catalogueRate(v) === v; } catch { return false; }
};
export const validDate = (v) => {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function ref(item, what, needCategory = false) {
  if (!item || !isUuid(item.id) || !isText(item.name) || !STATUSES.includes(item.status)
    || (needCategory && !isUuid(item.categoryId))) throw new MalformedResponseError(what);
  if (needCategory && item.savedCategoryId != null && !isUuid(item.savedCategoryId)) throw new MalformedResponseError(what);
  return needCategory ? { id: item.id, name: item.name, status: item.status, categoryId: item.categoryId, savedCategoryId: item.savedCategoryId || null }
    : { id: item.id, name: item.name, status: item.status };
}

export function parseRule(raw, what = 'pricing rule') {
  if (!raw || typeof raw !== 'object' || !isUuid(raw.id) || !Number.isSafeInteger(raw.version) || raw.version < 1
    || !Array.isArray(raw.allergens) || raw.allergens.length < 1 || raw.allergens.length > MAX_ALLERGENS
    || !validDate(raw.cutoff) || !isRate(raw.beforeRate) || !isRate(raw.afterRate)) {
    throw new MalformedResponseError(what);
  }
  const category = ref(raw.category, what);
  if (!Array.isArray(raw.categories) || !raw.categories.length || raw.categories.length > 100) throw new MalformedResponseError(what);
  const categories = raw.categories.map((c) => ref(c, what));
  if (new Set(categories.map((c) => c.id)).size !== categories.length || !categories.some((c) => c.id === category.id)) throw new MalformedResponseError(what);
  // Master edits may move an allergen to another category after save; keep its
  // actual categoryId so the UI can flag the mismatch instead of failing the list.
  const allergens = raw.allergens.map((a) => ref(a, what, true));
  if (new Set(allergens.map((a) => a.id)).size !== allergens.length || allergens.some((a) => !categories.some((c) => c.id === a.savedCategoryId))) throw new MalformedResponseError(what);
  return { id: raw.id, version: raw.version, category, categories, allergens, cutoff: raw.cutoff, beforeRate: raw.beforeRate, afterRate: raw.afterRate };
}

function parsePage(raw, parseItem, what, requested) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || !Number.isSafeInteger(raw.total) || raw.total < 0
    || !Number.isSafeInteger(raw.offset) || raw.offset < 0 || !Number.isSafeInteger(raw.limit) || raw.limit < 1 || raw.limit > 100
    || raw.items.length !== Math.min(raw.limit, Math.max(0, raw.total - raw.offset))
    || (requested && (raw.offset !== requested.offset || raw.limit !== requested.limit))) throw new MalformedResponseError(what);
  const items = raw.items.map(parseItem);
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new MalformedResponseError(what);
  return { items, total: raw.total, offset: raw.offset, limit: raw.limit };
}

const bound = (n, fallback, max) => Math.min(max, Math.max(0, Number.isSafeInteger(n) ? n : fallback));

export async function listPricingRules({ offset = 0, limit = 25, query = '' } = {}, signal) {
  const params = { query: String(query).slice(0, 100), offset: bound(offset, 0, 1000000), limit: Math.max(1, bound(limit, 25, 100)) };
  const raw = await req('', { params, signal });
  return parsePage(raw, (r) => parseRule(r, 'pricing rule list'), 'pricing rule list', params);
}

export async function getPricingRule(id, signal) {
  if (!isUuid(id)) throw new Error('Invalid pricing rule reference.');
  const rule = parseRule(await req(`/${id}`, { signal }));
  if (rule.id !== id) throw new MalformedResponseError('pricing rule');
  return rule;
}

export async function fetchRuleCategories(query, offset, signal) {
  const params = { query: String(query || '').slice(0, 100), offset: offset || 0, limit: 25 };
  const raw = await req('/references/categories', { params, signal });
  const page = parsePage(raw, (c) => ref(c, 'category choices'), 'category choices', params);
  if (page.items.some((c) => c.status !== 'active')) throw new MalformedResponseError('category choices');
  if (!/^[a-f0-9]{32}$/.test(raw.catalogueVersion || '')) throw new MalformedResponseError('category choices');
  return { ...page, items: page.items, catalogueVersion: raw.catalogueVersion };
}

export async function fetchRuleAllergens(categoryIds, query, offset, signal) {
  if (!Array.isArray(categoryIds) || !categoryIds.length || categoryIds.length > 100 || categoryIds.some((id) => !isUuid(id))) throw new Error('Choose active categories first.');
  const params = { categoryIds: [...categoryIds].sort(), query: String(query || '').slice(0, 100), offset: offset || 0, limit: 25 };
  const raw = await req('/references/allergens', { params, signal });
  const page = parsePage(raw, (a) => ref(a, 'allergen choices', true), 'allergen choices', params);
  if (page.items.some((a) => !categoryIds.includes(a.categoryId) || a.status !== 'active') || !/^[a-f0-9]{32}$/.test(raw.catalogueVersion || '')) throw new MalformedResponseError('allergen choices');
  return { ...page, catalogueVersion: raw.catalogueVersion };
}

/** submission: { ruleId|null, body } — body sent exactly as frozen by caller.
 * The returned rule must be exactly what was submitted. An idempotent replay
 * returns the originally saved version, which still matches these checks. */
export async function savePricingRule(submission) {
  const { ruleId, body } = submission;
  const path = ruleId ? `/${ruleId}/edit` : '';
  const rule = parseRule(await req(path, { body }), 'saved pricing rule');
  const sent = [...body.allergenIds].sort().join(',');
  const got = rule.allergens.map((a) => a.id).sort().join(',');
  const expectedVersion = ruleId ? body.expected_version + 1 : 1;
  const sentCategories = [...(body.categoryIds || [body.categoryId])].sort().join(',');
  if ((ruleId && rule.id !== ruleId) || rule.version !== expectedVersion || rule.categories.map((c) => c.id).sort().join(',') !== sentCategories
    || sent !== got || (body.allergenCategoryIds && rule.allergens.some((a) => body.allergenCategoryIds[a.id] !== a.savedCategoryId))
    || rule.cutoff !== body.cutoff || rule.beforeRate !== body.beforeRate || rule.afterRate !== body.afterRate) {
    throw new MalformedResponseError('saved pricing rule');
  }
  return rule;
}
