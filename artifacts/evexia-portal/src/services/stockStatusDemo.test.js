import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockDemo, financialYearOf, financialYearLabel, financialYearRange, snapshotScope, filterStock, filterHistory, exportStockCSV, stockCSVCell, stockFilterOptions } from './stockStatusDemo.js';

const now = new Date(2026, 9, 7);
const demo = createStockDemo(now);
test('April–March financial years and explicit snapshot dates', () => {
  assert.equal(financialYearOf(new Date(2026, 2, 31)), 2025);
  assert.equal(financialYearOf(new Date(2026, 3, 1)), 2026);
  assert.deepEqual(demo.years, [2026, 2025, 2024]);
  assert.equal(financialYearLabel(2024), '2024-2025');
  assert.deepEqual(financialYearRange(2024), { from: '2024-04-01', to: '2025-03-31' });
  assert.deepEqual(snapshotScope(2026, now), { label: 'Demo as-of snapshot', asOf: '2026-10-07' });
  assert.deepEqual(snapshotScope(2025, now), { label: 'Demo year-end snapshot', asOf: '2026-03-31' });
});
test('fixtures are read-only, immediately populated, use stable identities and have empty cases', () => {
  assert.ok(Object.isFrozen(demo.products[0]));
  assert.throws(() => { demo.snapshots[0].quantity = 999; }, TypeError);
  assert.equal(filterStock(demo, 2026).length, 8);
  assert.equal(filterStock(demo, 2025).length, 7);
  assert.equal(filterStock(demo, 2025, 'demo-new').length, 0);
  assert.equal(filterStock(demo, 2026, 'demo-birch')[0].quantity, 0);
  assert.equal(filterHistory(demo.purchases, 'demo-birch', 'all').length, 0);
  assert.equal(filterStock(demo, 2026, 'demo-cedar-high')[0].concentration, '1:20 w/v');
  for (const kind of ['purchases', 'orders']) {
    const rows = filterHistory(demo[kind], 'demo-cedar-high', 2025);
    assert.equal(rows.length, 1);
    assert.ok(rows.every((row) => row.productId === 'demo-cedar-high'));
    assert.equal(filterHistory(demo[kind], 'demo-cedar-high', 'all').length, 3);
    for (const row of demo[kind]) {
      const product = demo.products.find((item) => item.id === row.productId);
      assert.equal(row.unit, product.unit);
      assert.equal(row.amount, Number((row.price * row.quantity).toFixed(2)));
      assert.ok(row.date <= '2026-10-07');
    }
  }
});
test('histories include both year boundaries and exclude adjacent years', () => {
  const history = ['2025-03-31', '2025-04-01', '2026-03-31', '2026-04-01'].map((date) => ({ id: date, productId: 'a', date }));
  assert.deepEqual(filterHistory(history, 'a', 2025).map((row) => row.date), ['2026-03-31', '2025-04-01']);
});
test('current-year options and combined normalized filters preserve stable same-name identities', () => {
  const options = stockFilterOptions(demo);
  assert.deepEqual(options.categories, ['Dander', 'Diagnostic', 'Fungi', 'Mites', 'Pollens']);
  assert.equal(options.allergens.length, 8);
  assert.equal(options.allergens.filter((option) => option.label.includes('Cedar Pollen')).length, 2);
  assert.ok(options.allergens.find((option) => option.value === 'demo-cedar-high').label.includes('1:20 w/v (demo-cedar-high)'));
  assert.ok(filterStock(demo).every((row) => row.year === demo.currentYear));
  for (const [search, count] of [['  cEDar  ', 2], ['  1:20 W/V  ', 2], ['DEMO-CEDAR-HIGH', 1], ['pollens', 4], ['   ', 8]]) {
    assert.equal(filterStock(demo, demo.currentYear, { search }).length, count);
  }
  const filters = { search: ' cedar ', category: 'Pollens', productIds: ['demo-cedar-low', 'demo-cedar-high', 'demo-cat'] };
  assert.deepEqual(filterStock(demo, demo.currentYear, filters).map((row) => row.id), ['demo-cedar-low', 'demo-cedar-high']);
  assert.equal(filterStock(demo, demo.currentYear, { ...filters, category: 'Dander' }).length, 0);
  assert.equal(filterStock(demo, demo.currentYear, { productIds: ['unknown'] }).length, 0);
  assert.equal(filterStock(demo, demo.currentYear, { productIds: [] }).length, 8);
  assert.equal(filterStock(demo, demo.currentYear, { category: 'Pollens' }).length, 4);
  assert.equal(filterStock(demo, demo.currentYear, { ...filters, productIds: ['demo-cedar-high'] }).length, 1);
  const csv = exportStockCSV(filterStock(demo, demo.currentYear, filters), { year: demo.currentYear, asOf: snapshotScope(demo.currentYear, now).asOf });
  assert.equal(csv.split('\r\n').length, 4);
  assert.match(csv, /"2026-2027","2026-10-07"/);
  assert.doesNotMatch(csv, /Sr No/);
});
test('current samples do not become future-dated at April rollover', () => {
  const firstDay = createStockDemo(new Date(2031, 3, 1));
  assert.equal(firstDay.currentYear, 2031);
  assert.ok([...firstDay.orders, ...firstDay.purchases].every((row) => row.date <= '2031-04-01'));
});
test('CSV exports every filtered row with units, scope, exact prices and escaping', () => {
  const rows = filterStock(demo, 2026);
  const csv = exportStockCSV(rows, { year: 2026, asOf: '2026-10-07' });
  assert.equal(csv.split('\r\n').length, rows.length + 2);
  assert.match(csv, /Sample\/demo UI data/);
  assert.match(csv, /"2026-2027","2026-10-07"/);
  assert.match(csv, /"980.50"/);
  assert.match(csv, /"10,000 AU\/mL"/);
  assert.match(csv, /"0","vials"/);
  assert.equal(stockCSVCell('x,"y"\nz'), '"x,""y""\nz"');
  for (const value of ['=1+1', '+cmd', '-1', '@SUM(1)', ' \t=1', '\r@cmd']) assert.ok(stockCSVCell(value).startsWith('"\''));
  assert.equal(exportStockCSV([], { year: 2025, asOf: '2026-03-31' }).split('\r\n').length, 2);
});
