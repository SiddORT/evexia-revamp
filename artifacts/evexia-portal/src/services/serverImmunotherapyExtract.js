import { purchaseOrderRequest } from '../auth/adminSession.js';
import { QTY } from './serverImmunotherapy.js';

const request = (path, options) => purchaseOrderRequest(path, options, 'immunotherapy-extract-settings');
export const extractCategories = async (params, signal) => {
  const value = await request('/categories', { params, signal });
  if (!Array.isArray(value?.items) || value.items.some((row) =>
    typeof row?.id !== 'string' || typeof row.name !== 'string' || !['active', 'inactive'].includes(row.status))
      || (value.nextOffset !== null && (!Number.isInteger(value.nextOffset) || value.nextOffset < 1))) {
    throw new Error('The server did not return valid saved categories. Retry loading categories.');
  }
  return value;
};
function checked(value, categoryId) {
  if (value?.categoryId !== categoryId || !Number.isInteger(value.version) || value.version < 0
      || !Array.isArray(value.rows) || value.rows.length !== 3
      || value.rows.some((row) => !row || ['extract', 'dilution'].some((f) =>
        row[f] !== null && (typeof row[f] !== 'string' || !QTY.test(row[f]))))) {
    throw new Error('The server did not confirm valid Extract & Dilution settings. Your edits are preserved; load saved settings before trying again.');
  }
  return value;
}
export const loadExtractSettings = async (id) => checked(await request(`/${id}`), id);
export const saveExtractSettings = async (id, body) => checked(await request(`/${id}`, { body }), id);
