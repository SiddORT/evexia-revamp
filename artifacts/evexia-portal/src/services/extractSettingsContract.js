import { normalizeQuantity } from './quantities.js';

export const EXTRACT_POLICY = 'category_dosage_count_rank_v2';
export const EXTRACT_POSITIONS = [[1, 1], [2, 1], [2, 2], [3, 1], [3, 2], [3, 3]];

// Expected write result only: never rewrite an editor draft or normalize a reply.
// Match Volume's source grammar before stripping compatible leading zeroes.
function expectedQuantity(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[0-9]{1,6}(?:\.[0-9]{1,6})?$/.test(value)) {
    throw new Error('Use ml strings with up to six whole digits and six source decimals, or null for not recorded.');
  }
  const [integer, fraction] = value.split('.');
  return normalizeQuantity((integer.replace(/^0+/, '') || '0') + (fraction === undefined ? '' : `.${fraction}`),
    { maximum: '999999.999999' });
}

export function expectedExtractSaveRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EXTRACT_POSITIONS.length) {
    throw new Error('Supply six ordered Single/Double/Triple pairs.');
  }
  return EXTRACT_POSITIONS.map(([compositionSize, rank], index) => {
    const row = rows[index];
    if (!row || row.compositionSize !== compositionSize || row.rank !== rank) {
      throw new Error('Supply six ordered Single/Double/Triple pairs.');
    }
    return { compositionSize, rank, extract: expectedQuantity(row.extract), dilution: expectedQuantity(row.dilution) };
  });
}
