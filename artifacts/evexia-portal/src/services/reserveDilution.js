// Draft-only exact calculations. The protected server review remains authoritative.
import { normalizeQuantity, displayQuantity } from './quantities.js';
const scaled = (v, digits) => {
  const [a, b = ''] = v.split('.');
  return BigInt(a + b.padEnd(digits, '0'));
};
const render = (n, digits) => {
  const s = n.toString().padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`.replace(/\.?0+$/, '');
};
export function reserveConfiguration(lot, { quantity = '', dilute, factor }) {
  const errors = {};
  let q;
  try { q = normalizeQuantity(String(quantity).trim(), { positive: true }); }
  catch { q = ''; }
  let input;
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(q) || (input = scaled(q, 3)) <= 0n)
    errors.quantity = 'Enter a positive source quantity; up to six source decimals round half-up to two places.';
  else if (input > 1000000000n) errors.quantity = 'Quantity cannot exceed 1000000 ml.';
  else if (input > scaled(String(lot.available), 3)) errors.quantity = `Quantity exceeds available ${lot.available}.`;
  if (dilute !== true && dilute !== false) errors.dilute = 'Choose Yes or No for dilution.';
  let output = null;
  if (dilute === false && !errors.quantity) output = { quantity: q, concentration: lot.concentration };
  if (dilute === true) {
    const c = String(lot.concentration || '');
    if (![2, 5, 10].includes(Number(factor))) errors.dilute = 'Choose a 2-fold, 5-fold or 10-fold dilution.';
    else if (lot.unit && lot.unit !== 'ml') errors.dilute = `Dilution requires ml; this reserve uses "${lot.unit}". Choose No to transfer unchanged.`;
    else if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?%?$/.test(c))
      errors.dilute = `Concentration "${c || 'unavailable'}" is not a supported positive numeric concentration. Use up to three integer digits and six decimals, optionally %. Choose No to transfer unchanged.`;
    else {
      const percent = c.endsWith('%');
      const value = scaled(percent ? c.slice(0, -1) : c, 6);
      const f = BigInt(factor);
      if (value <= 0n || (percent && value > 100000000n)) errors.dilute = 'Concentration must be above zero; explicit percentages cannot exceed 100%.';
      else if (value % f) errors.dilute = 'Resulting concentration needs more than six decimals. Choose another approved factor or No.';
      else if (!errors.quantity) {
        if (input * f > 1000000000n) errors.quantity = 'Diluted output cannot exceed 1000000 ml. Reduce the source quantity.';
        else output = { quantity: displayQuantity(render(input * f, 3)), concentration: render(value / f, 6) + (percent ? '%' : '') };
      }
    }
  }
  return { errors, output };
}
