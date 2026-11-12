/** Exact decimal half-up. No binary floating-point quantity calculations.
 * Drafts stay as entered; call normalizeQuantity at explicit review/write boundaries.
 * Historical evidence must be authenticated before using a display projection.
 */
const SOURCE = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$/;
export function normalizeQuantity(value, { positive = false, whole = false, maximum = '1000000' } = {}) {
  if (typeof value !== 'string' || value.length > 14 || value.trim() !== value || !SOURCE.test(value)) {
    throw new Error('Use a plain quantity with up to six source fractional digits.');
  }
  const [integer, fraction = ''] = value.split('.');
  const raw = BigInt(integer) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  const [maxInteger, maxFraction = ''] = maximum.split('.');
  const max = BigInt(maxInteger) * 1000000n + BigInt(maxFraction.padEnd(6, '0'));
  if (raw > max) throw new Error(`Quantity cannot exceed ${maximum}.`);
  if (whole && raw % 1000000n !== 0n) throw new Error('This quantity must be a whole number before rounding.');
  const cents = (raw + 5000n) / 10000n;
  if (cents * 10000n > max) throw new Error('Rounded quantity exceeds its supported maximum.');
  if ((raw > 0n || positive) && cents === 0n) throw new Error('A positive quantity must round to at least 0.01.');
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function quantityHundredths(value, options) {
  return BigInt(normalizeQuantity(value, options).replace('.', ''));
}

export function renderHundredths(value) {
  const n = BigInt(value), magnitude = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}

/** Signed, bounded historical presentation; not an operational write. */
export function displayQuantity(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  if (text.trim() !== text) throw new Error('Quantity is unavailable.');
  const match = /^(-?)([0-9]{1,18})(?:\.([0-9]{1,12}))?$/.exec(text);
  if (!match) throw new Error('Quantity is unavailable.');
  const fraction = match[3] || '';
  let cents = BigInt(match[2]) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  if ((fraction[2] || '0') >= '5') cents += 1n;
  return renderHundredths(match[1] ? -cents : cents);
}
