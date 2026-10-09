import { allergenRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

export const DECIMAL_RE = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
export const listAllergens = (params, signal) => allergenRequest('', { params, signal });
export const createAllergen = (body) => allergenRequest('', { body });
export const getAllergen = (id) => allergenRequest(`/${id}`);
export const editAllergen = (record, values) => allergenRequest(`/${record.id}/edit`, { body: { ...values, expected_version: record.version } });
export const statusAllergen = (record, status) => allergenRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const deleteAllergen = (record) => allergenRequest(`/${record.id}/delete`, { body: { expected_version: record.version } });
export const listAllergenReferences = (kind, params, signal) => {
  if (!['categories', 'locations'].includes(kind)) throw new Error('Unsupported reference kind.');
  return allergenRequest(`/references/${kind}`, { params: { limit: 25, offset: 0, include_unusable: false, ...params }, signal });
};
export const reviewAllergens = (file) => allergenRequest('/import/review', { file, params: { filename: file.name } });
export const importAllergens = (file, digest) => allergenRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const exportAllergens = (params, format, signal) => allergenRequest('/export', { params: { ...params, format }, download: true, signal });
export const sampleAllergens = (format, signal) => allergenRequest('/sample', { params: { format }, download: true, signal });
export const downloadAllergenFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-allergen-${sample ? 'template' : 'master'}.${format}`);

// Exact decimal compare of plain strings, no Number rounding.
export function compareDecimal(a, b) {
  const [ai, af = ''] = a.split('.'); const [bi, bf = ''] = b.split('.');
  const x = ai.padStart(12, '0') + af.padEnd(6, '0'); const y = bi.padStart(12, '0') + bf.padEnd(6, '0');
  return x < y ? -1 : x > y ? 1 : 0;
}
export function validatePriceBounds(min, max) {
  const errors = {};
  if (min && !DECIMAL_RE.test(min)) errors.min = 'Minimum price must be a plain decimal (up to 12 integer and 6 fractional digits).';
  if (max && !DECIMAL_RE.test(max)) errors.max = 'Maximum price must be a plain decimal (up to 12 integer and 6 fractional digits).';
  if (!errors.min && !errors.max && min && max && compareDecimal(min, max) > 0) errors.max = 'Maximum price must not be below minimum price.';
  return errors;
}
export function validateAllergen(v) {
  const e = {};
  const name = v.name.trim().replace(/\s+/g, ' ');
  if (!name) e.name = 'Product name is required.'; else if (name.length > 200) e.name = 'Product name must be 200 characters or fewer.';
  if (!v.category_id) e.category_id = 'Select a product category.';
  if (!v.storage_location_id) e.storage_location_id = 'Select a storage location.';
  const price = v.selling_price.trim();
  if (price && !DECIMAL_RE.test(price)) e.selling_price = 'Enter a plain nonnegative decimal (12 integer, 6 fractional digits max).';
  const gst = v.gst.trim();
  if (!gst) e.gst = 'GST is required.'; else if (!/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/.test(gst) || compareDecimal(gst, '100') > 0) e.gst = 'GST must be between 0 and 100 with up to 6 decimals.';
  const conc = v.concentration.trim();
  if (!conc) e.concentration = 'Concentration is required.'; else if (conc.length > 200) e.concentration = 'Concentration must be 200 characters or fewer.';
  const th = v.threshold_limit.trim();
  if (th && !DECIMAL_RE.test(th)) e.threshold_limit = 'Enter a plain nonnegative decimal (12 integer, 6 fractional digits max).';
  if (!['active', 'inactive'].includes(v.status)) e.status = 'Select a status.';
  return e;
}
export const allergenPayload = (v) => ({ name: v.name.trim().replace(/\s+/g, ' '), category_id: v.category_id, storage_location_id: v.storage_location_id, selling_price: v.selling_price.trim() || null, gst: v.gst.trim(), concentration: v.concentration.trim(), threshold_limit: v.threshold_limit.trim() || null, status: v.status, mix: v.mix === true });
