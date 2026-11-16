// Deterministic synthetic fixtures for the Super Admin dashboard mock.
// Nothing here reflects real sales, balances, patients or accounting policy.

export const ORDER_TYPES = ['Immunotherapy', 'Kits & Consumables', 'SPT', 'Lupin'];
export const ORDER_STATUSES = ['Confirmed', 'In Process', 'Shipped', 'Delivered', 'Rejected', 'Returned'];
export const FINANCIAL_YEARS = ['FY 2023-24', 'FY 2024-25', 'FY 2025-26'];
export const ZONES = ['North Zone', 'South Zone', 'East Zone', 'West Zone', 'Central Zone'];
export const MRS = [
  { id: 'mr-01', name: 'Arvind Menon', zone: 'South Zone' },
  { id: 'mr-02', name: 'Bhavna Kulkarni', zone: 'West Zone' },
  { id: 'mr-03', name: 'Chetan Rawat', zone: 'North Zone' },
  { id: 'mr-04', name: 'Deepika Sen', zone: 'East Zone' },
  { id: 'mr-05', name: 'Farhan Qureshi', zone: 'Central Zone' },
  { id: 'mr-06', name: 'Gayathri Iyer', zone: 'South Zone' },
  { id: 'mr-07', name: 'Harpreet Gill', zone: 'North Zone' },
  { id: 'mr-08', name: 'Ishaan Patil', zone: 'West Zone' },
  { id: 'mr-09', name: 'Jyoti Barua', zone: 'East Zone' },
  { id: 'mr-10', name: 'Kiran Tiwari', zone: 'Central Zone' },
];
export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

// Sample scope totals: fixed directory counts, not affected by order filters.
export const SAMPLE_DIRECTORY = { products: 187, patients: 3462, doctors: 418, mrs: MRS.length };

const TYPE_PRICE = { Immunotherapy: [5200, 14800], 'Kits & Consumables': [1800, 7600], SPT: [1450, 3900], Lupin: [3100, 9200] };
const STATUS_WEIGHTS = [['Delivered', 46], ['Shipped', 14], ['In Process', 13], ['Confirmed', 15], ['Rejected', 6], ['Returned', 6]];

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function pickWeighted(rand, weights) {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, w] of weights) { roll -= w; if (roll < 0) return value; }
  return weights[weights.length - 1][0];
}

function buildOrders() {
  const rand = seeded(20251);
  const orders = [];
  FINANCIAL_YEARS.forEach((fy, fyIndex) => {
    const count = 140 + fyIndex * 38;
    for (let i = 0; i < count; i += 1) {
      const mr = MRS[Math.floor(rand() * MRS.length)];
      const type = pickWeighted(rand, [['Immunotherapy', 44], ['Kits & Consumables', 22], ['SPT', 24], ['Lupin', 10]]);
      const status = pickWeighted(rand, STATUS_WEIGHTS);
      const [lo, hi] = TYPE_PRICE[type];
      const amount = Math.round((lo + rand() * (hi - lo)) / 10) * 10;
      // Demo arithmetic only: delivered orders record full sample receipt,
      // shipped partial, others none. Not a settlement or accounting rule.
      const counted = status !== 'Rejected' && status !== 'Returned';
      const received = status === 'Delivered' ? amount : status === 'Shipped' ? Math.round(amount * (0.35 + rand() * 0.4) / 10) * 10 : 0;
      const month = Math.floor(rand() * 12);
      const year = 2023 + fyIndex + (month >= 9 ? 1 : 0);
      const calendarMonth = (month + 3) % 12 + 1;
      const date = `${year}-${String(calendarMonth).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`;
      orders.push({
        id: `S-${fyIndex + 1}${String(i + 1).padStart(4, '0')}`,
        fy, month, date, mrId: mr.id, zone: mr.zone, type, status, amount,
        counted, received: counted ? received : 0,
        dose: type === 'Immunotherapy' ? (rand() < 0.62 ? 'Primary' : 'Booster') : null,
      });
    }
  });
  return orders;
}

export const SAMPLE_ORDERS = buildOrders();

export const INITIAL_FILTERS = { fy: 'FY 2025-26', mr: '', zone: '', type: '', status: '' };

export function filterOrders(filters) {
  return SAMPLE_ORDERS.filter((o) => (!filters.fy || o.fy === filters.fy)
    && (!filters.mr || o.mrId === filters.mr) && (!filters.zone || o.zone === filters.zone)
    && (!filters.type || o.type === filters.type) && (!filters.status || o.status === filters.status));
}

export function summarize(orders, financialYear = '') {
  const gross = orders.reduce((s, o) => s + o.amount, 0);
  const counted = orders.filter((o) => o.counted);
  const sales = counted.reduce((s, o) => s + o.amount, 0);
  const actual = counted.reduce((s, o) => s + o.received, 0);
  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((st) => [st, orders.filter((o) => o.status === st).length]));
  const breakdown = (rows) => ORDER_TYPES.map((type) => {
    const count = rows.filter((o) => o.type === type).length;
    return { type, count, percentage: rows.length ? count / rows.length * 100 : 0 };
  });
  const orderBreakdown = breakdown(orders);
  const statusBreakdowns = Object.fromEntries(ORDER_STATUSES.map((st) => [st, breakdown(orders.filter((o) => o.status === st))]));
  const byType = ORDER_TYPES.map((type) => {
    const rows = counted.filter((o) => o.type === type);
    return { type, orders: orders.filter((o) => o.type === type).length, sales: rows.reduce((s, o) => s + o.amount, 0), achieved: rows.reduce((s, o) => s + o.received, 0) };
  });
  // Keep actual chronological months across years, rather than folding all
  // Aprils together when the financial-year filter is cleared.
  const monthly = FINANCIAL_YEARS.filter((fy) => !financialYear || fy === financialYear).flatMap((fy) =>
    MONTHS.map((month, m) => {
      const year = Number(fy.slice(3, 7)) + (m >= 9 ? 1 : 0);
      return { label: `${month} ${year}`, shortLabel: `${month} ${String(year).slice(2)}`,
        sales: counted.filter((o) => o.fy === fy && o.month === m).reduce((s, o) => s + o.amount, 0) };
    }));
  const mrDue = MRS.map((mr) => ({ ...mr, due: counted.filter((o) => o.mrId === mr.id).reduce((s, o) => s + o.amount - o.received, 0) }))
    .filter((mr) => mr.due > 0).sort((a, b) => b.due - a.due);
  const immuno = orders.filter((o) => o.type === 'Immunotherapy');
  return {
    total: orders.length, gross, sales, actual, due: sales - actual, statusCounts, orderBreakdown, statusBreakdowns, byType, monthly, mrDue,
    primary: immuno.filter((o) => o.dose === 'Primary').length, booster: immuno.filter((o) => o.dose === 'Booster').length,
  };
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
export const formatINR = (v) => inr.format(v);
export const formatCount = (v) => num.format(v);
