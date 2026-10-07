// Standalone, read-only UI fixtures. Never derive quantities from procurement or masters.
export const STOCK_DEMO_DISCLAIMER = 'Stock and histories are sample UI data, not server-backed or connected to PO/PR or Move stocks quantities. Purchases and sample sales/customer orders do not calculate available inventory.';

export function financialYearOf(date = new Date()) {
  return date.getFullYear() - (date.getMonth() < 3 ? 1 : 0);
}
export const financialYearLabel = (year) => `${year}-${year + 1}`;
export const financialYearRange = (year) => ({ from: `${year}-04-01`, to: `${year + 1}-03-31` });
const calendarDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function snapshotScope(year, now = new Date()) {
  return year === financialYearOf(now)
    ? { asOf: calendarDate(now), label: 'Demo as-of snapshot' }
    : { asOf: financialYearRange(year).to, label: 'Demo year-end snapshot' };
}
export const formatStockPrice = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
export const displayStockDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createStockDemo(now = new Date()) {
  const currentYear = financialYearOf(now);
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const products = [
    ['demo-dust', 'House Dust Mite', '10,000 AU/mL', 'Mites', 1250, 'vials'],
    ['demo-grass', 'Grass Pollen Mix', '1:20 w/v', 'Pollens', 980.5, 'vials'],
    ['demo-cedar-low', 'Cedar Pollen', '1:100 w/v', 'Pollens', 750, 'vials'],
    ['demo-cedar-high', 'Cedar Pollen', '1:20 w/v', 'Pollens', 1450, 'vials'],
    ['demo-cat', 'Cat Dander', '10,000 BAU/mL', 'Dander', 1650, 'vials'],
    ['demo-mould', 'Mould Mix', '1:10 w/v', 'Fungi', 875, 'bottles'],
    ['demo-birch', 'Birch Pollen', '1:50 w/v', 'Pollens', 620, 'vials'],
    ['demo-new', 'Sample Diagnostic Mix', '0.5%', 'Diagnostic', 450, 'kits'],
  ].map(([id, name, concentration, category, sellingPrice, unit]) => ({ id, name, concentration, category, sellingPrice, unit }));
  const snapshots = years.flatMap((year, offset) => products
    .filter((product) => product.id !== 'demo-new' || offset === 0)
    .map((product, index) => ({ productId: product.id, year, quantity: product.id === 'demo-birch' ? 0 : 12 + index * 7 + offset * 3 })));
  const purchases = [];
  const orders = [];
  years.forEach((year, offset) => products.forEach((product, index) => {
    // Birch deliberately has zero stock and no history; the diagnostic kit is new this year.
    if (product.id === 'demo-birch' || (product.id === 'demo-new' && offset > 0)) return;
    const price = Number((product.sellingPrice * 0.7).toFixed(2));
    const purchaseQty = 20 + index;
    purchases.push({ id: `purchase-${year}-${product.id}`, productId: product.id, date: `${year}-04-01`,
      reference: `DEMO-PUR-${year}-${index + 1}`, party: 'Sample Laboratory Supplies',
      quantity: purchaseQty, unit: product.unit, price, amount: Number((purchaseQty * price).toFixed(2)), status: 'Received (sample)' });
    const quantity = 3 + index;
    orders.push({ id: `sale-${year}-${product.id}`, productId: product.id,
      date: offset === 0 ? `${year}-04-01` : `${year + 1}-03-31`,
      reference: `DEMO-SALE-${year}-${index + 1}`, party: index % 2 ? 'Sample City Clinic' : 'Sample Allergy Centre',
      quantity, unit: product.unit, price: product.sellingPrice,
      amount: Number((quantity * product.sellingPrice).toFixed(2)), status: index % 2 ? 'Pending (sample)' : 'Fulfilled (sample)' });
  }));
  return freeze({ currentYear, years, products, snapshots, purchases, orders });
}

export function filterStock(demo, year, productId = '') {
  const products = new Map(demo.products.map((product) => [product.id, product]));
  return demo.snapshots.filter((row) => row.year === year && (!productId || row.productId === productId))
    .map((row) => ({ ...products.get(row.productId), quantity: row.quantity, year: row.year }));
}
export function filterHistory(history, productId, year) {
  const range = year === 'all' ? null : financialYearRange(Number(year));
  return history.filter((row) => row.productId === productId && (!range || (row.date >= range.from && row.date <= range.to)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export function stockCSVCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportStockCSV(rows, { year, asOf }) {
  const header = ['Scope', 'Financial year', 'As-of date', 'Product', 'Concentration', 'Category', 'Selling price (INR)', 'Quantity', 'Unit'];
  const records = rows.map((row) => ['Sample/demo UI data — not available inventory', financialYearLabel(year), asOf,
    row.name, row.concentration, row.category, row.sellingPrice.toFixed(2), row.quantity, row.unit]);
  return '\uFEFF' + [header, ...records].map((cells) => cells.map(stockCSVCell).join(',')).join('\r\n') + '\r\n';
}
