import { mrSalesRequest } from '../auth/adminSession.js';
import { cents, fiscalBounds, ratio } from './serverMRSales.js';

const KINDS = ['IT', 'Kit', 'SPT', 'Lupin'];
const STATUSES = ['Pending', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned'];
const MONEY = /^(0|[1-9]\d{0,29})\.\d{2}$/;
const KEY = /^(IT|Kit|SPT|Lupin):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const money = (v) => typeof v === 'string' && MONEY.test(v);
const fail = () => { throw new Error('The dashboard response could not be confirmed. Retry; no estimated figures are shown.'); };
const decimal = (v) => `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
const countRatio = (a, b) => b === 0 ? '0.00' : ratio(`${a}.00`, `${b}.00`);

function validateCard(card, label) {
  if (!card || card.label !== label || !count(card.total)
    || !Array.isArray(card.byType) || card.byType.length !== 4) fail();
  let total = 0n;
  card.byType.forEach((row, i) => {
    if (!row || row.kind !== KINDS[i] || !count(row.count)
      || row.percentage !== countRatio(row.count, card.total)) fail();
    total += BigInt(row.count);
  });
  if (total !== BigInt(card.total)) fail();
}

function validateAchievement(row, year, period) {
  const dates = fiscalBounds(year, period);
  if (!row || row.period !== period || row.dateFrom !== dates[0] || row.dateTo !== dates[1]
    || !['active', 'missing', 'inactive', 'deleted'].includes(row.targetState)
    || (row.targetState === 'active' ? !money(row.target) : row.target !== null)
    || !money(row.knownSales) || !count(row.total) || row.total > 20000
    || !count(row.unavailableOrders) || row.unavailableOrders > row.total
    || typeof row.complete !== 'boolean' || row.complete !== (row.unavailableOrders === 0)) fail();
  const difference = row.target == null ? null : cents(row.target) - cents(row.knownSales);
  const remaining = row.complete && difference != null ? decimal(difference < 0n ? 0n : difference) : null;
  if (row.remaining !== remaining
    || row.percentage !== (row.complete ? ratio(row.knownSales, row.target) : null)) fail();
  if (row.total === row.unavailableOrders && row.knownSales !== '0.00') fail();
}

const FINANCIAL_FIELDS = ['totalSales', 'grossSales', 'actualSales', 'dueAmount'];
function validateFinancialAmounts(totals) {
  if (!totals || Object.keys(totals).length !== FINANCIAL_FIELDS.length) fail();
  FINANCIAL_FIELDS.forEach((key) => {
    const value = totals[key];
    if (!value || Object.keys(value).length !== 2 || typeof value.complete !== 'boolean'
      || (value.complete ? !money(value.amount) : value.amount !== null)) fail();
  });
  if (totals.grossSales.amount !== totals.actualSales.amount
    || totals.grossSales.complete !== totals.actualSales.complete) fail();
}

function validateFinancial(financial) {
  if (!financial || financial.scope !== 'configured-subtotal'
    || !Array.isArray(financial.contributions) || financial.contributions.length !== KINDS.length) fail();
  validateFinancialAmounts(financial.totals);
  financial.contributions.forEach((row, i) => {
    if (!row || row.kind !== KINDS[i]) fail();
    if (row.kind !== 'Kit') {
      if (row.state !== 'unconfigured' || row.totals !== null) fail();
      return;
    }
    if (row.state !== 'configured') fail();
    validateFinancialAmounts(row.totals);
    FINANCIAL_FIELDS.forEach((key) => {
      if (row.totals[key].amount !== financial.totals[key].amount
        || row.totals[key].complete !== financial.totals[key].complete) fail();
    });
  });
}

export async function getMRDashboard({ year, period = 'all', mrId, signal }) {
  const data = await mrSalesRequest('/dashboard', {
    params: { ...(year == null ? {} : { start_year: year }), period }, signal,
  });
  if (!data || data.mrId !== mrId || !Number.isInteger(data.startYear)
    || data.startYear < 1 || data.startYear > 9998 || (year != null && data.startYear !== year)
    || !Number.isInteger(data.currentYear) || data.currentYear < 1 || data.currentYear > 9998
    || data.period !== period || !['all', 'Q1', 'Q2', 'Q3', 'Q4'].includes(period)) fail();
  const dates = fiscalBounds(data.startYear, period);
  if (data.dateFrom !== dates[0] || data.dateTo !== dates[1]
    || !data.directory || !count(data.directory.doctors) || !count(data.directory.patients)) fail();
  validateCard(data.orders, 'Total Orders');
  validateFinancial(data.financial);
  if (!Array.isArray(data.statuses) || data.statuses.length !== STATUSES.length) fail();
  data.statuses.forEach((row, i) => validateCard(row, STATUSES[i]));
  KINDS.forEach((kind, i) => {
    const sum = data.statuses.reduce((s, row) => s + BigInt(row.byType[i].count), 0n);
    if (sum !== BigInt(data.orders.byType[i].count)) fail();
  });
  validateAchievement(data.annual, data.startYear, 'all');
  if (!Array.isArray(data.quarters) || data.quarters.length !== 4
    || !Array.isArray(data.monthly) || data.monthly.length !== 12) fail();
  data.quarters.forEach((row, i) => {
    validateAchievement(row, data.startYear, `Q${i + 1}`);
    if (row.targetState !== data.annual.targetState) fail();
  });
  const sum = (rows, field) => rows.reduce((v, row) => v + cents(row[field]), 0n);
  if (sum(data.quarters, 'knownSales') !== cents(data.annual.knownSales)
    || data.quarters.reduce((s, r) => s + r.total, 0) !== data.annual.total
    || data.quarters.reduce((s, r) => s + r.unavailableOrders, 0) !== data.annual.unavailableOrders
    || (data.annual.target !== null && sum(data.quarters, 'target') !== cents(data.annual.target))) fail();
  data.monthly.forEach((row, i) => {
    const expected = `${String(data.startYear + (i >= 9 ? 1 : 0)).padStart(4, '0')}-${String((i + 3) % 12 + 1).padStart(2, '0')}`;
    if (!row || row.month !== expected || !money(row.knownSales) || !count(row.unavailableOrders)
      || row.amount !== (row.unavailableOrders === 0 ? row.knownSales : null)) fail();
  });
  data.quarters.forEach((row, i) => {
    const months = data.monthly.slice(i * 3, i * 3 + 3);
    if (sum(months, 'knownSales') !== cents(row.knownSales)
      || months.reduce((s, m) => s + m.unavailableOrders, 0) !== row.unavailableOrders) fail();
  });
  const selected = period === 'all' ? data.annual : data.quarters[Number(period[1]) - 1];
  const eligible = data.statuses.filter((r) => ['In process', 'Shipped', 'Delivered'].includes(r.label));
  if (eligible.reduce((s, r) => s + BigInt(r.total), 0n) !== BigInt(selected.total)) fail();
  if (data.recentLimit !== 6 || !Array.isArray(data.recent)
    || data.recent.length !== Math.min(data.orders.total, data.recentLimit)) fail();
  const seen = new Set();
  data.recent.forEach((row, i) => {
    if (row?.classification != null && (row.classification !== 'Free kit' || row.kind !== 'Kit')) fail();
    if (!row || typeof row.key !== 'string' || !KEY.test(row.key)
      || !KINDS.includes(row.kind) || !row.key.startsWith(`${row.kind}:`) || seen.has(row.key)
      || typeof row.number !== 'string' || !row.number.trim() || row.number.length > 48
      || !DAY.test(row.date) || row.date < dates[0] || row.date > dates[1]
      || !STATUSES.includes(row.status)) fail();
    if (i && (data.recent[i - 1].date < row.date
      || (data.recent[i - 1].date === row.date && data.recent[i - 1].key < row.key))) fail();
    const statusCard = data.statuses.find((r) => r.label === row.status);
    if (!statusCard.byType.find((r) => r.kind === row.kind)?.count) fail();
    seen.add(row.key);
  });
  return data;
}

// Current all-date balances are deliberately independent of sales FY/quarter.
export async function getMRDoctorPayments({ search = '', offset = 0, limit = 25, mrId, signal }) {
  const data = await mrSalesRequest('/doctor-payments', { params: { search, offset, limit }, signal });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const dayNumber = (v) => {
    if (typeof v !== 'string' || !DAY.test(v)) fail();
    const parsed = Date.parse(`${v}T00:00:00Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== v) fail();
    return parsed / 86400000;
  };
  if (!data || data.mrId !== mrId || data.offset !== offset || data.limit !== limit
    || !count(data.total) || data.total > 20000 || !count(data.doctorDaysLimit) || data.doctorDaysLimit > 3650
    || !Array.isArray(data.items) || data.items.length !== Math.min(limit, Math.max(0, data.total - offset))) fail();
  const businessDay = dayNumber(data.businessDate);
  const seen = new Set();
  for (const row of data.items) {
    if (!row || typeof row.doctorId !== 'string' || !uuid.test(row.doctorId) || seen.has(row.doctorId)
      || typeof row.doctorName !== 'string' || !row.doctorName.trim()
      || !money(row.received) || !money(row.knownDue) || !count(row.pendingPricingOrders)
      || row.pendingPricingOrders > 20000
      || row.due !== (row.pendingPricingOrders ? null : row.knownDue)) fail();
    seen.add(row.doctorId);
    if (row.oldestUnpaidDate === null) {
      if (row.oldestUnpaidAgeDays !== null || row.daysRemaining !== null || row.overdueDays !== null
        || cents(row.knownDue) !== 0n) fail();
    } else {
      const age = businessDay - dayNumber(row.oldestUnpaidDate);
      if (!Number.isSafeInteger(row.oldestUnpaidAgeDays) || row.oldestUnpaidAgeDays !== age
        || cents(row.knownDue) <= 0n
        || row.daysRemaining !== (data.doctorDaysLimit ? Math.max(0, data.doctorDaysLimit - age) : null)
        || row.overdueDays !== (data.doctorDaysLimit && age >= data.doctorDaysLimit ? Math.max(0, age - data.doctorDaysLimit) : null)) fail();
    }
  }
  return data;
}
