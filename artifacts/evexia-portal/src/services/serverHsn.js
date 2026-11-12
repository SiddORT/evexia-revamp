import { allergenRequest, hsnRequest } from '../auth/adminSession.js';
import { catalogueRate, compareRate } from './rates.js';

export const HSN_CODE_RE = /^[0-9]{1,16}$/;
export const listHsn = (params, signal) => hsnRequest('', { params, signal });
export const createHsn = (values) => hsnRequest('', { body: hsnPayload(values) });
export const editHsn = (record, values) => hsnRequest(`/${record.id}/edit`, { body: { ...hsnPayload(values), expected_version: record.version } });
export const statusHsn = (record, status) => hsnRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const lookupAllergenHsn = (params, signal) => allergenRequest('/hsn-lookup', { params, signal });

// Normalized GST as the catalogue would save it, or null when invalid.
export function normalGst(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/.test(text)) return null;
  if (compareRate(text, '100') > 0) return null;
  try { return catalogueRate(text, true); } catch { return null; }
}
export function validateHsn(v) {
  const e = {};
  const code = v.code.trim();
  if (!code) e.code = 'HSN code is required.';
  else if (!HSN_CODE_RE.test(code)) e.code = 'Use 1 to 16 digits only. Leading zeros are kept.';
  if (!v.gst.trim()) e.gst = 'GST is required.';
  else if (normalGst(v.gst) === null) e.gst = 'GST must be between 0 and 100 with up to 6 decimals.';
  if (!['active', 'inactive'].includes(v.status)) e.status = 'Select a status.';
  return e;
}
export const hsnPayload = (v) => ({ code: v.code.trim(), gst: normalGst(v.gst), status: v.status });

// Exact indexed lookup, never a truncated substring suggestion page.
export async function findHsnMappings({ code, gst }, signal) {
  const value = code ? code.trim() : normalGst(gst);
  if (!value) return [];
  const page = await lookupAllergenHsn({ [code ? 'code' : 'gst']: value, limit: 2, offset: 0 }, signal);
  if (!Array.isArray(page.items) || page.filtered !== page.items.length || page.items.length > 1
      || page.items.some((item) => item.status !== 'active'
        || (code ? item.code !== value : normalGst(item.gst) !== value))) {
    throw new Error('HSN lookup returned inconsistent results. Refresh mappings before saving.');
  }
  return page.items;
}
