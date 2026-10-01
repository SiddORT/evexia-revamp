import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PR_KEY, loadPRSnapshot, validatePR, getPOBalances, getPOFulfillment,
  createPR, updatePR, deletePR, filterPRs, exportPRCSV,
} from './purchaseReceived.js';
import { PO_KEY, createPO, updatePO, deletePO, guardedCreatePO } from './purchaseOrders.js';
import { VENDOR_KEY } from './vendors.js';

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
  assert.equal(getPOBalances(po, first.record.receipts)[lineId], 7.875);
  assert.equal(getPOBalances(po, [{ ...pr1, poId: 'different-po' }])[lineId], 10);
  assert.equal(getPOFulfillment(po, first.record.receipts), 'Partially Received');

  const second = await createPR(first, receiptValues(po, [{ receivedQty: '7.875', acceptedQty: '7.875' }]));
  assert.equal(getPOBalances(po, second.record.receipts)[lineId], 0);
  assert.equal(getPOFulfillment(po, second.record.receipts), 'Closed');
  assert.ok(validatePR(receiptValues(po, [{ receivedQty: '0.001' }]), second).errors['lines.0.receivedQty']);

  const pr2 = second.record.receipts.find((receipt) => receipt.id !== pr1.id);
  const edited = await updatePR(second, pr2.id,
    receiptValues(po, [{ receivedQty: '7.875', acceptedQty: '7.875', batchNo: 'BATCH-EDIT' }]));
  assert.equal(edited.record.receipts.find((receipt) => receipt.id === pr1.id).number, pr1.number);
  assert.equal(getPOFulfillment(po, edited.record.receipts), 'Closed');
  assert.equal(edited.record.events.at(-1).action, 'updated');
  assert.equal(edited.record.events.at(-1).actor, 'Demo Admin (local, not signed in)');
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
  assert.equal(getPOFulfillment(po, snapshot.record.receipts), 'Closed');

  const reduceAcceptance = { ...correction, lines: [{ ...correction.lines[0], acceptedQty: '4' }] };
  snapshot = await updatePR(snapshot, firstId, reduceAcceptance);
  assert.equal(getPOBalances(po, snapshot.record.receipts)[po.lines[0].id], 1);
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

test('preserves saved vendor phone on edit and records detailed old-to-new activity', async () => {
  installLocks();
  const snapshot = loadPRSnapshot();
  const po = createOrder(snapshot);
  const created = await createPR(loadPRSnapshot(), receiptValues(po));
  const original = created.record.receipts[0];
  const vendorRecords = JSON.parse(window.localStorage.getItem(VENDOR_KEY));
  window.localStorage.setItem(VENDOR_KEY, JSON.stringify(vendorRecords.map((vendor) =>
    vendor.id === original.vendorId ? { ...vendor, phoneNo: '9999999999' } : vendor)));
  const refreshed = loadPRSnapshot();
  const updated = await updatePR(refreshed, original.id, receiptValues(po, [{
    receivedQty: '3', acceptedQty: '2.5', batchNo: 'BATCH-UPDATED', expiryDate: '2028-01-01',
  }], { receivedDate: '2026-10-01', receivedBy: 'Updated Receiver' }));
  const receipt = updated.record.receipts.find((item) => item.id === original.id);
  assert.equal(receipt.vendorPhone, original.vendorPhone);
  const summary = updated.record.events.at(-1).summary;
  for (const phrase of ['Received date: 2026-09-30 → 2026-10-01',
    'Received by: Local Receiver → Updated Receiver', 'received: 2 → 3', 'accepted: 2 → 2.5',
    'rejected: 0 → 0.5', 'batch: BATCH-1 → BATCH-UPDATED', 'expiry: 2027-09-30 → 2028-01-01']) {
    assert.ok(summary.includes(phrase), phrase);
  }
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