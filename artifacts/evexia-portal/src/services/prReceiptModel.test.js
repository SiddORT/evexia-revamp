import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSamplePRReceipt, normalizePRReceipt } from './prReceiptModel.js';

const savedReceipt = (lineChanges = {}, receiptChanges = {}) => ({
  id: 'pr-1',
  number: 'PR-2026-001',
  poId: 'po-1',
  poNumber: 'PO-2026-001',
  poDate: '2026-10-01',
  receivedDate: '2026-10-02',
  receivedBy: 'Recorded Receiver',
  vendorId: 'vendor-1',
  vendorName: 'Saved Vendor',
  vendorAddress: 'Saved supplier address',
  vendorGstNo: 'SAVED-GST',
  vendorPhone: 'Saved phone',
  locationId: 'location-1',
  locationName: 'Saved destination',
  status: 'active',
  createdAt: '2026-10-02T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  deletedAt: null,
  lines: [{
    lineId: 'source-line-1',
    productId: 'product-1',
    productName: 'Saved product',
    orderedQty: 12.5,
    receivedQty: 4.125,
    acceptedQty: 3.5,
    balanceAfterQty: 9,
    rejectedQty: 0.625,
    batchNo: 'BATCH-1',
    expiryDate: '2027-10-02',
    ...lineChanges,
  }],
  ...receiptChanges,
});

test('normalizes saved receipt fields and retains the saved historical post-receipt balance', () => {
  const input = savedReceipt();
  const model = normalizePRReceipt(input);
  assert.equal(model.number, input.number);
  assert.equal(model.vendorAddress, input.vendorAddress);
  assert.equal(model.vendorGstNo, input.vendorGstNo);
  assert.equal(model.lines[0].lineId, 'source-line-1');
  assert.equal(model.lines[0].receivedQty, 4.125);
  assert.equal(model.lines[0].balanceAfterQty, 9);
  assert.equal(model.hasHistoricalBalance, true);
  assert.equal(model.balanceHistoryExplanation, '');
  assert.equal(model.isSample, false);
  assert.equal(input.lines[0].balanceAfterQty, 9, 'normalization does not mutate saved data');
});

test('legacy missing historical balance becomes null with an explicit non-reconstruction explanation', () => {
  const old = savedReceipt();
  delete old.lines[0].balanceAfterQty;
  const model = normalizePRReceipt(old);
  assert.equal(model.lines[0].balanceAfterQty, null);
  assert.equal(model.hasHistoricalBalance, false);
  assert.match(model.balanceHistoryExplanation, /cannot be reconstructed from current receipts or activity/);
  assert.equal(model.lines[0].orderedQty, 12.5);
});

test('preserves separate repeated-product source lines and their individual saved balances', () => {
  const receipt = savedReceipt();
  receipt.lines.push({
    ...receipt.lines[0],
    lineId: 'source-line-2',
    orderedQty: 8,
    receivedQty: 1,
    acceptedQty: 0.5,
    balanceAfterQty: 7.5,
    rejectedQty: 0.5,
  });
  const model = normalizePRReceipt(receipt);
  assert.equal(model.lines.length, 2);
  assert.deepEqual(model.lines.map((line) => [line.lineId, line.balanceAfterQty]), [
    ['source-line-1', 9], ['source-line-2', 7.5],
  ]);
});

test('sample factory marks its preview and includes an internally consistent historical balance', () => {
  const sample = makeSamplePRReceipt();
  assert.deepEqual(sample, makeSamplePRReceipt('classic'));
  assert.equal(sample.isSample, true);
  assert.equal(sample.id, 'sample-pr-template');
  assert.equal(sample.number, 'PR-SAMPLE-001');
  assert.equal(sample.vendorName, 'Sample Supplier · Preview Only');
  assert.equal(sample.lines[0].productName, 'Sample Diagnostic Reagent');
  assert.equal(sample.lines[0].orderedQty - sample.lines[0].acceptedQty, sample.lines[0].balanceAfterQty);
  assert.equal(sample.hasHistoricalBalance, true);
});

test('Modern and Compact previews use distinct fictional receipt, supplier, and product data', () => {
  const classic = makeSamplePRReceipt();
  const modern = makeSamplePRReceipt('modern');
  const compact = makeSamplePRReceipt('compact');
  for (const sample of [modern, compact]) {
    assert.equal(sample.isSample, true);
    assert.equal(sample.hasHistoricalBalance, true);
    assert.equal(sample.lines[0].orderedQty - sample.lines[0].acceptedQty,
      sample.lines[0].balanceAfterQty);
    assert.match(sample.vendorName, /Sample .*Preview Only/);
    assert.notEqual(sample.id, classic.id);
    assert.notEqual(sample.number, classic.number);
    assert.notEqual(sample.vendorName, classic.vendorName);
    assert.notEqual(sample.lines[0].productName, classic.lines[0].productName);
  }
  assert.notEqual(modern.id, compact.id);
  assert.notEqual(modern.number, compact.number);
  assert.notEqual(modern.vendorId, compact.vendorId);
  assert.notEqual(modern.vendorName, compact.vendorName);
  assert.notEqual(modern.lines[0].productId, compact.lines[0].productId);
  assert.notEqual(modern.lines[0].productName, compact.lines[0].productName);
  assert.throws(() => makeSamplePRReceipt('unsupported'), /supported Purchase Received/);
});

test('rejects absent records, malformed line collections, and invalid saved historical balances', () => {
  assert.throws(() => normalizePRReceipt(null), /saved Purchase Received record/);
  assert.throws(() => normalizePRReceipt({ lines: null }), /lines must be an array/);
  assert.throws(() => normalizePRReceipt(savedReceipt({ balanceAfterQty: 13 })), /invalid saved post-receipt balance/);
  assert.throws(() => normalizePRReceipt(savedReceipt({ receivedQty: 'not-a-quantity' })), /invalid saved quantity data/);
  assert.throws(() => normalizePRReceipt(savedReceipt({ acceptedQty: 5 })), /invalid saved quantity data/);
  assert.throws(() => normalizePRReceipt(savedReceipt({ rejectedQty: 0 })), /invalid saved quantity data/);
  assert.throws(() => normalizePRReceipt({ ...savedReceipt(), lines: [null] }), /line 1 is invalid/);
});