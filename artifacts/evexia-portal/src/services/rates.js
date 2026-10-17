// Decimal-string arithmetic only. Number is used solely for legacy finite checks.
function parts(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 10000 || !Number.isFinite(Number(text))) throw new Error('Enter a finite nonnegative decimal.');
  const match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error('Enter a nonnegative decimal.');
  const integer = match[1] || '';
  const fraction = match[2] || match[3] || '';
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) throw new Error('Decimal exponent is too large.');
  const digits = integer + fraction;
  const point = integer.length + exponent;
  const whole = (point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0')).replace(/^0+(?=\d)/, '');
  const frac = point < 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  return [whole || '0', frac];
}

export function compareRate(a, b) {
  const [ai, af] = parts(a); const [bi, bf] = parts(b);
  if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1;
  const size = Math.max(af.length, bf.length);
  const x = ai + af.padEnd(size, '0'); const y = bi + bf.padEnd(size, '0');
  return x < y ? -1 : x > y ? 1 : 0;
}

export function roundRate(value, { optional = false, max = null, originalMax = null } = {}) {
  if (optional && (value == null || value === '')) return '';
  const [whole, fraction] = parts(value);
  if (originalMax != null && compareRate(value, originalMax) > 0) throw new Error(`Rate must not exceed ${originalMax}.`);
  let cents = BigInt(whole + fraction.padEnd(2, '0').slice(0, 2));
  if ((fraction[2] || '0') >= '5') cents += 1n;
  const result = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  if (!Number.isFinite(Number(result)) || (max != null && compareRate(result, max) > 0)) throw new Error('Rounded rate exceeds the supported maximum.');
  return result;
}

export function formatRate(value) {
  if (value == null || value === '') return '—';
  return roundRate(value);
}

// Shared catalogue still accepts its bounded historical *source* notation.
export function catalogueRate(value, percentage = false) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d+(?:\.\d{1,6})?$/.test(value.trim())
    || value.trim().split('.')[0].replace(/^0+/, '').length > 12) throw new Error('Use a plain decimal with up to 12 integer and 6 source fractional digits.');
  return roundRate(value, percentage ? { originalMax: '100', max: '100' } : { max: '999999999999.99' });
}

export function discountRate(value) {
  if (typeof value !== 'string' || !/^\d{1,13}(?:\.\d{1,6})?$/.test(value.trim())) throw new Error('Use up to thirteen integer and six source fractional digits.');
  return roundRate(value, { originalMax: '100', max: '100' });
}
