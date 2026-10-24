// Integer paise and rational half-up division; no floating-point financial math.
const MAX_AMOUNT = 99999999999n;
const MAX_TOTAL = 99999999999999999999n;
const KEYS = ['kit', 'lancets', 'applicators', 'tray'];
const halfUp = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
const text = (paise) => `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;
function decimal(value, maximum = MAX_AMOUNT) {
  if (typeof value !== 'string' || !/^\d{1,18}(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Use nonnegative plain decimal amounts with at most six fractional digits.');
  }
  const [whole, fraction = ''] = value.split('.');
  const numerator = BigInt(whole + fraction), denominator = 10n ** BigInt(fraction.length);
  const paise = halfUp(numerator * 100n, denominator);
  if (numerator * 100n > maximum * denominator || paise > maximum) throw new Error('Amount is out of range.');
  return { paise, numerator, denominator };
}
export const blankPricing = () => ({
  kitRate: '', lancetsRate: '', applicatorsRate: '', trayRate: '',
  forwardingCharges: '0.00', discountType: 'percent', discountValue: '0.00',
});
export const normalizeKitsAmount = (value) => text(decimal(value).paise);
export function pricingInput(pricing) {
  return Object.fromEntries([...KEYS.map((key) => `${key}Rate`), 'forwardingCharges', 'discountType', 'discountValue']
    .map((key) => [key, key.endsWith('Rate') && pricing[key] === '' ? null : pricing[key]]));
}
export function calculateKitsPricing(order, pricing, taxPercentage = '5.00') {
  const values = pricingInput(pricing), lineAmounts = {};
  let gross = decimal(values.forwardingCharges).paise;
  values.forwardingCharges = text(gross);
  for (const key of KEYS) {
    const raw = values[`${key}Rate`];
    const rate = raw == null ? null : decimal(raw).paise;
    values[`${key}Rate`] = rate == null ? null : text(rate);
    const count = key === 'kit' ? order.kit?.quantity : order[key];
    if (!count) continue;
    if (!/^\d{1,9}$/.test(count) || BigInt(count) <= 0n) throw new Error('Included quantities must be positive whole counts.');
    if (rate == null) throw new Error(`Enter the ${key} unit rate; zero is allowed.`);
    const line = BigInt(count) * rate;
    lineAmounts[key] = text(line); gross += line;
  }
  if (!['percent', 'inr'].includes(values.discountType)) throw new Error('Choose percent or fixed INR discount.');
  const discountInput = decimal(values.discountValue, values.discountType === 'percent' ? 10000n : MAX_AMOUNT);
  if (values.discountType === 'inr' && discountInput.numerator * 100n > gross * discountInput.denominator) {
    throw new Error('Fixed discount cannot exceed gross.');
  }
  const discount = values.discountType === 'percent' ? halfUp(gross * discountInput.paise, 10000n) : discountInput.paise;
  if (discount > gross) throw new Error('Discount cannot exceed gross.');
  values.discountValue = text(discountInput.paise);
  const taxable = gross - discount;
  const tax = decimal(taxPercentage, 10000n).paise;
  const gst = halfUp(taxable * tax, 10000n), total = taxable + gst;
  if (total > MAX_TOTAL) throw new Error('Total is out of range.');
  return { ...values, taxPercentage: text(tax), lineAmounts, gross: text(gross), discountAmount: text(discount),
    discounted: text(taxable), taxable: text(taxable), gst: text(gst), total: text(total) };
}
export function moneyText(value) {
  if (value == null || value === '') return 'Not entered';
  // Preserve all digits, including totals larger than Number's exact range.
  const formatted = text(decimal(value, MAX_TOTAL).paise);
  const [whole, fraction] = formatted.split('.');
  const grouped = whole.length > 3
    ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole;
  return `₹${grouped}.${fraction}`;
}
