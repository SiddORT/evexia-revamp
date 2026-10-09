// Pure Sales Target helpers. Amounts are exact decimal strings and BigInt cents; never floats.
export const QUARTERS = ['q1', 'q2', 'q3', 'q4'];
export const MAX_CENTS = 99999999999999n; // 999999999999.99
export const EMPTY_TARGET = { mrId: '', startYear: '', endYear: '', q1: '0', q2: '0', q3: '0', q4: '0', status: 'active' };

export function parseCents(text) {
  const value = String(text ?? '').trim();
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0');
  return cents > MAX_CENTS ? null : cents;
}
export function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const tail = digits.slice(-3);
  return `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}
export function formatCents(cents) {
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}₹${groupIndian(whole)}${frac ? `.${frac}` : ''}`;
}
// Exact server decimal string such as "1234.50" to display text.
export function formatAmount(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text ?? '').trim());
  if (!match) return '—';
  const frac = (match[3] || '').replace(/0+$/, '');
  return `${match[1]}₹${groupIndian(match[2].replace(/^0+(?=\d)/, ''))}${frac ? `.${frac}` : ''}`;
}
export function sumDraft(values) {
  let total = 0n;
  for (const key of QUARTERS) { const cents = parseCents(values[key]); if (cents === null) return null; total += cents; }
  return total;
}
export function currentFinancialStart(now = new Date()) {
  return now.getFullYear() - (now.getMonth() < 3 ? 1 : 0);
}
export function defaultTarget(now = new Date()) {
  const start = currentFinancialStart(now);
  return { ...EMPTY_TARGET, startYear: String(start), endYear: String(start + 1) };
}
export function targetDraftErrors(values) {
  const errors = {};
  if (!values.mrId) errors.mrId = 'Select an MR.';
  const start = /^\d{1,4}$/.test(String(values.startYear)) ? Number(values.startYear) : NaN;
  const end = /^\d{1,4}$/.test(String(values.endYear)) ? Number(values.endYear) : NaN;
  if (!(start >= 1 && start <= 9998)) errors.startYear = 'Select a financial start year (1 to 9998).';
  if (!(end >= 2 && end <= 9999)) errors.endYear = 'Select a financial end year.';
  else if (start >= 1 && end !== start + 1) errors.endYear = 'End year must be exactly start year + 1.';
  for (const key of QUARTERS) if (parseCents(values[key]) === null) errors[key] = 'Use a non-negative amount up to 999,999,999,999.99 with at most 2 decimals.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose a status.';
  return errors;
}
export function targetBody(values) {
  return { mrId: values.mrId, startYear: Number(values.startYear), endYear: Number(values.endYear),
    ...Object.fromEntries(QUARTERS.map((key) => [key, String(values[key]).trim()])), status: values.status };
}
export const SALES_TARGET_HEADERS = ['Employee Code', 'Start Year', 'End Year', 'Q1', 'Q2', 'Q3', 'Q4', 'Status'];
export const SALES_TARGET_FIELDS = ['employeeCode', 'startYear', 'endYear', 'q1', 'q2', 'q3', 'q4', 'status'];
