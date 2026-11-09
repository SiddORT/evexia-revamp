import { purchaseOrderRequest } from '../auth/adminSession.js';
import { DOSES, QTY } from './serverImmunotherapy.js';

export const EXTRACT_POLICY = 'category_dosage_count_rank_v2';
export const EXTRACT_POSITIONS = [[1, 1], [2, 1], [2, 2], [3, 1], [3, 2], [3, 3]];

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
function checked(value, categoryId, dosage) {
  if (value?.categoryId !== categoryId || !Number.isInteger(value.version) || value.version < 0
      || value.policy !== EXTRACT_POLICY || value.dosage !== dosage || !DOSES.includes(dosage)
      || !Array.isArray(value.rows) || value.rows.length !== 6
      || value.rows.some((row, index) => !row || row.compositionSize !== EXTRACT_POSITIONS[index][0]
        || row.rank !== EXTRACT_POSITIONS[index][1] || !validPair(row))
      || (value.legacyRows !== null && (!Array.isArray(value.legacyRows) || value.legacyRows.length !== 3
        || value.legacyRows.some((row) => !validPair(row))))
      || (value.legacyRows === null ? value.legacyVersion !== null
        : !Number.isInteger(value.legacyVersion) || value.legacyVersion < 1)) {
    throw new Error('The server did not confirm valid Extract & Dilution settings. Your edits are preserved; load saved settings before trying again.');
  }
  return value;
}
const validPair = (row) => row && ['extract', 'dilution'].every((f) =>
  row[f] === null || (typeof row[f] === 'string' && QTY.test(row[f])));
export const loadExtractSettings = async (id, dosage) => checked(await request(`/${id}`, { params: { dosage } }), id, dosage);
export const saveExtractSettings = async (id, body) => {
  const value = checked(await request(`/${id}`, { body }), id, body.dosage);
  if (value.version !== body.expected_version + 1 || value.rows.some((row, index) =>
    ['extract', 'dilution'].some((field) => row[field] !== body.rows[index][field]))) {
    throw new Error('The server did not confirm these saved values. Your edits are preserved; reload saved settings before trying again.');
  }
  return value;
};
