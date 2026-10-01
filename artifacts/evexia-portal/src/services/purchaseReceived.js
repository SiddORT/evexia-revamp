import { loadPOs, loadPOReferences, validPODate } from './purchaseOrders.js';
import { PR_KEY, withPurchaseMutationLock } from './purchaseMutationLock.js';

const LOCAL_ACTOR = 'Demo Admin (local, not signed in)';
const invalidPR = 'Saved Purchase Received data is unreadable or invalid. Nothing was changed. Back up or repair browser storage, then refresh.';
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const keysWithOptional = (value, required, optional) => value && typeof value === 'object' &&
  !Array.isArray(value) && required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const nonempty = (value) => typeof value === 'string' && value.length > 0 && value === value.trim();
const iso = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const quantityMilli = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
  return Math.round(number * 1000);
};
const blankQuantity = (value) => value === null || value === undefined ||
  (typeof value === 'string' && value.trim() === '');
const fromMilli = (value) => value / 1000;

const receiptKeys = ['id', 'number', 'poId', 'poNumber', 'poDate', 'receivedDate', 'receivedBy',
  'vendorId', 'vendorName', 'vendorPhone', 'locationId', 'locationName', 'status',
  'createdAt', 'updatedAt', 'deletedAt', 'lines'];
const optionalReceiptKeys = ['vendorAddress', 'vendorGstNo'];
const receiptLineKeys = ['lineId', 'productId', 'productName', 'orderedQty', 'receivedQty', 'acceptedQty',
  'rejectedQty', 'batchNo', 'expiryDate'];
const optionalReceiptLineKeys = ['balanceAfterQty'];
const eventKeys = ['id', 'receiptId', 'number', 'action', 'at', 'actor', 'summary'];

function validReceiptLine(line, receivedDate) {
  if (!keysWithOptional(line, receiptLineKeys, optionalReceiptLineKeys) ||
    !['lineId', 'productId', 'productName', 'batchNo'].every((key) => nonempty(line[key])) ||
    !validPODate(line.expiryDate) || line.expiryDate < receivedDate) return false;
  const ordered = quantityMilli(line.orderedQty);
  const received = quantityMilli(line.receivedQty);
  const accepted = quantityMilli(line.acceptedQty);
  const rejected = quantityMilli(line.rejectedQty);
  const balance = Object.hasOwn(line, 'balanceAfterQty') && line.balanceAfterQty !== null
    ? quantityMilli(line.balanceAfterQty) : null;
  return ordered !== null && received !== null && accepted !== null && rejected !== null &&
    ordered > 0 && received > 0 && accepted <= received && rejected === received - accepted &&
    (!Object.hasOwn(line, 'balanceAfterQty') || line.balanceAfterQty === null ||
      (balance !== null && balance <= ordered));
}

function validPRRecord(record) {
  if (!keys(record, ['version', 'revision', 'receipts', 'events']) || record.version !== 1 ||
    !Number.isSafeInteger(record.revision) || record.revision < 0 ||
    !Array.isArray(record.receipts) || !Array.isArray(record.events) ||
    record.receipts.some((receipt) => !receipt || typeof receipt !== 'object' || Array.isArray(receipt)) ||
    record.events.some((event) => !event || typeof event !== 'object' || Array.isArray(event)) ||
    new Set(record.receipts.map((receipt) => receipt?.id)).size !== record.receipts.length ||
    new Set(record.receipts.map((receipt) => receipt?.number)).size !== record.receipts.length ||
    new Set(record.events.map((event) => event?.id)).size !== record.events.length) return false;
  const receiptMap = new Map(record.receipts.map((receipt) => [receipt.id, receipt]));
  if (record.receipts.some((receipt) => {
    if (!keysWithOptional(receipt, receiptKeys, optionalReceiptKeys) || !['active', 'deleted'].includes(receipt.status) ||
      !['id', 'number', 'poId', 'poNumber', 'receivedBy', 'vendorId', 'vendorName', 'locationId', 'locationName']
        .every((key) => nonempty(receipt[key])) ||
      typeof receipt.vendorPhone !== 'string' || receipt.vendorPhone !== receipt.vendorPhone.trim() ||
      optionalReceiptKeys.some((key) => Object.hasOwn(receipt, key) &&
        (typeof receipt[key] !== 'string' || receipt[key] !== receipt[key].trim())) ||
      !validPODate(receipt.poDate) || !validPODate(receipt.receivedDate) || receipt.receivedDate < receipt.poDate ||
      !iso(receipt.createdAt) || !iso(receipt.updatedAt) || receipt.updatedAt < receipt.createdAt ||
      (receipt.status === 'deleted' ? !iso(receipt.deletedAt) || receipt.deletedAt !== receipt.updatedAt : receipt.deletedAt !== null) ||
      !Array.isArray(receipt.lines) || !receipt.lines.length || receipt.lines.length > 100 ||
      receipt.lines.some((line) => !line || typeof line !== 'object' || Array.isArray(line)) ||
      new Set(receipt.lines.map((line) => line?.lineId)).size !== receipt.lines.length) return true;
    return receipt.lines.some((line) => !validReceiptLine(line, receipt.receivedDate));
  })) return false;
  if (record.events.some((event) => !keys(event, eventKeys) || !nonempty(event.id) || !nonempty(event.receiptId) ||
    !nonempty(event.number) || !nonempty(event.actor) || !nonempty(event.summary) || !iso(event.at) ||
    !['created', 'updated', 'deleted'].includes(event.action) ||
    receiptMap.get(event.receiptId)?.number !== event.number)) return false;
  for (const receipt of record.receipts) {
    const events = record.events.filter((event) => event.receiptId === receipt.id).sort((a, b) => a.at.localeCompare(b.at));
    if (!events.length || events[0].action !== 'created' || events[0].at !== receipt.createdAt ||
      events.at(-1).at !== receipt.updatedAt || (receipt.status === 'deleted') !== (events.at(-1).action === 'deleted') ||
      events.slice(1, -1).some((event) => event.action !== 'updated')) return false;
  }
  return record.events.length === record.revision;
}

function readPRRecord() {
  let raw;
  try { raw = window.localStorage.getItem(PR_KEY); }
  catch { throw new Error('Purchase Received records could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = { version: 1, revision: 0, receipts: [], events: [] };
    try {
      if (window.localStorage.getItem(PR_KEY) !== null) return readPRRecord();
      window.localStorage.setItem(PR_KEY, JSON.stringify(initial));
    } catch { throw new Error('Purchase Received records could not be initialized in this browser. Check storage settings and refresh.'); }
    return initial;
  }
  let record;
  try { record = JSON.parse(raw); } catch { throw new Error(invalidPR); }
  if (!validPRRecord(record)) throw new Error(invalidPR);
  return record;
}

export function loadPRSnapshot() {
  const record = readPRRecord();
  const poRecord = loadPOs();
  const refs = loadPOReferences();
  const orders = new Map(poRecord.orders.map((po) => [po.id, po]));
  const acceptedTotals = new Map();
  for (const receipt of record.receipts.filter((item) => item.status === 'active')) {
    const po = orders.get(receipt.poId);
    const sourceMatches = po && po.status === 'open' && po.number === receipt.poNumber && po.poDate === receipt.poDate &&
      po.vendorId === receipt.vendorId && po.vendorName === receipt.vendorName &&
      po.locationId === receipt.locationId && po.locationName === receipt.locationName &&
      receipt.lines.every((line) => {
        const sourceLine = po.lines.find((item) => item.id === line.lineId);
        return sourceLine && sourceLine.productId === line.productId && sourceLine.productName === line.productName &&
          quantityMilli(sourceLine.quantity) === quantityMilli(line.orderedQty);
      });
    if (!sourceMatches) {
      throw new Error(`Saved Purchase Received data contains an orphaned or mismatched active receipt (${receipt.number}). Repair or back up browser storage before continuing.`);
    }
    for (const line of receipt.lines) {
      const key = `${receipt.poId}\u0000${line.lineId}`;
      acceptedTotals.set(key, (acceptedTotals.get(key) || 0) + quantityMilli(line.acceptedQty));
    }
  }
  for (const [poId, accepted] of acceptedTotals) {
    const [orderId, lineId] = poId.split('\u0000');
    const po = orders.get(orderId);
    const line = po?.lines.find((item) => item.id === lineId);
    if (!line || accepted > quantityMilli(line.quantity)) {
      throw new Error('Saved Purchase Received data contains over-accepted active quantities. Repair or back up browser storage before continuing.');
    }
  }
  return { record, poRecord, refs };
}

function snapshotIssue(snapshot) {
  if (!snapshot || !validPRRecord(snapshot.record) || !snapshot.poRecord ||
    !Array.isArray(snapshot.poRecord.orders) || !snapshot.refs ||
    !Array.isArray(snapshot.refs.vendors) || !Array.isArray(snapshot.refs.locations) ||
    !Array.isArray(snapshot.refs.products)) return 'Purchase Received data is incomplete. Refresh records before continuing.';
  return '';
}

function activeAcceptedForLine(receipts, lineId, excludeId = null) {
  return receipts.reduce((total, receipt) => receipt.id !== excludeId && receipt.status === 'active'
    ? total + receipt.lines.reduce((sum, line) => line.lineId === lineId ? sum + quantityMilli(line.acceptedQty) : sum, 0)
    : total, 0);
}

function balanceAfterForReceipt(po, receipts, lines, existing = null) {
  const byLine = new Map();
  for (const line of lines) {
    byLine.set(line.lineId, (byLine.get(line.lineId) || 0) + quantityMilli(line.acceptedQty));
  }
  if (existing) {
    const oldAccepted = new Map();
    for (const line of existing.lines) {
      oldAccepted.set(line.lineId, (oldAccepted.get(line.lineId) || 0) + quantityMilli(line.acceptedQty));
    }
    const historicalBefore = new Map();
    for (const line of existing.lines) {
      if (!Object.hasOwn(line, 'balanceAfterQty') || line.balanceAfterQty === null ||
        historicalBefore.has(line.lineId)) continue;
      historicalBefore.set(line.lineId,
        quantityMilli(line.balanceAfterQty) + (oldAccepted.get(line.lineId) || 0));
    }
    return lines.map((line) => {
      const before = historicalBefore.get(line.lineId);
      const after = before === undefined ? null : before - (byLine.get(line.lineId) || 0);
      return {
        ...line,
        balanceAfterQty: after === null || after < 0 ? null : fromMilli(after),
      };
    });
  }
  const before = new Map();
  for (const sourceLine of po.lines) {
    const acceptedBefore = receipts.reduce((total, receipt) => {
      if (receipt.poId !== po.id || receipt.status !== 'active') return total;
      return total + receipt.lines.reduce((sum, line) =>
        line.lineId === sourceLine.id ? sum + quantityMilli(line.acceptedQty) : sum, 0);
    }, 0);
    before.set(sourceLine.id, Math.max(0, quantityMilli(sourceLine.quantity) - acceptedBefore));
  }
  return lines.map((line) => {
    const balanceBefore = before.get(line.lineId) ?? 0;
    return { ...line, balanceAfterQty: fromMilli(Math.max(0, balanceBefore - (byLine.get(line.lineId) || 0))) };
  });
}

export function getPOBalances(po, receipts, excludeId = null) {
  return Object.fromEntries((po?.lines || []).map((line) => {
    const ordered = quantityMilli(line.quantity) ?? 0;
    const accepted = activeAcceptedForLine((receipts || []).filter((receipt) => receipt.poId === po?.id),
      line.id, excludeId);
    return [line.id, fromMilli(Math.max(0, ordered - accepted))];
  }));
}

export function getPOFulfillment(po, receipts) {
  const active = (receipts || []).filter((receipt) => receipt.status === 'active' && receipt.poId === po?.id);
  if (!active.some((receipt) => receipt.lines.some((line) => quantityMilli(line.receivedQty) > 0))) return 'Open';
  const balances = getPOBalances(po, active);
  return po.lines.every((line) => quantityMilli(balances[line.id]) === 0) ? 'Closed' : 'Partially Received';
}

export function validatePR(values, snapshot, existing = null) {
  const errors = {};
  const issue = snapshotIssue(snapshot);
  if (issue) return { errors: { form: issue }, receipt: null };
  if (!keys(values, ['poId', 'receivedDate', 'receivedBy', 'lines']) || !Array.isArray(values.lines)) {
    return { errors: { form: 'Purchase Received data contains unsupported fields.' }, receipt: null };
  }
  if (existing) {
    const current = snapshot.record.receipts.find((receipt) => receipt.id === existing.id);
    if (!current || !same(current, existing)) {
      return { errors: { form: 'This Purchase Received record changed. Refresh records before editing.' }, receipt: null };
    }
  }
  if (existing && (existing.status !== 'active' || values.poId !== existing.poId)) {
    errors.poId = 'An existing receipt must remain linked to its original active Purchase Order.';
  }
  const po = snapshot.poRecord.orders.find((order) => order.id === values.poId);
  if (!po || po.status !== 'open') errors.poId = 'Choose an available, non-deleted Purchase Order.';
  if (!validPODate(values.receivedDate)) errors.receivedDate = 'Enter a valid received date.';
  else if (po && values.receivedDate < po.poDate) errors.receivedDate = 'Received date cannot be before the PO date.';
  const receivedBy = typeof values.receivedBy === 'string' ? values.receivedBy.trim() : '';
  if (!receivedBy || receivedBy.length > 120) errors.receivedBy = 'Enter the recorded receiver name (up to 120 characters).';
  if (!values.lines.length || values.lines.length > 100) errors.lines = 'Add at least one positive receipt row (up to 100 rows).';

  const balances = po ? getPOBalances(po, snapshot.record.receipts, existing?.id) : {};
  const usedLineIds = new Set();
  const lines = values.lines.map((input, index) => {
    const prefix = `lines.${index}`;
    if (!keys(input, ['lineId', 'receivedQty', 'acceptedQty', 'batchNo', 'expiryDate'])) {
      errors[`${prefix}.lineId`] = 'Receipt row contains unsupported fields.';
      return null;
    }
    if (typeof input.lineId !== 'string' || !input.lineId.trim()) {
      errors[`${prefix}.lineId`] = 'Choose a product row from the selected PO.';
      return null;
    }
    if (usedLineIds.has(input.lineId)) errors[`${prefix}.lineId`] = 'A PO product row can only appear once per receipt.';
    usedLineIds.add(input.lineId);
    const poLine = po?.lines.find((line) => line.id === input.lineId);
    if (!poLine) errors[`${prefix}.lineId`] = 'This product row does not belong to the selected PO.';
    const receivedBlank = blankQuantity(input.receivedQty);
    const acceptedBlank = blankQuantity(input.acceptedQty);
    if (receivedBlank && acceptedBlank) return null;
    const received = receivedBlank ? null : quantityMilli(input.receivedQty);
    const accepted = acceptedBlank ? null : quantityMilli(input.acceptedQty);
    if (receivedBlank && accepted === 0) return null;
    if (receivedBlank) errors[`${prefix}.receivedQty`] = 'Received quantity is required when an accepted quantity is entered.';
    else if (received === null) errors[`${prefix}.receivedQty`] = 'Enter a non-negative quantity up to 3 decimal places.';
    if (acceptedBlank && received !== null && received > 0) {
      errors[`${prefix}.acceptedQty`] = 'Accepted quantity is required for a positive receipt row.';
    } else if (!acceptedBlank && accepted === null) {
      errors[`${prefix}.acceptedQty`] = 'Enter an accepted quantity up to 3 decimal places.';
    }
    if (received !== null && received === 0) {
      if (accepted !== null && accepted > 0) errors[`${prefix}.acceptedQty`] = 'Accepted quantity cannot exceed received quantity.';
      return null;
    }
    if (received === null) return null;
    if (received !== null && received > 0 && accepted !== null && accepted > received) {
      errors[`${prefix}.acceptedQty`] = 'Accepted quantity cannot exceed received quantity.';
    }
    const available = quantityMilli(balances[input.lineId] ?? 0);
    const historicalLine = existing?.lines.find((line) => line.lineId === input.lineId);
    const historicalReceived = historicalLine ? quantityMilli(historicalLine.receivedQty) : 0;
    // Later receipts can accept units this saved receipt rejected. Preserve
    // historical receiving on corrections without granting new receiving capacity.
    const receivedLimit = Math.max(available, historicalReceived);
    if (poLine && received > receivedLimit) {
      errors[`${prefix}.receivedQty`] = historicalReceived > available
        ? `New or increased receiving cannot exceed the available balance of ${balances[input.lineId]}. You may retain or reduce the saved received quantity of ${historicalLine.receivedQty}.`
        : `Received quantity cannot exceed the available balance of ${balances[input.lineId]}.`;
    }
    if (poLine && accepted !== null && accepted > available) {
      errors[`${prefix}.acceptedQty`] = `Accepted quantity cannot exceed the available balance of ${balances[input.lineId]} after other active receipts.`;
    }
    const batchNo = typeof input.batchNo === 'string' ? input.batchNo.trim() : '';
    if (received !== null && received > 0 && !batchNo) errors[`${prefix}.batchNo`] = 'Batch number is required for a positive receipt row.';
    if (received !== null && received > 0 && !validPODate(values.receivedDate)) {
      errors.receivedDate = 'Enter a valid received date before validating expiry.';
    }
    if (received !== null && received > 0 && !validPODate(input.expiryDate)) {
      errors[`${prefix}.expiryDate`] = 'Enter a valid expiry date for each positive receipt row.';
    } else if (received !== null && received > 0 && validPODate(values.receivedDate) && input.expiryDate < values.receivedDate) {
      errors[`${prefix}.expiryDate`] = 'Expiry date cannot be before the received date.';
    }
    if (!poLine || received === null || received === 0 || accepted === null) return null;
    return { lineId: poLine.id, productId: poLine.productId, productName: poLine.productName,
      orderedQty: poLine.quantity, receivedQty: fromMilli(received), acceptedQty: fromMilli(accepted),
      rejectedQty: fromMilli(received - accepted), batchNo, expiryDate: input.expiryDate };
  });
  const positiveLines = lines.filter(Boolean);
  if (!positiveLines.length && !errors.lines) errors.lines = 'Enter at least one positive received quantity.';
  const vendor = po && snapshot.refs.vendors.find((item) => item.id === po.vendorId);
  const savedLines = po ? balanceAfterForReceipt(po, snapshot.record.receipts, positiveLines, existing) : positiveLines;
  return {
    errors,
    receipt: Object.keys(errors).length ? null : {
      poId: po.id, poNumber: po.number, poDate: po.poDate, receivedDate: values.receivedDate,
      receivedBy, vendorId: po.vendorId, vendorName: po.vendorName,
      vendorPhone: snapshot.refs.vendors.find((vendor) => vendor.id === po.vendorId)?.phoneNo || '',
      vendorAddress: vendor?.registeredAddress || '', vendorGstNo: vendor?.gstNo || '',
      locationId: po.locationId, locationName: po.locationName, lines: savedLines,
    },
  };
}

function timestamp(previous = null) {
  return new Date(Math.max(Date.now(), Date.parse(previous || 0) + 1)).toISOString();
}

function persistPR(snapshot, next) {
  const currentRecord = readPRRecord();
  const currentPOs = loadPOs();
  const currentRefs = loadPOReferences();
  if (!same(currentRecord, snapshot.record)) {
    throw new Error('Purchase Received records changed in another tab. Refresh records before saving; your draft was not saved.');
  }
  if (!same(currentPOs, snapshot.poRecord)) {
    throw new Error('Purchase Orders changed in another tab. Refresh records and review available balances before saving.');
  }
  if (!same(currentRefs, snapshot.refs)) {
    throw new Error('Vendor, storage location or product masters changed. Refresh records before saving.');
  }
  if (!validPRRecord(next)) throw new Error('Purchase Received data could not be validated. Nothing was saved.');
  try {
    if (!same(readPRRecord(), currentRecord)) {
      throw new Error('Purchase Received records changed in another tab. Refresh records before saving.');
    }
    window.localStorage.setItem(PR_KEY, JSON.stringify(next));
    if (!same(readPRRecord(), next)) throw new Error('Purchase Received records could not be verified after saving. Refresh and inspect browser storage.');
  } catch (error) {
    if (error instanceof Error && /changed in another tab|could not be verified/.test(error.message)) throw error;
    throw new Error('Purchase Received records could not be saved in this browser. Check storage settings and try again.');
  }
}

function appendEvent(snapshot, receipts, receipt, action, summary) {
  const at = receipt.updatedAt;
  const event = { id: crypto.randomUUID(), receiptId: receipt.id, number: receipt.number, action,
    at, actor: LOCAL_ACTOR, summary };
  const next = { version: 1, revision: snapshot.record.revision + 1, receipts,
    events: [...snapshot.record.events, event] };
  persistPR(snapshot, next);
  return next;
}

function validated(values, snapshot, existing = null) {
  const result = validatePR(values, snapshot, existing);
  if (Object.keys(result.errors).length) throw new Error(Object.values(result.errors)[0]);
  return result.receipt;
}

function receiptSummary(receipt, action) {
  const accepted = receipt.lines.filter((line) => quantityMilli(line.acceptedQty) > 0).length;
  const rejected = receipt.lines.filter((line) => quantityMilli(line.rejectedQty) > 0).length;
  return `${action} · ${receipt.lines.length} line${receipt.lines.length === 1 ? '' : 's'} · ${accepted} accepted line${accepted === 1 ? '' : 's'} · ${rejected} rejected line${rejected === 1 ? '' : 's'}`;
}

function receiptUpdateSummary(old, next) {
  const changes = [];
  const addChange = (label, before, after) => {
    if (before !== after) changes.push(`${label}: ${before || '—'} → ${after || '—'}`);
  };
  addChange('Received date', old.receivedDate, next.receivedDate);
  addChange('Received by', old.receivedBy, next.receivedBy);
  const previousLines = new Map(old.lines.map((line) => [line.lineId, line]));
  const nextLines = new Map(next.lines.map((line) => [line.lineId, line]));
  for (const [lineId, before] of previousLines) {
    const after = nextLines.get(lineId);
    const label = `${before.productName} [line ${lineId}]`;
    if (!after) {
      changes.push(`Removed ${label} (received ${before.receivedQty}, accepted ${before.acceptedQty}, rejected ${before.rejectedQty})`);
      continue;
    }
    const details = [];
    for (const field of ['receivedQty', 'acceptedQty', 'rejectedQty']) {
      if (before[field] !== after[field]) details.push(`${field.replace('Qty', '')}: ${before[field]} → ${after[field]}`);
    }
    for (const field of ['batchNo', 'expiryDate']) {
      if (before[field] !== after[field]) details.push(`${field === 'batchNo' ? 'batch' : 'expiry'}: ${before[field] || '—'} → ${after[field] || '—'}`);
    }
    if (details.length) changes.push(`${label} ${details.join(', ')}`);
  }
  for (const [lineId, line] of nextLines) {
    if (!previousLines.has(lineId)) {
      changes.push(`Added ${line.productName} [line ${lineId}] (received ${line.receivedQty}, accepted ${line.acceptedQty}, rejected ${line.rejectedQty}, batch ${line.batchNo}, expiry ${line.expiryDate})`);
    }
  }
  return `Updated · ${changes.join('; ')}`;
}

function assertFreshSnapshot(snapshot) {
  const issue = snapshotIssue(snapshot);
  if (issue) throw new Error(issue);
  const current = loadPRSnapshot();
  if (!same(current.record, snapshot.record)) {
    throw new Error('Purchase Received records changed in another tab. Refresh records before saving; your draft was not saved.');
  }
  if (!same(current.poRecord, snapshot.poRecord)) {
    throw new Error('Purchase Orders changed in another tab. Refresh records and review available balances before saving.');
  }
  if (!same(current.refs, snapshot.refs)) {
    throw new Error('Vendor, storage location or product masters changed. Refresh records before saving.');
  }
}

export async function createPR(snapshot, values) {
  return withPurchaseMutationLock(() => {
    assertFreshSnapshot(snapshot);
    const fields = validated(values, snapshot);
    const now = timestamp(snapshot.record.events.at(-1)?.at);
    const receipt = { ...fields, id: crypto.randomUUID(),
      number: `PR-${fields.receivedDate.replaceAll('-', '')}-${String(snapshot.record.revision + 1).padStart(5, '0')}`,
      status: 'active', createdAt: now, updatedAt: now, deletedAt: null };
    const receipts = [receipt, ...snapshot.record.receipts];
    appendEvent(snapshot, receipts, receipt, 'created', receiptSummary(receipt, 'Created'));
    return loadPRSnapshot();
  });
}

export async function updatePR(snapshot, id, values) {
  return withPurchaseMutationLock(() => {
    assertFreshSnapshot(snapshot);
    const old = snapshot.record.receipts.find((receipt) => receipt.id === id);
    if (!old || old.status !== 'active') throw new Error('This Purchase Received record is unavailable or deleted.');
    const fields = validated(values, snapshot, old);
    const comparableLines = (lines) => lines.map((line) => {
      const copy = { ...line };
      delete copy.balanceAfterQty;
      return copy;
    });
    const oldValues = { poId: old.poId, receivedDate: old.receivedDate, receivedBy: old.receivedBy, lines: comparableLines(old.lines) };
    const nextValues = { poId: fields.poId, receivedDate: fields.receivedDate, receivedBy: fields.receivedBy, lines: comparableLines(fields.lines) };
    if (same(oldValues, nextValues)) throw new Error('No changes to save.');
    const receipt = { ...old, ...fields, vendorPhone: old.vendorPhone,
      ...(Object.hasOwn(old, 'vendorAddress') ? { vendorAddress: old.vendorAddress } : { vendorAddress: undefined }),
      ...(Object.hasOwn(old, 'vendorGstNo') ? { vendorGstNo: old.vendorGstNo } : { vendorGstNo: undefined }),
      updatedAt: timestamp(snapshot.record.events.at(-1)?.at || old.updatedAt) };
    if (receipt.vendorAddress === undefined) delete receipt.vendorAddress;
    if (receipt.vendorGstNo === undefined) delete receipt.vendorGstNo;
    const receipts = snapshot.record.receipts.map((item) => item.id === id ? receipt : item);
    appendEvent(snapshot, receipts, receipt, 'updated', receiptUpdateSummary(old, receipt));
    return loadPRSnapshot();
  });
}

export async function deletePR(snapshot, id) {
  return withPurchaseMutationLock(() => {
    assertFreshSnapshot(snapshot);
    const old = snapshot.record.receipts.find((receipt) => receipt.id === id);
    if (!old || old.status !== 'active') throw new Error('This Purchase Received record is unavailable or already deleted.');
    const at = timestamp(snapshot.record.events.at(-1)?.at || old.updatedAt);
    const receipt = { ...old, status: 'deleted', deletedAt: at, updatedAt: at };
    const receipts = snapshot.record.receipts.map((item) => item.id === id ? receipt : item);
    appendEvent(snapshot, receipts, receipt, 'deleted', receiptSummary(receipt, 'Deleted'));
    return loadPRSnapshot();
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function filterPRs(receipts, poRecord, {
  search = '', from = '', to = '', vendorId = '', receivedBy = '', fulfillment = '',
  status = 'active', sort = 'recent',
} = {}) {
  const query = search.trim().toLocaleLowerCase();
  const orders = new Map((poRecord?.orders || []).map((po) => [po.id, po]));
  const filtered = (receipts || []).filter((receipt) => {
    const po = orders.get(receipt.poId);
    const haystack = [receipt.number, receipt.poNumber, receipt.vendorName, receipt.vendorPhone, receipt.receivedBy,
      ...receipt.lines.map((line) => line.productName)].join(' ').toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (!from || receipt.receivedDate >= from) &&
      (!to || receipt.receivedDate <= to) && (!vendorId || receipt.vendorId === vendorId) &&
      (!receivedBy || receipt.receivedBy.toLocaleLowerCase().includes(receivedBy.trim().toLocaleLowerCase())) &&
      (!fulfillment || fulfillment === 'all' || (po && getPOFulfillment(po, receipts) === fulfillment)) &&
      (status === 'all' || receipt.status === (status === 'deleted' ? 'deleted' : 'active'));
  });
  const direction = sort === 'oldest' ? 1 : -1;
  if (sort === 'number') return filtered.sort((a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
  return filtered.sort((a, b) => direction * (a.receivedDate.localeCompare(b.receivedDate) ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}

const csvHeaders = ['Document Type', 'Record Context', 'PR Number', 'PR Status', 'Received Date', 'Received By',
  'PO Number', 'PO Date', 'Vendor', 'Vendor Phone', 'Destination', 'Product', 'Batch Number',
  'Ordered Qty', 'Received Qty', 'Accepted Qty', 'Rejected Qty', 'Expiry Date'];

export function exportPRCSV(receipts, poRecord) {
  const rows = (receipts || []).flatMap((receipt) => receipt.lines.map((line) => {
    return ['Purchase Received', 'Local demo — not a financial invoice or stock-ledger entry', receipt.number, receipt.status === 'deleted' ? 'Deleted' : 'Active',
      receipt.receivedDate, receipt.receivedBy, receipt.poNumber, receipt.poDate, receipt.vendorName,
      receipt.vendorPhone, receipt.locationName, line.productName, line.batchNo, line.orderedQty,
      line.receivedQty, line.acceptedQty, line.rejectedQty, line.expiryDate];
  }));
  return '\uFEFF' + [csvHeaders, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export { PR_KEY };