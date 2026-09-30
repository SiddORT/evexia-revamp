import { loadVendors } from './vendors.js';
import { loadStorageLocations } from './storageLocations.js';
import { loadAllergenReferences, loadAllergens } from './allergens.js';

export const PO_KEY = 'evexia.admin.purchase-orders.v1';
const LOCAL_ACTOR = 'Demo Admin (local, not signed in)';
const SAMPLE_ACTOR = 'Sample Admin (demo data)';
export function poEventActor(event) {
  return event.actor || (/^sample-po-event-\d+$/.test(event.id) ? SAMPLE_ACTOR : 'Not recorded (earlier activity)');
}
const invalid = 'Saved purchase order data is unreadable or invalid. Nothing was changed. Back up or repair browser storage, then refresh.';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const iso = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
export const validPODate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const amount = (value, max, decimals = 2, min = 0) => {
  const text = String(value ?? '').trim();
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) && num >= min && num <= max ? num : null;
};
const fixed = (value, scale) => Math.round(value * scale);
export const money = (paise) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100);

export function calculateLine(line) {
  const quantity = amount(line.quantity, 1000000, 3, 0.001);
  const unitPrice = amount(line.unitPrice, 10000000);
  const gst = amount(line.gst, 100);
  if (quantity === null || unitPrice === null || gst === null) return null;
  const subtotal = Math.round(fixed(quantity, 1000) * fixed(unitPrice, 100) / 1000);
  const gstAmount = Math.round(subtotal * fixed(gst, 100) / 10000);
  const total = subtotal + gstAmount;
  if (!Number.isSafeInteger(total) || total > 10000000000) return null;
  return { subtotal, gstAmount, total };
}

export function totals(lines) {
  const result = { subtotal: 0, gstAmount: 0, total: 0 };
  for (const line of lines) {
    const part = calculateLine(line);
    if (!part) return null;
    for (const field of Object.keys(result)) result[field] += part[field];
  }
  return result.total <= 10000000000 && Number.isSafeInteger(result.total) ? result : null;
}

export function loadPOReferences() {
  const vendorList = loadVendors();
  const locations = loadStorageLocations();
  const allergenRefs = loadAllergenReferences();
  const products = loadAllergens(allergenRefs);
  return { vendors: vendorList, locations, products };
}

export function validatePO(values, refs, existing = null) {
  const errors = {};
  if (!values || !keys(values, ['poDate', 'expectedDate', 'vendorId', 'locationId', 'lines']) || !Array.isArray(values.lines)) {
    return { errors: { form: 'Purchase order data contains unsupported fields.' }, order: null };
  }
  if (!validPODate(values.poDate)) errors.poDate = 'Enter a valid PO date.';
  if (!validPODate(values.expectedDate) || (validPODate(values.poDate) && values.expectedDate < values.poDate)) {
    errors.expectedDate = 'Expected delivery must be a valid date on or after the PO date.';
  }
  const selected = {};
  for (const [field, list, label, nameField, active] of [
    ['vendorId', refs.vendors, 'saved vendor', 'vendorName', false],
    ['locationId', refs.locations, 'active storage location', 'name', true],
  ]) {
    const found = list.find((item) => item.id === values[field]);
    const retained = existing?.[field] === values[field] && existing?.[field === 'vendorId' ? 'vendorName' : 'locationName'];
    if (typeof values[field] !== 'string' || !values[field] || (!found && !retained) ||
      (active && found?.status !== 'active' && !retained)) errors[field] = `Choose a ${label} from the current master.`;
    selected[field] = retained || found?.[nameField];
  }
  if (!values.lines.length || values.lines.length > 100) errors.lines = 'Add between 1 and 100 product rows.';
  const lines = values.lines.map((line, i) => {
    if (!keys(line, ['productId', 'quantity', 'unitPrice', 'gst'])) {
      errors[`lines.${i}.productId`] = 'Product row contains unsupported fields.';
      return null;
    }
    const found = refs.products.find((item) => item.id === line.productId);
    const retained = existing?.lines[i]?.productId === line.productId && existing.lines[i].productName;
    if (typeof line.productId !== 'string' || !line.productId || (!found && !retained) ||
      (found?.status !== 'active' && !retained)) errors[`lines.${i}.productId`] = 'Choose an active saved product.';
    const quantity = amount(line.quantity, 1000000, 3, 0.001);
    const unitPrice = amount(line.unitPrice, 10000000);
    const gst = amount(line.gst, 100);
    if (quantity === null) errors[`lines.${i}.quantity`] = 'Enter a positive quantity (up to 3 decimal places).';
    if (unitPrice === null) errors[`lines.${i}.unitPrice`] = 'Enter a non-negative price in INR (up to 2 decimals).';
    if (gst === null) errors[`lines.${i}.gst`] = 'Enter GST from 0 to 100% (up to 2 decimals).';
    const figures = calculateLine(line);
    if (!figures) errors[`lines.${i}.total`] = 'Line amount exceeds the safe limit or contains invalid numbers.';
    return figures ? { productId: line.productId, productName: retained || found?.name, quantity, unitPrice, gst, ...figures } : null;
  });
  const figures = totals(values.lines);
  if (!figures) errors.form = 'PO total exceeds ₹10 crore or contains invalid amounts.';
  return { errors, order: Object.keys(errors).length ? null : {
    poDate: values.poDate, expectedDate: values.expectedDate, vendorId: values.vendorId, vendorName: selected.vendorId,
    locationId: values.locationId, locationName: selected.locationId, lines, ...figures,
  } };
}

const orderKeys = ['id', 'number', 'poDate', 'expectedDate', 'vendorId', 'vendorName', 'locationId', 'locationName', 'lines',
  'subtotal', 'gstAmount', 'total', 'status', 'createdAt', 'updatedAt', 'deletedAt'];
const lineKeys = ['productId', 'productName', 'quantity', 'unitPrice', 'gst', 'subtotal', 'gstAmount', 'total'];
const eventKeys = ['id', 'orderId', 'number', 'action', 'at', 'summary'];
const nonempty = (v) => typeof v === 'string' && v.length > 0 && v === v.trim();
function validRecord(record) {
  if (!keys(record, ['version', 'revision', 'orders', 'events']) || record.version !== 1 ||
    !Number.isSafeInteger(record.revision) || record.revision < 0 ||
    !Array.isArray(record.orders) || !Array.isArray(record.events) ||
    new Set(record.orders.map((o) => o?.id)).size !== record.orders.length ||
    new Set(record.orders.map((o) => o?.number)).size !== record.orders.length ||
    new Set(record.events.map((e) => e?.id)).size !== record.events.length) return false;
  const orderMap = new Map(record.orders.map((o) => [o.id, o]));
  if (record.orders.some((o) => {
    if (!keys(o, orderKeys) || !['open', 'deleted'].includes(o.status) ||
      !['id', 'number', 'vendorId', 'vendorName', 'locationId', 'locationName'].every((k) => nonempty(o[k])) ||
      !validPODate(o.poDate) || !validPODate(o.expectedDate) || o.expectedDate < o.poDate ||
      !iso(o.createdAt) || !iso(o.updatedAt) || o.updatedAt < o.createdAt ||
      (o.status === 'deleted' ? !iso(o.deletedAt) || o.deletedAt !== o.updatedAt : o.deletedAt !== null) ||
      !Array.isArray(o.lines) || !o.lines.length || o.lines.length > 100) return true;
    if (o.lines.some((l) => !keys(l, lineKeys) || !nonempty(l.productId) || !nonempty(l.productName) ||
      !same(calculateLine(l), { subtotal: l.subtotal, gstAmount: l.gstAmount, total: l.total }))) return true;
    return !same(totals(o.lines), { subtotal: o.subtotal, gstAmount: o.gstAmount, total: o.total });
  })) return false;
  if (record.events.some((e) => !(keys(e, eventKeys) || keys(e, [...eventKeys, 'actor'])) ||
    !nonempty(e.id) || !nonempty(e.summary) || (Object.hasOwn(e, 'actor') && !nonempty(e.actor)) || !iso(e.at) ||
    !['created', 'updated', 'deleted'].includes(e.action) || orderMap.get(e.orderId)?.number !== e.number)) return false;
  for (const o of record.orders) {
    const events = record.events.filter((e) => e.orderId === o.id).sort((a, b) => a.at.localeCompare(b.at));
    if (!events.length || events[0].action !== 'created' || events[0].at !== o.createdAt ||
      events.at(-1).at !== o.updatedAt || (o.status === 'deleted') !== (events.at(-1).action === 'deleted') ||
      events.slice(1, -1).some((e) => e.action !== 'updated')) return false;
  }
  return record.events.length === record.revision;
}

function samplePOs() {
  const refs = loadPOReferences();
  const vendors = [1, 2, 3].map((n) => refs.vendors.find((item) => item.id === `sample-vendor-${n}`));
  const locations = [1, 2].map((n) => refs.locations.find((item) => item.id === `sample-storage-location-${n}` && item.status === 'active'));
  const products = [1, 2].map((n) => refs.products.find((item) => item.id === `sample-allergen-${n}` && item.status === 'active'));
  // Do not attach invented purchases to a user's own masters if the sample masters were removed.
  if ([...vendors, ...locations, ...products].some((item) => !item)) return null;
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const at = (days) => `${daysAgo(days)}T09:15:00.000Z`;
  const specs = [
    { days: 8, vendor: 0, location: 0, lines: [[0, '24', '425', '12'], [1, '12', '115.5', '18']] },
    { days: 7, vendor: 1, location: 1, lines: [[1, '60', '120', '18']] },
    { days: 6, vendor: 2, location: 0, lines: [[0, '15', '440', '12']] },
    { days: 5, vendor: 0, location: 1, lines: [[1, '32', '118', '18'], [0, '8', '450', '12']] },
    { days: 4, vendor: 1, location: 0, lines: [[0, '20', '430', '12']] },
  ];
  const orders = [];
  const events = [];
  for (const [index, spec] of specs.entries()) {
    const values = {
      poDate: daysAgo(spec.days), expectedDate: daysAgo(spec.days - 4),
      vendorId: vendors[spec.vendor].id, locationId: locations[spec.location].id,
      lines: spec.lines.map(([product, quantity, unitPrice, gst]) =>
        ({ productId: products[product].id, quantity, unitPrice, gst })),
    };
    const { errors, order: fields } = validatePO(values, refs);
    if (Object.keys(errors).length) throw new Error('Sample purchase orders could not be validated. Nothing was saved.');
    const id = `sample-po-${index + 1}`;
    const number = `PO-SAMPLE-${String(index + 1).padStart(3, '0')}`;
    const createdAt = at(spec.days);
    orders.unshift({ ...fields, id, number, status: 'open', createdAt, updatedAt: createdAt, deletedAt: null });
    events.push({ id: `sample-po-event-${events.length + 1}`, orderId: id, number,
      action: 'created', actor: SAMPLE_ACTOR, at: createdAt, summary: `Sample order created with ${fields.lines.length} item${fields.lines.length === 1 ? '' : 's'} · ${money(fields.total)}` });
  }
  const changed = orders.find((order) => order.id === 'sample-po-2');
  const revised = validatePO({ poDate: changed.poDate, expectedDate: changed.expectedDate,
    vendorId: changed.vendorId, locationId: changed.locationId,
    lines: changed.lines.map((line) => ({
      productId: line.productId, quantity: '72', unitPrice: String(line.unitPrice), gst: String(line.gst),
    })) }, refs, changed).order;
  if (!revised) throw new Error('Sample purchase orders could not be validated. Nothing was saved.');
  const updatedAt = at(3);
  orders[orders.indexOf(changed)] = { ...changed, ...revised, updatedAt };
  events.push({ id: 'sample-po-event-6', orderId: changed.id, number: changed.number,
    action: 'updated', actor: SAMPLE_ACTOR, at: updatedAt, summary: `Sample quantity changed (60 → 72); total ${money(changed.total)} → ${money(revised.total)}` });
  const removed = orders.find((order) => order.id === 'sample-po-3');
  const deletedAt = at(2);
  orders[orders.indexOf(removed)] = { ...removed, status: 'deleted', deletedAt, updatedAt: deletedAt };
  events.push({ id: 'sample-po-event-7', orderId: removed.id, number: removed.number,
    action: 'deleted', actor: SAMPLE_ACTOR, at: deletedAt, summary: `Sample order deleted · ${money(removed.total)}` });
  return { version: 1, revision: events.length, orders, events };
}

export function loadPOs() {
  let raw;
  try { raw = window.localStorage.getItem(PO_KEY); }
  catch { throw new Error('Purchase orders could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samplePOs() || { version: 1, revision: 0, orders: [], events: [] };
    if (!validRecord(initial)) throw new Error('Sample purchase orders could not be validated. Nothing was saved.');
    try {
      if (window.localStorage.getItem(PO_KEY) !== null) return loadPOs();
      window.localStorage.setItem(PO_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample purchase orders could not be saved in this browser. Check storage settings and try again.'); }
    return initial;
  }
  let record;
  try { record = JSON.parse(raw); } catch { throw new Error(invalid); }
  if (!validRecord(record)) throw new Error(invalid);
  return record;
}
export function loadPOSnapshot() {
  return { record: loadPOs(), refs: loadPOReferences() };
}
function save(snapshot, next, refs = null) {
  if (!same(loadPOs(), snapshot.record)) throw new Error('Purchase orders changed in another tab. Refresh records before saving; your draft was not saved.');
  if (refs && !same(loadPOReferences(), refs)) throw new Error('Vendor, storage location or product masters changed. Refresh records and review your draft before saving.');
  if (!validRecord(next)) throw new Error('Purchase order data could not be validated. Nothing was saved.');
  try { window.localStorage.setItem(PO_KEY, JSON.stringify(next)); }
  catch { throw new Error('Purchase orders could not be saved in this browser. Check storage settings and try again.'); }
  return next;
}
export function seedSamplePOs(snapshot) {
  if (snapshot.record.orders.length || snapshot.record.events.length) {
    throw new Error('Sample orders can only be loaded into an empty purchase order list.');
  }
  const initial = samplePOs();
  if (!initial) throw new Error('The sample vendors, active locations and products are needed to load demo purchase orders.');
  return save(snapshot, initial, snapshot.refs);
}
function validated(values, refs, existing) {
  const result = validatePO(values, refs, existing);
  if (Object.keys(result.errors).length) throw new Error(Object.values(result.errors)[0]);
  return result.order;
}
function timestamp(previous) { return new Date(Math.max(Date.now(), Date.parse(previous || 0) + 1)).toISOString(); }
function append(snapshot, orders, order, action, summary, refs) {
  const event = { id: crypto.randomUUID(), orderId: order.id, number: order.number, action, actor: LOCAL_ACTOR, at: order.updatedAt, summary };
  return save(snapshot, { version: 1, revision: snapshot.record.revision + 1, orders,
    events: [...snapshot.record.events, event] }, refs);
}
export function createPO(snapshot, refs, values) {
  const fields = validated(values, refs);
  const now = timestamp(snapshot.record.events.at(-1)?.at);
  const id = crypto.randomUUID();
  const number = `PO-${fields.poDate.replaceAll('-', '')}-${String(snapshot.record.revision + 1).padStart(5, '0')}`;
  const order = { ...fields, id, number, status: 'open', createdAt: now, updatedAt: now, deletedAt: null };
  return append(snapshot, [order, ...snapshot.record.orders], order, 'created',
    `Created with ${order.lines.length} item${order.lines.length === 1 ? '' : 's'} · ${money(order.total)}`, refs);
}
function inputs(order) {
  return { poDate: order.poDate, expectedDate: order.expectedDate, vendorId: order.vendorId,
    locationId: order.locationId, lines: order.lines.map(({ productId, quantity, unitPrice, gst }) => ({ productId, quantity, unitPrice, gst })) };
}
export function updatePO(snapshot, refs, id, values) {
  const old = snapshot.record.orders.find((o) => o.id === id);
  if (!old || old.status === 'deleted') throw new Error('This purchase order is unavailable or deleted.');
  const fields = validated(values, refs, old);
  const changes = [];
  for (const [key, label] of [['poDate', 'PO date'], ['expectedDate', 'expected delivery'], ['vendorId', 'vendor'],
    ['locationId', 'storage location']]) {
    if (old[key] !== fields[key]) changes.push(`${label}: ${old[key === 'vendorId' ? 'vendorName' : key === 'locationId' ? 'locationName' : key]} → ${fields[key === 'vendorId' ? 'vendorName' : key === 'locationId' ? 'locationName' : key]}`);
  }
  if (!same(inputs(old).lines, inputs(fields).lines)) changes.push(`items or pricing changed (${money(old.total)} → ${money(fields.total)})`);
  if (!changes.length) throw new Error('No changes to save.');
  const order = { ...old, ...fields, updatedAt: timestamp(snapshot.record.events.at(-1)?.at || old.updatedAt) };
  return append(snapshot, snapshot.record.orders.map((o) => o.id === id ? order : o), order, 'updated', changes.join('; '), refs);
}
export function deletePO(snapshot, id) {
  const old = snapshot.record.orders.find((o) => o.id === id);
  if (!old || old.status === 'deleted') throw new Error('This purchase order is unavailable or already deleted.');
  const at = timestamp(snapshot.record.events.at(-1)?.at || old.updatedAt);
  const order = { ...old, status: 'deleted', deletedAt: at, updatedAt: at };
  return append(snapshot, snapshot.record.orders.map((o) => o.id === id ? order : o), order, 'deleted',
    `Deleted PO with ${order.lines.length} item${order.lines.length === 1 ? '' : 's'} · ${money(order.total)}`);
}
export function filterPOs(orders, { from = '', to = '', vendorId = '', productId = '', status = 'open', sort = 'recent' } = {}) {
  return orders.filter((o) => (!from || o.poDate >= from) && (!to || o.poDate <= to) &&
    (!vendorId || o.vendorId === vendorId) && (!productId || o.lines.some((l) => l.productId === productId)) &&
    (status === 'all' || o.status === status)).sort((a, b) =>
    (sort === 'oldest' ? 1 : -1) * (a.poDate.localeCompare(b.poDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}