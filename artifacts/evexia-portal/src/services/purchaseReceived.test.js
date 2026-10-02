import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PR_KEY, loadPRSnapshot, validatePR, getPOBalances, getPOFulfillment,
  createPR, updatePR, deletePR, filterPRs, exportPRCSV, guardedSeedSamplePRs, isSamplePR,
} from './purchaseReceived.js';
import { PO_KEY, createPO, updatePO, deletePO, guardedCreatePO, seedSamplePOs } from './purchaseOrders.js';
import { VENDOR_KEY } from './vendors.js';
import { STORAGE_LOCATION_KEY } from './storageLocations.js';
import { ALLERGEN_KEY } from './allergens.js';
import { CATEGORY_STORAGE_KEY } from './productCategories.js';
import { PURCHASE_MUTATION_LOCK } from './purchaseMutationLock.js';
import { normalizePRReceipt } from './prReceiptModel.js';
import { makePRDocument } from './prDocuments.js';

test('null saved receipt entries are rejected with recovery guidance, without changing storage', () => {
  const raw = JSON.stringify({ version: 1, revision: 0, receipts: [null], events: [] });
  window.localStorage.setItem(PR_KEY, raw);
  assert.throws(() => loadPRSnapshot(), /unreadable or invalid.*Back up or repair/);
  assert.equal(window.localStorage.getItem(PR_KEY), raw);
});

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

const draftPO = (snapshot, changes = {}) => ({
  poDate: '2026-09-30',
  expectedDate: '2026-10-01',
  vendorId: snapshot.refs.vendors[0].id,
  locationId: snapshot.refs.locations[0].id,
  lines: [{ productId: snapshot.refs.products[0].id, quantity: '10', unitPrice: '100', gst: '12' }],
  ...changes,
});

function installLocks() {
  const requests = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (name, options, callback) => {
      requests.push({ name, options });
      return Promise.resolve().then(callback);
    },
  } } });
  return requests;
}

function createOrder(snapshot, changes = {}) {
  const poRecord = createPO({ record: snapshot.poRecord }, snapshot.refs, draftPO(snapshot, changes));
  return loadPRSnapshot().poRecord.orders.find((order) => order.id === poRecord.orders[0].id);
}

function receiptValues(po, lines = [{}], changes = {}) {
  return {
    poId: po.id,
    receivedDate: po.poDate,
    receivedBy: 'Local Receiver',
    lines: lines.map((line) => ({
      lineId: po.lines[0].id,
      receivedQty: '2',
      acceptedQty: '2',
      batchNo: 'BATCH-1',
      expiryDate: '2027-09-30',
      ...line,
    })),
    ...changes,
  };
}

test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  installLocks();
  window.localStorage.setItem(PO_KEY, JSON.stringify({ version: 1, revision: 0, orders: [], events: [] }));
});

test('starts with an empty versioned receipt record and snapshots current PO references', () => {
  const snapshot = loadPRSnapshot();
  assert.deepEqual(snapshot.record, { version: 1, revision: 0, receipts: [], events: [] });
  assert.ok(snapshot.poRecord.orders);
  assert.deepEqual(snapshot.refs, {
    vendors: snapshot.refs.vendors, locations: snapshot.refs.locations, products: snapshot.refs.products,
  });
  assert.equal(window.localStorage.getItem(PR_KEY).includes('"receipts":[]'), true);
});

test('validates fractional lines, dates, batch data, duplicates, bounds and omits zero rows', () => {
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot, { lines: [
    { productId: snapshot.refs.products[0].id, quantity: '10', unitPrice: '100', gst: '12' },
    { productId: snapshot.refs.products[1].id, quantity: '5', unitPrice: '50', gst: '5' },
  ] });
  const line = po.lines[0];
  const valid = receiptValues(po, [{ receivedQty: '1.125', acceptedQty: '0.375' }, {
    lineId: po.lines[1].id, receivedQty: '', acceptedQty: '', batchNo: '', expiryDate: '',
  }]);
  const checked = validatePR(valid, loadPRSnapshot());
  assert.deepEqual(checked.errors, {});
  assert.equal(checked.receipt.lines.length, 1);
  assert.equal(checked.receipt.lines[0].rejectedQty, 0.75);
  assert.equal(checked.receipt.lines[0].orderedQty, 10);
  assert.equal(line.id, checked.receipt.lines[0].lineId);
  const zeroReceived = receiptValues(po, [
    { receivedQty: '1', acceptedQty: '1' },
    { lineId: po.lines[1].id, receivedQty: '0', acceptedQty: '', batchNo: '', expiryDate: '' },
  ]);
  assert.deepEqual(validatePR(zeroReceived, loadPRSnapshot()).errors, {});

  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '1.0001' }]), loadPRSnapshot()).errors['lines.0.receivedQty']);
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '1', acceptedQty: '' }]),
    loadPRSnapshot()).errors['lines.0.acceptedQty']);
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '1', acceptedQty: '1.001' }]), loadPRSnapshot()).errors['lines.0.acceptedQty']);
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '1', batchNo: '' }]), loadPRSnapshot()).errors['lines.0.batchNo']);
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '1', expiryDate: '2026-09-29' }]), loadPRSnapshot()).errors['lines.0.expiryDate']);
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '1' }], { receivedDate: '2026-09-29' }),
    loadPRSnapshot()).errors.receivedDate);
  const duplicate = receiptValues(po, [{ receivedQty: '1' }, { receivedQty: '1' }]);
  assert.ok(validatePR(duplicate, loadPRSnapshot()).errors['lines.1.lineId']);
});

test('uses stable PO line IDs to distinguish duplicate product rows', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const productId = snapshot.refs.products[0].id;
  const po = createOrder(snapshot, { lines: [
    { productId, quantity: '2', unitPrice: '100', gst: '12' },
    { productId, quantity: '3', unitPrice: '100', gst: '12' },
  ] });
  assert.notEqual(po.lines[0].id, po.lines[1].id);
  const values = receiptValues(po, [
    { lineId: po.lines[0].id, receivedQty: '1', acceptedQty: '1' },
    { lineId: po.lines[1].id, receivedQty: '2', acceptedQty: '2', batchNo: 'BATCH-2' },
  ]);
  const created = await createPR(loadPRSnapshot(), values);
  assert.deepEqual(created.record.receipts[0].lines.map((line) => line.orderedQty), [2, 3]);
  assert.deepEqual(created.record.receipts[0].lines.map((line) => line.lineId), po.lines.map((line) => line.id));
  assert.deepEqual(created.record.receipts[0].lines.map((line) => line.balanceAfterQty), [1, 1]);
});

test('supports partial receipts, accepted-only balances, rejection, close/reopen and edit recalculation', async () => {
  const requests = installLocks();
  const initial = loadPRSnapshot();
  const po = createOrder(initial);
  const lineId = po.lines[0].id;
  const first = await createPR(loadPRSnapshot(), receiptValues(po, [{
    receivedQty: '3.125', acceptedQty: '2.125',
  }]));
  const pr1 = first.record.receipts[0];
  assert.equal(pr1.lines[0].rejectedQty, 1);
  assert.equal(pr1.lines[0].balanceAfterQty, 7.875);
  assert.equal(getPOBalances(po, first.record.receipts)[lineId], 7.875);
  assert.equal(getPOBalances(po, [{ ...pr1, poId: 'different-po' }])[lineId], 10);
  assert.equal(getPOFulfillment(po, first.record.receipts), 'Partially Received');

  const second = await createPR(first, receiptValues(po, [{ receivedQty: '7.875', acceptedQty: '7.875' }]));
  assert.equal(second.record.receipts.find((receipt) => receipt.id !== pr1.id).lines[0].balanceAfterQty, 0);
  assert.equal(getPOBalances(po, second.record.receipts)[lineId], 0);
  assert.equal(getPOFulfillment(po, second.record.receipts), 'Closed');
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '0.001' }]), second).errors['lines.0.receivedQty']);

  const pr2 = second.record.receipts.find((receipt) => receipt.id !== pr1.id);
  const edited = await updatePR(second, pr2.id,
    receiptValues(po, [{ receivedQty: '7.875', acceptedQty: '7.875', batchNo: 'BATCH-EDIT' }]));
  assert.equal(edited.record.receipts.find((receipt) => receipt.id === pr1.id).number, pr1.number);
  assert.equal(getPOFulfillment(po, edited.record.receipts), 'Closed');
  assert.equal(edited.record.events.at(-1).action, 'updated');
  assert.equal(edited.record.events.at(-1).actor, 'Local demo operator (unverified record)');
  assert.equal(requests.every((request) => request.options.mode === 'exclusive'), true);
  assert.ok(requests.every((request) => request.name === requests[0].name));
});

test('earlier rejected receipt remains correctable after a later receipt closes the PO, without over-accepting', async () => {
  installLocks();
  const initial = loadPRSnapshot();
  const po = createOrder(initial);
  let snapshot = await createPR(loadPRSnapshot(), receiptValues(po, [{
    receivedQty: '10', acceptedQty: '5', batchNo: 'FIRST',
  }]));
  const firstId = snapshot.record.receipts[0].id;
  const firstNumber = snapshot.record.receipts[0].number;
  snapshot = await createPR(snapshot, receiptValues(po, [{
    receivedQty: '5', acceptedQty: '5', batchNo: 'SECOND',
  }]));
  assert.equal(getPOFulfillment(po, snapshot.record.receipts), 'Closed');
  assert.equal(getPOBalances(po, snapshot.record.receipts, firstId)[po.lines[0].id], 5);

  const correction = receiptValues(po, [{
    receivedQty: '10', acceptedQty: '5', batchNo: 'CORRECTED', expiryDate: '2027-12-31',
  }], { receivedDate: '2026-10-01', receivedBy: 'Corrected local receiver' });
  assert.deepEqual(validatePR(correction, snapshot, snapshot.record.receipts.find((r) => r.id === firstId)).errors, {});
  snapshot = await updatePR(snapshot, firstId, correction);
  const corrected = snapshot.record.receipts.find((r) => r.id === firstId);
  assert.equal(corrected.number, firstNumber);
  assert.equal(corrected.lines[0].receivedQty, 10);
  assert.equal(corrected.lines[0].batchNo, 'CORRECTED');
  assert.equal(corrected.lines[0].expiryDate, '2027-12-31');
  assert.equal(corrected.receivedDate, '2026-10-01');
  assert.equal(corrected.receivedBy, 'Corrected local receiver');
  assert.equal(corrected.lines[0].balanceAfterQty, 5);
  assert.equal(snapshot.record.receipts.find((receipt) => receipt.id !== firstId).lines[0].balanceAfterQty, 0,
    'a later receipt keeps its saved historical balance');
  assert.equal(getPOFulfillment(po, snapshot.record.receipts), 'Closed');

  const reduceAcceptance = { ...correction, lines: [{ ...correction.lines[0], acceptedQty: '4' }] };
  snapshot = await updatePR(snapshot, firstId, reduceAcceptance);
  assert.equal(getPOBalances(po, snapshot.record.receipts)[po.lines[0].id], 1);
  assert.equal(snapshot.record.receipts.find((r) => r.id === firstId).lines[0].balanceAfterQty, 6);
  assert.equal(getPOFulfillment(po, snapshot.record.receipts), 'Partially Received');
  const acceptedTooMuch = { ...correction, lines: [{ ...correction.lines[0], acceptedQty: '6' }] };
  const receivedTooMuch = { ...reduceAcceptance, lines: [{ ...reduceAcceptance.lines[0], receivedQty: '11' }] };
  const stored = window.localStorage.getItem(PR_KEY);
  await assert.rejects(() => updatePR(snapshot, firstId, acceptedTooMuch), /Accepted quantity cannot exceed.*balance of 5/);
  await assert.rejects(() => updatePR(snapshot, firstId, receivedTooMuch), /New or increased receiving/);
  await assert.rejects(() => createPR(snapshot, receiptValues(po, [{ receivedQty: '2', acceptedQty: '1' }])), /Received quantity cannot exceed.*balance of 1/);
  assert.equal(window.localStorage.getItem(PR_KEY), stored);

  const reduceHistoricalReceiving = { ...reduceAcceptance, lines: [{ ...reduceAcceptance.lines[0], receivedQty: '9' }] };
  snapshot = await updatePR(snapshot, firstId, reduceHistoricalReceiving);
  assert.equal(snapshot.record.receipts.find((r) => r.id === firstId).lines[0].receivedQty, 9);
  assert.equal(getPOBalances(po, snapshot.record.receipts)[po.lines[0].id], 1);
});

test('does not clamp an edited historical balance below zero after an earlier receipt is deleted', async () => {
  installLocks();
  const initial = loadPRSnapshot();
  const po = createOrder(initial);
  let snapshot = await createPR(loadPRSnapshot(), receiptValues(po, [{
    receivedQty: '5', acceptedQty: '5', batchNo: 'EARLIER',
  }]));
  const earlierId = snapshot.record.receipts[0].id;
  snapshot = await createPR(snapshot, receiptValues(po, [{
    receivedQty: '4', acceptedQty: '4', batchNo: 'LATER',
  }]));
  const later = snapshot.record.receipts.find((receipt) => receipt.id !== earlierId);
  assert.equal(later.lines[0].balanceAfterQty, 1);

  snapshot = await deletePR(snapshot, earlierId);
  snapshot = await updatePR(snapshot, later.id, receiptValues(po, [{
    receivedQty: '10', acceptedQty: '10', batchNo: 'LATER-UPDATED',
  }]));
  const edited = snapshot.record.receipts.find((receipt) => receipt.id === later.id);
  assert.equal(edited.lines[0].balanceAfterQty, null,
    'negative historical remaining balance is unknown, not a fabricated zero');
});

test('snapshots vendor details and preserves them on edit while recording detailed old-to-new activity', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const created = await createPR(loadPRSnapshot(), receiptValues(po));
  const original = created.record.receipts[0];
  assert.equal(original.vendorAddress, snapshot.refs.vendors.find((vendor) => vendor.id === original.vendorId).registeredAddress);
  assert.equal(original.vendorGstNo, snapshot.refs.vendors.find((vendor) => vendor.id === original.vendorId).gstNo);
  const vendorRecords = JSON.parse(window.localStorage.getItem(VENDOR_KEY));
  window.localStorage.setItem(VENDOR_KEY, JSON.stringify(vendorRecords.map((vendor) =>
    vendor.id === original.vendorId ? {
      ...vendor, phoneNo: '9999999999', registeredAddress: 'Changed master address', gstNo: '27ZZZZZ0000Z1Z5',
    } : vendor)));
  const refreshed = loadPRSnapshot();
  const updated = await updatePR(refreshed, original.id, receiptValues(po, [{
    receivedQty: '3', acceptedQty: '2.5', batchNo: 'BATCH-UPDATED', expiryDate: '2028-01-01',
  }], { receivedDate: '2026-10-01', receivedBy: 'Updated Receiver' }));
  const receipt = updated.record.receipts.find((item) => item.id === original.id);
  assert.equal(receipt.vendorPhone, original.vendorPhone);
  assert.equal(receipt.vendorAddress, original.vendorAddress);
  assert.equal(receipt.vendorGstNo, original.vendorGstNo);
  const summary = updated.record.events.at(-1).summary;
  for (const phrase of ['Received date: 2026-09-30 → 2026-10-01',
    'Received by: Local Receiver → Updated Receiver', 'received: 2 → 3', 'accepted: 2 → 2.5',
    'rejected: 0 → 0.5', 'batch: BATCH-1 → BATCH-UPDATED', 'expiry: 2027-09-30 → 2028-01-01']) {
    assert.ok(summary.includes(phrase), phrase);
  }
});

test('legacy receipt schema remains readable and absent balances are not reconstructed on load', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const created = await createPR(loadPRSnapshot(), receiptValues(po, [{
    receivedQty: '3', acceptedQty: '2',
  }]));
  const legacy = JSON.parse(window.localStorage.getItem(PR_KEY));
  const savedReceipt = legacy.receipts[0];
  delete savedReceipt.vendorAddress;
  delete savedReceipt.vendorGstNo;
  delete savedReceipt.lines[0].balanceAfterQty;
  const raw = JSON.stringify(legacy);
  window.localStorage.setItem(PR_KEY, raw);

  const refreshed = loadPRSnapshot();
  assert.equal(refreshed.record.receipts[0].lines[0].balanceAfterQty, undefined);
  const model = normalizePRReceipt(refreshed.record.receipts[0]);
  assert.equal(model.lines[0].balanceAfterQty, null);
  assert.match(model.balanceHistoryExplanation, /cannot be reconstructed from current receipts or activity/);
  assert.equal(window.localStorage.getItem(PR_KEY), raw);
  assert.equal(created.record.revision, refreshed.record.revision);

  const receipt = refreshed.record.receipts[0];
  const edited = await updatePR(refreshed, receipt.id,
    receiptValues(po, [{ receivedQty: '3', acceptedQty: '2', batchNo: 'BATCH-EDITED' }],
      { receivedBy: 'Updated legacy receiver' }));
  const editedReceipt = edited.record.receipts[0];
  assert.equal(editedReceipt.lines[0].balanceAfterQty, null,
    'an edit cannot manufacture missing historical balance data');
  assert.equal(Object.hasOwn(editedReceipt, 'vendorAddress'), false,
    'an edit cannot manufacture a historical vendor address from current masters');
});

test('accepts semantically identical PR storage formatting changes while preserving freshness checks', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const created = await createPR(loadPRSnapshot(), receiptValues(po));
  window.localStorage.setItem(PR_KEY, JSON.stringify(created.record, null, 2));
  const updated = await updatePR(created, created.record.receipts[0].id,
    receiptValues(po, [{ receivedQty: '2', acceptedQty: '2', batchNo: 'BATCH-FORMATTED' }]));
  assert.equal(updated.record.revision, 2);
  assert.equal(updated.record.receipts[0].lines[0].batchNo, 'BATCH-FORMATTED');
});

test('rejects over-balance and stale changes, while delete restores balance without losing source details', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const stale = loadPRSnapshot();
  const created = await createPR(stale, receiptValues(po, [{ receivedQty: '4', acceptedQty: '3' }]));
  const active = created.record.receipts[0];
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '8' }]), created).errors['lines.0.receivedQty']);
  await assert.rejects(createPR(stale, receiptValues(po, [{ receivedQty: '1' }])), /changed in another tab/);

  const deleted = await deletePR(created, active.id);
  assert.equal(deleted.record.receipts[0].status, 'deleted');
  assert.equal(deleted.record.receipts[0].lines[0].productName, po.lines[0].productName);
  assert.equal(deleted.record.receipts[0].deletedAt, deleted.record.receipts[0].updatedAt);
  assert.equal(getPOBalances(po, deleted.record.receipts)[po.lines[0].id], 10);
  assert.equal(getPOFulfillment(po, deleted.record.receipts), 'Open');
  assert.equal(deleted.record.events.at(-1).action, 'deleted');
  await assert.rejects(updatePR(deleted, active.id, receiptValues(po)), /deleted/);
});

test('rejects stale PO snapshots and keeps deleted PR source details after later PO edits', async () => {
  installLocks();
  const stale = loadPRSnapshot();
  const po = createOrder(stale);
  await assert.rejects(createPR(stale, receiptValues(po)), /Purchase Orders changed/);

  const saved = await createPR(loadPRSnapshot(), receiptValues(po));
  const deleted = await deletePR(saved, saved.record.receipts[0].id);
  const source = deleted.record.receipts[0];
  const revisedPO = updatePO({ record: deleted.poRecord }, deleted.refs, po.id,
    draftPO(deleted, { expectedDate: '2026-10-10' }));
  const refreshed = loadPRSnapshot();
  assert.equal(refreshed.poRecord.orders.find((order) => order.id === po.id).expectedDate, '2026-10-10');
  assert.deepEqual(refreshed.record.receipts[0], source);
  assert.ok(revisedPO.orders.some((order) => order.id === po.id));
});

test('serializes guarded PO changes with PR changes and rejects a PO while active receipts exist', async () => {
  installLocks();
  const initial = loadPRSnapshot();
  const po = createOrder(initial);
  const active = await createPR(loadPRSnapshot(), receiptValues(po));
  assert.throws(() => updatePO({ record: active.poRecord }, active.refs, po.id,
    draftPO(active, { expectedDate: '2026-10-04' })), /active Purchase Received/);
  assert.throws(() => deletePO({ record: active.poRecord }, po.id), /active Purchase Received/);
});

test('detects corrupted active aggregate balances on snapshot load', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const first = await createPR(loadPRSnapshot(), receiptValues(po, [{
    receivedQty: '6', acceptedQty: '5',
  }]));
  const second = await createPR(first, receiptValues(po, [{
    receivedQty: '5', acceptedQty: '5',
  }]));
  const corrupted = JSON.parse(window.localStorage.getItem(PR_KEY));
  const saved = corrupted.receipts.find((receipt) => receipt.id === first.record.receipts[0].id);
  saved.lines[0].acceptedQty = 6;
  saved.lines[0].rejectedQty = 0;
  window.localStorage.setItem(PR_KEY, JSON.stringify(corrupted));
  assert.equal(second.record.revision, 2);
  assert.throws(() => loadPRSnapshot(), /over-accepted active quantities/);
});

test('guarded PO writes fully validate deleted PR history while holding the shared lock', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const created = await createPR(loadPRSnapshot(), receiptValues(po));
  const deleted = await deletePR(created, created.record.receipts[0].id);
  const corrupted = JSON.parse(window.localStorage.getItem(PR_KEY));
  corrupted.receipts[0].lines[0].expiryDate = 'not-a-date';
  window.localStorage.setItem(PR_KEY, JSON.stringify(corrupted));
  await assert.rejects(guardedCreatePO({ record: deleted.poRecord, refs: deleted.refs },
    deleted.refs, draftPO(deleted)), /unreadable or invalid/);
});

test('fails closed on unreadable or orphaned active PR storage and on persistence failure', async () => {
  installLocks();
  window.localStorage.setItem(PR_KEY, '{not-json');
  assert.throws(() => loadPRSnapshot(), /unreadable/);
  const broken = window.localStorage.getItem(PR_KEY);
  assert.throws(() => deletePO({ record: { version: 1, revision: 0, orders: [], events: [] } }, 'missing'),
    /unavailable|unreadable/);
  assert.equal(window.localStorage.getItem(PR_KEY), broken);

  window.localStorage.setItem(PR_KEY, JSON.stringify({ version: 1, revision: 0, receipts: [{
    id: 'orphan', number: 'PR-ORPHAN', poId: 'missing-po', poNumber: 'PO-MISSING',
    poDate: '2026-01-01', receivedDate: '2026-01-01', receivedBy: 'Receiver',
    vendorId: 'vendor', vendorName: 'Vendor', vendorPhone: '', locationId: 'location',
    locationName: 'Store', status: 'active', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, lines: [{
      lineId: 'line', productId: 'product', productName: 'Product', orderedQty: 1, receivedQty: 1,
      acceptedQty: 1, rejectedQty: 0, batchNo: 'B-1', expiryDate: '2027-01-01',
    }],
  }], events: [{ id: 'event', receiptId: 'orphan', number: 'PR-ORPHAN', action: 'created',
    at: '2026-01-01T00:00:00.000Z', actor: 'Demo Admin', summary: 'created' }] }));
  const orphan = JSON.parse(window.localStorage.getItem(PR_KEY));
  orphan.revision = 1;
  window.localStorage.setItem(PR_KEY, JSON.stringify(orphan));
  assert.throws(() => loadPRSnapshot(), /orphaned or mismatched/);

  window.localStorage.removeItem(PR_KEY);
  const empty = loadPRSnapshot();
  const po = createOrder(empty);
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = (key, value) => {
    if (key === PR_KEY && JSON.parse(value).revision > 0) throw new Error('quota');
    originalSetItem(key, value);
  };
  await assert.rejects(createPR(loadPRSnapshot(), receiptValues(po)), /could not be saved/);
  assert.equal(JSON.parse(originalSetItem === window.localStorage.setItem
    ? '{}' : window.localStorage.getItem(PR_KEY)).revision, 0);
});

test('filters saved receipts and exports source quantities using formula-safe CSV', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const created = await createPR(loadPRSnapshot(), receiptValues(po, [{
    receivedQty: '1.5', acceptedQty: '1', batchNo: '=1+1',
  }], { receivedBy: '=HYPERLINK("x")' }));
  const receipt = created.record.receipts[0];
  assert.deepEqual(filterPRs(created.record.receipts, created.poRecord,
    { search: '=hyperlink', from: po.poDate, to: po.poDate }).map((item) => item.id), [receipt.id]);
  assert.equal(filterPRs(created.record.receipts, created.poRecord, { fulfillment: 'Partially Received' }).length, 1);
  const csv = exportPRCSV(created.record.receipts, created.poRecord);
  assert.match(csv, /Purchase Received/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /"1\.5","1","0\.5"/);
});

test('requires Web Locks for PR writes', async () => {
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(createPR(loadPRSnapshot(), receiptValues(po)), /Web Locks/);
});

function sampleSnapshot() {
  const empty = loadPRSnapshot();
  seedSamplePOs({ record: empty.poRecord, refs: empty.refs });
  return loadPRSnapshot();
}

function rawStorageSnapshot() {
  return new Map(window.localStorage.values);
}

function assertStorageMatches(expected) {
  assert.deepEqual(new Map(window.localStorage.values), expected);
}

function installQueuedLock() {
  let start;
  const requests = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (name, options, callback) => {
      requests.push({ name, options });
      return new Promise((resolve, reject) => {
        start = () => Promise.resolve().then(callback).then(resolve, reject);
      });
    },
  } } });
  return {
    requests,
    run: () => {
      assert.ok(start, 'the lock callback should be queued');
      return start();
    },
  };
}

const sampleRawKeys = [PR_KEY, PO_KEY, VENDOR_KEY, STORAGE_LOCATION_KEY, ALLERGEN_KEY, CATEGORY_STORAGE_KEY];

test('guarded sample receipts seed five strict linked records without writing sample POs', async () => {
  const requests = installLocks();
  const snapshot = sampleSnapshot();
  const poRaw = window.localStorage.getItem(PO_KEY);
  const sampleOrders = snapshot.poRecord.orders.filter((po) => ['sample-po-1', 'sample-po-2', 'sample-po-4', 'sample-po-5'].includes(po.id));
  assert.deepEqual(sampleOrders.map((po) => po.id).sort(), ['sample-po-1', 'sample-po-2', 'sample-po-4', 'sample-po-5']);
  assert.deepEqual(sampleOrders.map((po) => po.status), ['open', 'open', 'open', 'open']);
  assert.deepEqual(sampleOrders.find((po) => po.id === 'sample-po-1').lines.map((line) => line.quantity), [24, 12]);
  assert.deepEqual(sampleOrders.find((po) => po.id === 'sample-po-2').lines.map((line) => line.quantity), [72]);
  assert.deepEqual(sampleOrders.find((po) => po.id === 'sample-po-4').lines.map((line) => line.quantity), [32, 8]);
  assert.deepEqual(sampleOrders.find((po) => po.id === 'sample-po-5').lines.map((line) => line.quantity), [20]);
  const samplePO2 = sampleOrders.find((po) => po.id === 'sample-po-2');
  const samplePO2History = snapshot.poRecord.events.filter((event) => event.orderId === samplePO2.id);
  assert.deepEqual(samplePO2History.map((event) => event.id), ['sample-po-event-2', 'sample-po-event-6']);
  assert.deepEqual(samplePO2History.map((event) => event.action), ['created', 'updated']);
  assert.equal(samplePO2History[0].at, samplePO2.createdAt);
  assert.equal(samplePO2History[1].at, samplePO2.updatedAt);
  assert.match(samplePO2History[1].summary, /60 → 72/);

  let writes = [];
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = (key, value) => {
    writes.push(key);
    originalSetItem(key, value);
  };
  const seeded = await guardedSeedSamplePRs(snapshot);

  assert.deepEqual(writes, [PR_KEY], 'a successful seed makes exactly one write, to Purchase Received');
  assert.equal(window.localStorage.getItem(PO_KEY), poRaw, 'sample PO content and history remain unchanged');
  assert.equal(seeded.record.revision, 5);
  assert.equal(seeded.record.receipts.length, 5);
  assert.equal(seeded.record.events.length, 5);
  assert.deepEqual(seeded.record.receipts.map((receipt) => receipt.id),
    ['sample-pr-5', 'sample-pr-4', 'sample-pr-3', 'sample-pr-2', 'sample-pr-1']);
  assert.deepEqual(seeded.record.receipts.map((receipt) => receipt.number),
    ['PR-SAMPLE-005', 'PR-SAMPLE-004', 'PR-SAMPLE-003', 'PR-SAMPLE-002', 'PR-SAMPLE-001']);

  const poById = new Map(seeded.poRecord.orders.map((po) => [po.id, po]));
  const expected = [
    { id: 'sample-pr-1', poId: 'sample-po-1', day: 1, received: [12, 6], accepted: [9, 4.5] },
    { id: 'sample-pr-2', poId: 'sample-po-1', day: 3, received: [6, 3], accepted: [6, 3] },
    { id: 'sample-pr-3', poId: 'sample-po-2', day: 5, received: [72], accepted: [72] },
    { id: 'sample-pr-4', poId: 'sample-po-4', day: 2, received: [16, 4], accepted: [12, 3] },
    { id: 'sample-pr-5', poId: 'sample-po-5', day: 3, received: [5], accepted: [0] },
  ];
  for (const item of expected) {
    const receipt = seeded.record.receipts.find((record) => record.id === item.id);
    const po = poById.get(item.poId);
    const date = (days) => new Date(Date.parse(`${po.poDate}T00:00:00Z`) + days * 86400000)
      .toISOString().slice(0, 10);
    assert.equal(receipt.poNumber, po.number);
    assert.equal(receipt.poDate, po.poDate);
    assert.equal(receipt.receivedDate, date(item.day));
    assert.equal(receipt.vendorId, po.vendorId);
    assert.equal(receipt.vendorName, po.vendorName);
    assert.equal(receipt.locationId, po.locationId);
    assert.equal(receipt.locationName, po.locationName);
    assert.equal(receipt.status, 'active');
    assert.equal(receipt.deletedAt, null);
    assert.match(receipt.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(receipt.updatedAt, receipt.createdAt);
    assert.deepEqual(receipt.lines.map((line) => line.lineId), po.lines.map((line) => line.id));
    assert.deepEqual(receipt.lines.map((line) => line.productId), po.lines.map((line) => line.productId));
    assert.deepEqual(receipt.lines.map((line) => line.productName), po.lines.map((line) => line.productName));
    assert.deepEqual(receipt.lines.map((line) => line.orderedQty), po.lines.map((line) => line.quantity));
    assert.deepEqual(receipt.lines.map((line) => line.receivedQty), item.received);
    assert.deepEqual(receipt.lines.map((line) => line.acceptedQty), item.accepted);
    assert.deepEqual(receipt.lines.map((line) => line.rejectedQty),
      item.received.map((quantity, index) => quantity - item.accepted[index]));
    assert.ok(receipt.lines.every((line) => line.batchNo.startsWith('SAMPLE-BATCH-')));
    assert.ok(receipt.lines.every((line) => line.expiryDate >= receipt.receivedDate));
    assert.match(receipt.receivedBy, /fictional sample/);
    assert.equal(isSamplePR(receipt), true);
  }
  assert.equal(getPOFulfillment(poById.get('sample-po-2'), seeded.record.receipts), 'Closed');
  assert.equal(getPOFulfillment(poById.get('sample-po-4'), seeded.record.receipts), 'Partially Received');
  assert.equal(getPOFulfillment(poById.get('sample-po-5'), seeded.record.receipts), 'Partially Received',
    'physical receipt remains partially received even though all units were rejected');

  assert.deepEqual(seeded.record.events.map((event) => event.id),
    ['sample-pr-event-1', 'sample-pr-event-2', 'sample-pr-event-3', 'sample-pr-event-4', 'sample-pr-event-5']);
  for (const event of seeded.record.events) {
    const receipt = seeded.record.receipts.find((item) => item.id === event.receiptId);
    assert.ok(receipt);
    assert.equal(event.number, receipt.number);
    assert.equal(event.action, 'created');
    assert.equal(event.at, receipt.createdAt);
    assert.equal(event.actor, 'Sample Receiver (fictional, not signed in)');
    assert.match(event.summary, /Sample receipt created/);
  }
  assert.ok(requests.length);
  assert.ok(requests.every(({ name, options }) => name === PURCHASE_MUTATION_LOCK && options.mode === 'exclusive'));
  assert.deepEqual(seeded.record, JSON.parse(window.localStorage.getItem(PR_KEY)));
});

test('sample identity is strict and seeded receipts flow through document models and CSV as fictional', async () => {
  installLocks();
  const seeded = await guardedSeedSamplePRs(sampleSnapshot());
  const receipt = seeded.record.receipts.find((item) => item.id === 'sample-pr-1');
  assert.equal(isSamplePR(receipt), true);
  assert.equal(isSamplePR({ ...receipt, number: 'PR-SAMPLE-002' }), false);
  assert.equal(isSamplePR({ ...receipt, id: 'sample-pr-6', number: 'PR-SAMPLE-006' }), false);
  assert.equal(isSamplePR({ ...receipt, id: 'custom-pr', number: receipt.number }), false);
  assert.equal(isSamplePR({ id: 'sample-pr-1', number: 'PR-SAMPLE-001' }), true,
    'the helper relies on the strict persisted id/number identity convention');

  const normalized = normalizePRReceipt(receipt);
  assert.equal(normalized.isSample, true);
  assert.equal(normalized.hasHistoricalBalance, true);
  const document = makePRDocument(receipt, 'classic');
  assert.equal(document.number, receipt.number);
  assert.equal(document.model.isSample, true);
  assert.ok(document.pages.length);
  assert.ok(document.pages.every((page) => page.includes('Sample') || page.includes(receipt.number)));

  const csv = exportPRCSV(seeded.record.receipts, seeded.poRecord);
  assert.match(csv, /Sample · fictional · Local demo — not a financial invoice or stock-ledger entry/);
  assert.match(csv, /Example \(fictional sample\)/);
});

test('repeat seed clicks never overwrite seeded, deleted, or user-created receipt history', async () => {
  installLocks();
  const seeded = await guardedSeedSamplePRs(sampleSnapshot());
  const saved = window.localStorage.getItem(PR_KEY);
  await assert.rejects(guardedSeedSamplePRs(loadPRSnapshot()), /empty receipt workspace with no retained history/);
  assert.equal(window.localStorage.getItem(PR_KEY), saved);

  const deleted = await deletePR(seeded, seeded.record.receipts[0].id);
  const withDeletedHistory = window.localStorage.getItem(PR_KEY);
  await assert.rejects(guardedSeedSamplePRs(loadPRSnapshot()), /no retained history/);
  assert.equal(window.localStorage.getItem(PR_KEY), withDeletedHistory);
  assert.equal(deleted.record.receipts[0].status, 'deleted');
});

test('retained user-created receipt history blocks sample seeding without replacement', async () => {
  installLocks();
  const snapshot = sampleSnapshot();
  const po = snapshot.poRecord.orders.find((order) => order.id === 'sample-po-1');
  const custom = await createPR(snapshot, receiptValues(po));
  const raw = window.localStorage.getItem(PR_KEY);
  assert.equal(isSamplePR(custom.record.receipts[0]), false);
  await assert.rejects(guardedSeedSamplePRs(loadPRSnapshot()), /no retained history/);
  assert.equal(window.localStorage.getItem(PR_KEY), raw);
});

test('all-deleted sample history still blocks replacement when no active receipts remain', async () => {
  let snapshot = await guardedSeedSamplePRs(sampleSnapshot());
  for (const receipt of [...snapshot.record.receipts]) {
    snapshot = await deletePR(snapshot, receipt.id);
  }
  assert.equal(snapshot.record.receipts.filter((receipt) => receipt.status === 'active').length, 0);
  const before = rawStorageSnapshot();
  await assert.rejects(guardedSeedSamplePRs(snapshot), /no retained history/);
  assertStorageMatches(before);
});

test('user-created open POs are never used for sample receipts', async () => {
  installLocks();
  const snapshot = sampleSnapshot();
  const userPO = createOrder(snapshot, { poDate: '2026-10-01', expectedDate: '2026-10-02' });
  const afterCreate = loadPRSnapshot();
  const poRaw = window.localStorage.getItem(PO_KEY);
  const seeded = await guardedSeedSamplePRs(afterCreate);
  assert.ok(seeded.record.receipts.every((receipt) => receipt.poId !== userPO.id));
  assert.deepEqual(new Set(seeded.record.receipts.map((receipt) => receipt.poId)),
    new Set(['sample-po-1', 'sample-po-2', 'sample-po-4', 'sample-po-5']));
  assert.equal(window.localStorage.getItem(PO_KEY), poRaw);
});

test('required raw PR, PO, vendor, location, allergen and category keys must already exist', async () => {
  for (const missingKey of sampleRawKeys) {
    window.localStorage = storage();
    window.localStorage.setItem(PO_KEY, JSON.stringify({ version: 1, revision: 0, orders: [], events: [] }));
    installLocks();
    const snapshot = sampleSnapshot();
    const before = rawStorageSnapshot();
    window.localStorage.removeItem(missingKey);
    const withoutKey = rawStorageSnapshot();
    await assert.rejects(guardedSeedSamplePRs(snapshot), /unavailable|browser storage|removed data/i, missingKey);
    assert.equal(window.localStorage.getItem(missingKey), null, `${missingKey} must not be reinitialized`);
    for (const [key, value] of withoutKey) assert.equal(window.localStorage.getItem(key), value);
    assert.equal(before.has(missingKey), true);
  }
});

test('missing, deleted, or customized original sample orders fail closed without a PR write', async (t) => {
  const cases = [
    ['missing', (snapshot) => {
      const next = { ...snapshot.poRecord,
        orders: snapshot.poRecord.orders.filter((order) => order.id !== 'sample-po-4'),
        events: snapshot.poRecord.events.filter((event) => event.orderId !== 'sample-po-4') };
      next.revision = next.events.length;
      window.localStorage.setItem(PO_KEY, JSON.stringify(next));
    }],
    ['deleted', (snapshot) => {
      deletePO({ record: snapshot.poRecord }, 'sample-po-1');
    }],
    ['customized', (snapshot) => {
      const po = snapshot.poRecord.orders.find((order) => order.id === 'sample-po-1');
      updatePO({ record: snapshot.poRecord }, snapshot.refs, po.id, {
        poDate: po.poDate, expectedDate: new Date(Date.parse(`${po.poDate}T00:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10),
        vendorId: po.vendorId, locationId: po.locationId,
        lines: po.lines.map((line) => ({ productId: line.productId, quantity: String(line.quantity),
          unitPrice: String(line.unitPrice), gst: String(line.gst) })),
      });
    }],
  ];
  for (const [label, change] of cases) {
    await t.test(label, async () => {
      installLocks();
      const snapshot = sampleSnapshot();
      change(snapshot);
      const beforePR = window.localStorage.getItem(PR_KEY);
      await assert.rejects(guardedSeedSamplePRs(loadPRSnapshot()), /four original open sample orders/);
      assert.equal(window.localStorage.getItem(PR_KEY), beforePR);
    });
  }
});

test('removed sample vendor, active location, or active product prevents sample seeding', async (t) => {
  const cases = [
    ['vendor', VENDOR_KEY, 'sample-vendor-1'],
    ['location', STORAGE_LOCATION_KEY, 'sample-storage-location-1'],
    ['product', ALLERGEN_KEY, 'sample-allergen-1'],
  ];
  for (const [label, key, id] of cases) {
    await t.test(label, async () => {
      installLocks();
      const snapshot = sampleSnapshot();
      const records = JSON.parse(window.localStorage.getItem(key));
      window.localStorage.setItem(key, JSON.stringify(records.filter((record) => record.id !== id)));
      const beforePR = window.localStorage.getItem(PR_KEY);
      await assert.rejects(guardedSeedSamplePRs(loadPRSnapshot()), /active sample masters are required/);
      assert.equal(window.localStorage.getItem(PR_KEY), beforePR);
    });
  }
});

test('guarded sample seeding rejects incomplete or malformed snapshots and malformed saved data', async () => {
  installLocks();
  const snapshot = sampleSnapshot();
  const before = rawStorageSnapshot();
  await assert.rejects(guardedSeedSamplePRs(null), /incomplete/);
  await assert.rejects(guardedSeedSamplePRs({ ...snapshot, record: { ...snapshot.record, revision: -1 } }), /incomplete/);
  await assert.rejects(guardedSeedSamplePRs({ ...snapshot, poRecord: null }), /incomplete/);
  await assert.rejects(guardedSeedSamplePRs({ ...snapshot, refs: { vendors: [], locations: [] } }), /incomplete/);
  assertStorageMatches(before);

  window.localStorage.setItem(PR_KEY, '{broken');
  const malformedPR = window.localStorage.getItem(PR_KEY);
  await assert.rejects(guardedSeedSamplePRs(snapshot), /unreadable or invalid/);
  assert.equal(window.localStorage.getItem(PR_KEY), malformedPR);

  window.localStorage.setItem(PR_KEY, JSON.stringify({ version: 1, revision: 0, receipts: [], events: [] }));
  window.localStorage.setItem(PO_KEY, '{broken');
  const malformedPO = window.localStorage.getItem(PO_KEY);
  await assert.rejects(guardedSeedSamplePRs(snapshot), /purchase order data is unreadable or invalid/);
  assert.equal(window.localStorage.getItem(PO_KEY), malformedPO);
});

test('stale PR, PO, or master snapshots changed while the shared lock is queued are rejected', async (t) => {
  const changes = [
    ['PR', async (snapshot) => {
      const po = snapshot.poRecord.orders.find((order) => order.id === 'sample-po-1');
      const validRecord = (await createPR(snapshot, receiptValues(po))).record;
      window.localStorage.setItem(PR_KEY, JSON.stringify(snapshot.record));
      return () => window.localStorage.setItem(PR_KEY, JSON.stringify(validRecord));
    }, /Purchase Received records changed/],
    ['PO', async (snapshot) => {
      const originalPO = window.localStorage.getItem(PO_KEY);
      const extra = createPO({ record: snapshot.poRecord }, snapshot.refs,
        draftPO(snapshot, { poDate: '2026-10-01', expectedDate: '2026-10-02' }));
      const changedPO = JSON.stringify(extra);
      window.localStorage.setItem(PO_KEY, originalPO);
      return () => window.localStorage.setItem(PO_KEY, changedPO);
    }, /Purchase Orders changed/],
    ['master', async () => {
      const vendors = JSON.parse(window.localStorage.getItem(VENDOR_KEY));
      vendors[0] = { ...vendors[0], contactPersonName: 'Updated sample contact' };
      return () => window.localStorage.setItem(VENDOR_KEY, JSON.stringify(vendors));
    }, /Vendor, storage location or product masters changed/],
  ];
  for (const [label, prepareChange, expectedError] of changes) {
    await t.test(label, async () => {
      installLocks();
      const initial = sampleSnapshot();
      const applyChange = await prepareChange(initial);
      const snapshot = loadPRSnapshot();
      const lock = installQueuedLock();
      const pending = guardedSeedSamplePRs(snapshot);
      const rejected = assert.rejects(pending, expectedError);
      assert.deepEqual(lock.requests, [{ name: PURCHASE_MUTATION_LOCK, options: { mode: 'exclusive' } }]);
      applyChange();
      const competingPR = window.localStorage.getItem(PR_KEY);
      await lock.run();
      await rejected;
      assert.equal(window.localStorage.getItem(PR_KEY), competingPR,
        'a queued stale seed never overwrites the competing PR state');
    });
  }
});

test('storage read, write, and post-write verification failures preserve source data', async (t) => {
  const cases = [
    ['read failure', (snapshot) => {
      const getItem = window.localStorage.getItem;
      window.localStorage.getItem = (key) => {
        if (key === PO_KEY) throw new Error('blocked');
        return getItem(key);
      };
      return /Browser storage is unavailable/;
    }],
    ['write failure', () => {
      const setItem = window.localStorage.setItem;
      window.localStorage.setItem = (key, value) => {
        if (key === PR_KEY && JSON.parse(value).revision > 0) throw new Error('quota');
        return setItem(key, value);
      };
      return /could not be saved/;
    }],
    ['verification failure', () => {
      const setItem = window.localStorage.setItem;
      window.localStorage.setItem = (key, value) => {
        if (key === PR_KEY && JSON.parse(value).revision > 0) return;
        return setItem(key, value);
      };
      return /could not be verified after saving/;
    }],
  ];
  for (const [label, configure] of cases) {
    await t.test(label, async () => {
      installLocks();
      const snapshot = sampleSnapshot();
      const before = rawStorageSnapshot();
      const expected = configure(snapshot);
      await assert.rejects(guardedSeedSamplePRs(snapshot), expected);
      if (label === 'verification failure') {
        assert.equal(window.localStorage.getItem(PR_KEY), before.get(PR_KEY));
      } else {
        assertStorageMatches(before);
      }
    });
  }
});

test('unsupported Web Locks fail before touching the saved sample workspace', async () => {
  const snapshot = sampleSnapshot();
  const before = rawStorageSnapshot();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(guardedSeedSamplePRs(snapshot), /require browser Web Locks/);
  assertStorageMatches(before);
});