import { purchaseOrderRequest } from '../auth/adminSession.js';

export function validGSTDate(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function validGSTRate(value) {
  return typeof value === 'string' && !/\s/.test(value) && /^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/.test(value)
    && (value.split('.')[0] !== '100' || !/[1-9]/.test(value.split('.')[1] || ''));
}

function checked(data) {
  const valid = data && Number.isSafeInteger(data.version) && data.version >= 0
    && (data.configured === false ? data.version === 0 && data.cutoff_date === null
      && data.before_rate === null && data.on_after_rate === null
      : data.configured === true && data.version > 0 && validGSTDate(data.cutoff_date)
        && validGSTRate(data.before_rate) && validGSTRate(data.on_after_rate));
  if (!valid) {
    const error = new Error('The GST Settings response could not be confirmed. Your edits are preserved; load saved settings before saving again.');
    error.ambiguous = true;
    throw error;
  }
  return data;
}

export const loadGSTSettings = async () => checked(await purchaseOrderRequest('', {}, 'gst-settings'));
export const saveGSTSettings = async (body) => checked(await purchaseOrderRequest('', { body }, 'gst-settings'));
