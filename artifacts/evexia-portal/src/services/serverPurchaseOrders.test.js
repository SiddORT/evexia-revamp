import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLine, computeTotals, taxContext, GST_STATES, MAX_TOTAL_PAISE } from './serverPurchaseOrders.js';

test('explicit supplier and destination determine regime, never Maharashtra alone', () => {
  for (const [supplier, destination, expected] of [
    ['27', '27', 'cgst_sgst'], ['29', '27', 'igst'], ['29', '29', 'cgst_sgst'],
    ['04', '04', 'cgst_utgst'], ['26', '26', 'cgst_utgst'], ['31', '31', 'cgst_utgst'],
    ['35', '35', 'cgst_utgst'], ['38', '38', 'cgst_utgst'], ['07', '07', 'cgst_sgst'], ['34', '34', 'cgst_sgst'],
  ]) {
    assert.equal(taxContext({ gstin: `${supplier}DDDDD3333D1Z8` }, destination).treatment, expected);
  }
  assert.equal(GST_STATES.length, 36);
  for (const code of ['', '00', '25', '28', '97', '99']) {
    assert.ok(taxContext({ gstin: '27DDDDD3333D1Z8' }, code).error);
    assert.ok(taxContext({ gstin: `${code}DDDDD3333D1Z8` }, '27').error);
  }
});

test('exact paise and component rounding agrees with server examples', () => {
  for (const [quantity, unitPrice, gst, treatment, subtotal, gstAmount] of [
    ['3.125', '123.456789', '18.123456', 'cgst_sgst', 38580, 6992],
    ['3.125', '123.456789', '18.123456', 'igst', 38580, 6992],
    ['1', '0.005000', '50', 'cgst_sgst', 1, 0], ['1', '0.005000', '50', 'igst', 1, 1],
    ['1', '0.030000', '100', 'cgst_utgst', 3, 4], ['0.001', '7.000001', '5.500001', 'cgst_sgst', 1, 0],
    ['1000000', '0', '0', 'igst', 0, 0],
  ]) {
    const line = computeLine(quantity, { unitPrice, gst }, treatment);
    assert.equal(line.subtotal, subtotal);
    assert.equal(line.gstAmount, gstAmount);
    assert.equal(line.total, subtotal + gstAmount);
    assert.equal(Object.values(line.taxComponents).reduce((a, b) => a + b, 0), gstAmount);
  }
  assert.equal(computeLine('1', { unitPrice: '100', gst: '18.123457' }, 'cgst_sgst').componentRates.cgst, '9.0617285');
});

test('partial totals keep completed lines, empty drafts are zero, pending tax is not zero', () => {
  const valid = { quantity: '1', product: { unitPrice: '100', gst: '18' } };
  const blank = { quantity: '1', product: null };
  assert.equal(computeTotals([valid, blank], 'cgst_sgst').total, 11800);
  assert.equal(computeTotals([valid, blank], 'cgst_sgst').incomplete, 1);
  assert.equal(computeTotals([valid, { ...valid, quantity: '-1' }], 'igst').total, 11800);
  assert.equal(computeTotals([blank], 'igst').total, 0);
  assert.equal(computeTotals([], 'igst').total, 0);
  assert.equal(computeTotals([valid]).total, null);
  assert.equal(computeTotals([valid]).subtotal, 10000);
  assert.equal(computeLine('1', { unitPrice: '100', gst: '0' }).taxPending, true);
  assert.equal(computeLine('1', { unitPrice: '100', gst: '0' }, 'igst').gstAmount, 0);
  assert.equal(computeLine('1', { unitPrice: null, gst: '18' }, 'igst'), null);
});

test('line, order limits, fractional quantities and malformed catalogue values', () => {
  const product = { unitPrice: '100000000', gst: '0' };
  assert.equal(computeLine('1', product, 'igst').total, MAX_TOTAL_PAISE);
  assert.equal(computeTotals([{ quantity: '1', product }, { quantity: '1', product }], 'igst').overflow, true);
  assert.equal(computeLine('1', { ...product, gst: '18' }, 'cgst_sgst').overflow, true);
  for (const q of ['0', '-1', '1.0001', '1e2', '1000000.001', 'NaN']) assert.equal(computeLine(q, product, 'igst'), null);
  for (const gst of ['NaN', '-1', '101', '1.0000001']) assert.equal(computeLine('1', { unitPrice: '1', gst }, 'igst'), null);
});
