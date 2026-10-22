import { catalogueRate } from './rates.js';
import { masterNameError, normalizeMasterName } from './masterValidation.js';
export const normalizeCategoryName = normalizeMasterName;
export function validCategoryPrice(value) {
  try { catalogueRate(value); return true; } catch { return false; }
}
export function validateProductCategory(values) {
  const errors = {};
  const name = normalizeCategoryName(values.name);
  const nameError = masterNameError(name, 'product category name');
  if (nameError) errors.name = nameError;
  if ([...values.description.trim()].length > 2000) errors.description = 'Description must be at most 2,000 characters.';
  if (!validCategoryPrice(values.unit_price)) errors.unit_price = 'Use up to 12 integer and 6 source decimal digits. Half-up rounded to two places; rounded maximum 999999999999.99.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Select a status.';
  return errors;
}
