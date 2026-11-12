import { purchaseOrderRequest } from '../auth/adminSession.js';
import { extractSettingsFailure } from '../auth/extractSettingsErrors.js';
import { DOSES, QTY } from './serverImmunotherapy.js';
import { EXTRACT_POLICY, EXTRACT_POSITIONS, expectedExtractSaveRows } from './extractSettingsContract.js';
export { EXTRACT_POLICY, EXTRACT_POSITIONS } from './extractSettingsContract.js';

const request = (path, options) => purchaseOrderRequest(path, options, 'immunotherapy-extract-settings');
export const extractCategories = async (params, signal) => {
  const value = await request('/categories', { params, signal });
  if (!Array.isArray(value?.items) || value.items.some((row) =>
    typeof row?.id !== 'string' || typeof row.name !== 'string' || !['active', 'inactive'].includes(row.status))
      || (value.nextOffset !== null && (!Number.isInteger(value.nextOffset) || value.nextOffset < 1))) {
    throw extractSettingsFailure({ reason: 'response' });
  }
  return value;
};
function checked(value, categoryId, dosage, mutation = false) {
  if (value?.categoryId !== categoryId || !Number.isInteger(value.version) || value.version < 0
      || value.policy !== EXTRACT_POLICY || value.dosage !== dosage || !DOSES.includes(dosage)
      || !Array.isArray(value.rows) || value.rows.length !== 6
      || value.rows.some((row, index) => !row || row.compositionSize !== EXTRACT_POSITIONS[index][0]
        || row.rank !== EXTRACT_POSITIONS[index][1] || !validPair(row))
      || (value.legacyRows !== null && (!Array.isArray(value.legacyRows) || value.legacyRows.length !== 3
        || value.legacyRows.some((row) => !validPair(row))))
      || (value.legacyRows === null ? value.legacyVersion !== null
        : !Number.isInteger(value.legacyVersion) || value.legacyVersion < 1)) {
    throw extractSettingsFailure({ mutation, reason: 'response' });
  }
  return value;
}
const validPair = (row) => row && ['extract', 'dilution'].every((f) =>
  row[f] === null || (typeof row[f] === 'string' && QTY.test(row[f])));
export const loadExtractSettings = async (id, dosage) => checked(await request(`/${id}`, { params: { dosage } }), id, dosage);
export const saveExtractSettings = async (id, body) => {
  const expectedRows = expectedExtractSaveRows(body.rows);
  const value = checked(await request(`/${id}`, { body }), id, body.dosage, true);
  if (!Number.isInteger(body.expected_version) || body.expected_version < 0 || body.expected_version > 2147483646
      || body.policy !== EXTRACT_POLICY || value.version !== body.expected_version + 1 || value.rows.some((row, index) =>
    ['compositionSize', 'rank', 'extract', 'dilution'].some((field) => row[field] !== expectedRows[index][field]))) {
    throw extractSettingsFailure({ mutation: true, reason: 'response' });
  }
  return value;
};
