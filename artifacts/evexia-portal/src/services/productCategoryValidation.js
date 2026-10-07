export const normalizeCategoryName = (value) => value.trim().replace(/\s+/gu, ' ');
export function validCategoryPrice(value) {
  return typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d{1,6})?$/.test(value.trim())
    && value.trim().split('.')[0].replace(/^0+/, '').length <= 12;
}
export function validateProductCategory(values) {
  const errors = {};
  const name = normalizeCategoryName(values.name);
  if (!name || [...name].length > 200) errors.name = 'Name is required and must be at most 200 characters.';
  if ([...values.description.trim()].length > 2000) errors.description = 'Description must be at most 2,000 characters.';
  if (!validCategoryPrice(values.unit_price)) errors.unit_price = 'Use a non-negative decimal with at most 12 integer and 6 fractional digits. Zero is accepted.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Select a status.';
  return errors;
}
