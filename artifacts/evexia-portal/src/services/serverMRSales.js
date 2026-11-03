import { mrSalesRequest } from '../auth/adminSession.js';

// Totals can exceed both per-order and per-quarter limits. Never use Number
// for currency, ratios or displayed percentages.
const MONEY = /^(0|[1-9]\d{0,29})\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^(IT|Kit|SPT|Lupin):${UUID}$`, 'i');
const validCount = (v) => Number.isSafeInteger(v) && v >= 0;
const fail = () => { throw new Error('The sales response could not be confirmed. Retry; no estimated achievement is shown.'); };
export const cents = (value) => BigInt(value.replace('.', ''));
const decimal = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
export const ratio = (amount, target) => target == null || cents(target) === 0n ? null
  : decimal((cents(amount) * 10000n + cents(target) / 2n) / cents(target));
export const salesMoney = (value) => {
  if (value == null) return 'Unavailable';
  const [whole, fraction] = value.split('.');
  const tail = whole.slice(-3), head = whole.slice(0, -3);
  return `₹${head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},` : ''}${tail}.${fraction}`;
};
export function fiscalBounds(year, period) {
  const y = String(year).padStart(4, '0'), next = String(year + 1).padStart(4, '0');
  return { all: [`${y}-04-01`, `${next}-03-31`], Q1: [`${y}-04-01`, `${y}-06-30`],
    Q2: [`${y}-07-01`, `${y}-09-30`], Q3: [`${y}-10-01`, `${y}-12-31`], Q4: [`${next}-01-01`, `${next}-03-31`] }[period];
}
export async function getMRSales({ year, period, offset, limit, mrId, signal }) {
  const page = await mrSalesRequest('', { params: { ...(year == null ? {} : { start_year: year }), period, offset, limit }, signal });
  if (!page || page.mrId !== mrId || (year != null && page.startYear !== year)
    || !Number.isInteger(page.startYear) || page.startYear < 1 || page.startYear > 9998
    || !Number.isInteger(page.currentYear) || page.period !== period
    || page.offset !== offset || page.limit !== limit || !validCount(page.total) || page.total > 20000
    || !Array.isArray(page.items) || page.items.length !== Math.min(limit, Math.max(0, page.total - offset))
    || !['active', 'missing', 'inactive', 'deleted'].includes(page.targetState)
    || (page.targetState === 'active' ? typeof page.target !== 'string' || !MONEY.test(page.target) : page.target !== null)
    || typeof page.knownSales !== 'string' || !MONEY.test(page.knownSales) || typeof page.complete !== 'boolean'
    || !validCount(page.unavailableOrders) || page.unavailableOrders > page.total
    || page.complete !== (page.unavailableOrders === 0)) fail();
  const dates = fiscalBounds(page.startYear, period);
  if (page.dateFrom !== dates[0] || page.dateTo !== dates[1]) fail();
  const expectedPercentage = page.complete ? ratio(page.knownSales, page.target) : null;
  const difference = page.target == null ? null : cents(page.target) - cents(page.knownSales);
  const expectedRemaining = page.complete && difference != null ? decimal(difference < 0n ? 0n : difference) : null;
  if (page.percentage !== expectedPercentage || page.remaining !== expectedRemaining) fail();
  const seen = new Set();
  for (const row of page.items) {
    if (!row || !KEY.test(row.key) || !row.key.startsWith(`${row.kind}:`) || seen.has(row.key)
      || typeof row.number !== 'string' || !row.number.trim()
      || !DAY.test(row.date) || row.date < dates[0] || row.date > dates[1]
      || !['In process', 'Shipped', 'Delivered'].includes(row.status)
      || !(row.amount === null || (typeof row.amount === 'string' && MONEY.test(row.amount)))
      || row.contribution !== (row.amount == null ? null : ratio(row.amount, page.target))) fail();
    seen.add(row.key);
  }
  return page;
}
export async function getMRSalesYears({ offset = 0, signal } = {}) {
  const page = await mrSalesRequest('/years', { params: { offset, limit: 50 }, signal });
  if (!page || page.offset !== offset || page.limit !== 50 || !validCount(page.total) || page.total > 9998
    || !Number.isInteger(page.currentYear) || !Array.isArray(page.items)
    || page.items.length !== Math.min(50, Math.max(0, page.total - offset))
    || page.items.some((y, i) => !Number.isInteger(y) || y < 1 || y > 9998 || (i > 0 && y >= page.items[i - 1]))) fail();
  return page;
}
