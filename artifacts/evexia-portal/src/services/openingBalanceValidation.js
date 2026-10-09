export function validateBalance(values) {
  const errors = {};
  if (!/^\d{4}$/.test(String(values.startYear)) || +values.startYear < 1900 || +values.startYear > 9998) errors.startYear = 'Choose a start year from 1900 to 9998.';
  if (!/^\d{4}$/.test(String(values.endYear)) || +values.endYear !== +values.startYear + 1) errors.endYear = 'End year must immediately follow the start year.';
  if (!values.doctorId) errors.doctorId = 'Choose an active shared Doctor.';
  const text = String(values.amount).trim();
  if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || text.replace(/^[+-]/, '').split('.')[0].replace(/^0+/, '').length > 13) errors.amount = 'Enter a signed amount within ±9999999999999.99, with at most two decimal places. No rounding.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose Active or Inactive.';
  return errors;
}

// No Number/Intl monetary conversion: long supported amounts exceed safe cents.
export function formatBalance(value) {
  const [integer, fraction = ''] = String(value).split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = integer.replace(/^[+-]/, '');
  const last = digits.slice(-3);
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${head ? head + ',' : ''}${last}.${fraction.padEnd(2, '0')}`;
}
