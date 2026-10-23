import * as imm from './immunotherapyDemo.js';
import * as kits from './kitsOrdersDemo.js';
import * as spt from './sptOrdersDemo.js';
import * as lupin from './lupinOrdersDemo.js';
import { DATE_FORMATS, formatCalendarDate } from './datePresentation.js';
import { exportDate } from './exportDatePresentation.js';
import { readOrderCsv, writeOrderCsv, decodeTransferCell, TRANSFER_MAX_BYTES, TRANSFER_MAX_ROWS } from './orderTransferCsv.js';
import { readOrderWorkbook, writeOrderWorkbook } from './orderTransferWorkbook.js';
import { equalTransfer, planSessionOrders } from './sessionOrderImport.js';

export const ORDER_TRANSFER_TYPES = {
  immunotherapy: { title: 'Immunotherapy', domain: imm, prefix: 'IT', slug: 'it' },
  kits: { title: 'Kits & Consumables', domain: kits, prefix: 'KIT', slug: 'kit' },
  spt: { title: 'SPT', domain: spt, prefix: 'SPT', slug: 'spt' },
  lupin: { title: 'Lupin', domain: lupin, prefix: 'LUPIN', slug: 'lupin' },
};
const SCHEMA = 'evexia.session-orders/1';
const HEADERS = ['Schema', 'Order type', 'Date context JSON', 'Order ID', 'Order number', 'Order date', 'Order details JSON', 'Session patients JSON'];
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const insist = (ok, message) => { if (!ok) throw new Error(message); };
const string = (v, label, max = 100_000) => insist(typeof v === 'string' && v.length <= max, `${label} must be text (up to ${max.toLocaleString()} characters).`);
function fields(v, required, optional = [], label = 'Object') {
  insist(object(v), `${label} must be a JSON object.`);
  insist(required.every((k) => Object.hasOwn(v, k)), `${label} is missing required fields: ${required.filter((k) => !Object.hasOwn(v, k)).join(', ')}.`);
  insist(Object.keys(v).every((k) => [...required, ...optional].includes(k)), `${label} has unsupported fields. Use this order type's template.`);
}
function safeJson(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${label}: enter valid JSON; preserve double quotes, arrays and decimal strings.`); }
  const walk = (v, depth) => {
    insist(depth < 15, `${label}: JSON nesting is too deep.`);
    if (object(v)) {
      insist(!Object.keys(v).some((k) => ['__proto__', 'prototype', 'constructor'].includes(k)), `${label}: unsafe object key.`);
      Object.values(v).forEach((x) => walk(x, depth + 1));
    } else if (Array.isArray(v)) {
      insist(v.length <= 10000, `${label}: array is too large.`);
      v.forEach((x) => walk(x, depth + 1));
    }
  };
  walk(value, 0);
  return value;
}
function address(v) {
  fields(v, ['line1', 'line2', 'landmark', 'country', 'state', 'city', 'pincode'], [], 'Address');
  Object.values(v).forEach((s) => string(s, 'Address field', 1000));
}
function person(v) {
  fields(v, ['name', 'phone', 'address'], ['id', 'dialCountry', 'email'], 'Recipient/billing snapshot');
  for (const k of Object.keys(v).filter((k) => k !== 'address')) string(v[k], `Snapshot ${k}`, 1000);
  address(v.address);
}
function patient(v, kind, withAmount = false) {
  const required = ['id', 'name', 'gender', 'age', ...(withAmount ? ['amount'] : [])];
  if (kind === 'immunotherapy') required.push('phone', 'dialCountry', 'address', 'doctorId', 'mrId', 'lastGiven');
  fields(v, required, [], 'Session patient');
  const pattern = kind === 'immunotherapy' ? /^IT-PT-[1-9]\d{0,11}$/ : /^DEMO-PT-0*[1-9]\d{0,11}$/;
  insist(pattern.test(v.id), 'Patient ID must use the session directory identifier format from the template.');
  string(v.name, 'Patient name', 100);
  insist(v.name.trim() && spt.GENDERS.includes(v.gender), 'Patient name and supported gender are required.');
  insist(Number.isInteger(v.age) && v.age >= 0 && v.age <= 120, 'Patient age must be a whole JSON number from 0 to 120.');
  if (withAmount) string(v.amount, 'Patient amount');
  if (kind === 'immunotherapy') {
    string(v.phone, 'Patient phone', 25); string(v.dialCountry, 'Patient phone country', 10); address(v.address);
    insist(/^[0-9 ()+-]{5,25}$/.test(v.phone) && (v.phone.match(/\d/g) || []).length >= 5 && v.dialCountry, 'Patient phone and phone country are required.');
    insist(imm.DOCTORS.some((d) => d.id === v.doctorId) && imm.MRS.some((m) => m.id === v.mrId), 'Patient doctor/MR references must belong to this session catalogue.');
    insist(v.lastGiven === null || v.lastGiven === 'unknown' || imm.DOSES.includes(v.lastGiven), 'lastGiven must be null, unknown or an explicitly recorded supported dosage; never derive it from an order status.');
  }
}
function attachments(v, domain) {
  insist(Array.isArray(v), 'Attachments must be a metadata array, not file contents.');
  v.forEach((f) => {
    fields(f, ['name', 'size', 'type'], [], 'Attachment metadata');
    string(f.name, 'Attachment name', 255); string(f.type, 'Attachment MIME type', 100);
    insist(Number.isSafeInteger(f.size), 'Attachment size must be a whole byte count.');
  });
  const error = domain.validateAttachments(v);
  insist(!error, error);
}
function validate(kind, order, dependencies) {
  const domain = ORDER_TRANSFER_TYPES[kind].domain;
  const common = ['id', 'number', 'date', 'doctorId', 'mrId', 'remarks', 'status'];
  const extras = {
    immunotherapy: ['patientId', 'dosage', 'histamine', 'saline', 'groups', 'poNumber', 'attachments', 'shipping'],
    kits: ['orderFor', 'kit', 'lancets', 'applicators', 'tray', 'shipping', 'other', 'attachments', 'paymentStatus', 'billing', 'recipient'],
    spt: ['doctorName', 'mrName', 'patients'],
    lupin: ['doctorName', 'mrName', 'patientCount', 'price', 'attachments', 'paymentStatus'],
  };
  fields(order, [...common, ...extras[kind]], [], 'Order');
  for (const k of common) string(order[k], `Order ${k}`);
  insist(Array.isArray(dependencies), 'Session patients JSON must be an array.');
  dependencies.forEach((p) => patient(p, kind));
  insist(new Set(dependencies.map((p) => p.id)).size === dependencies.length, 'Each session patient dependency must occur only once per row.');
  if (kind === 'immunotherapy') {
    for (const k of ['patientId', 'dosage', 'histamine', 'saline', 'poNumber', 'shipping']) string(order[k], k);
    insist(dependencies.length === 1 && dependencies[0].id === order.patientId, 'Include exactly the referenced patient in Session patients JSON.');
    insist(Array.isArray(order.groups) && order.groups.length <= 1000, 'Bottles must be an array of at most 1,000 bottles.');
    order.groups.forEach((g) => {
      fields(g, ['id', 'mrp', 'items'], [], 'Bottle'); string(g.id, 'Bottle ID', 100); string(g.mrp, 'Bottle MRP', 40);
      insist(g.id.trim() && Array.isArray(g.items) && g.items.length <= imm.ALLERGENS.length, 'Bottle ID and allergen items are required.');
      insist(!g.id.startsWith('IT-BOTTLE-') || /^IT-BOTTLE-[1-9]\d{0,11}$/.test(g.id), 'Generated bottle IDs must use a positive sequence of up to 12 digits.');
      g.items.forEach((it) => { fields(it, ['allergenId', 'result'], [], 'Allergen'); string(it.allergenId, 'Allergen ID'); string(it.result, 'Allergen result'); });
    });
  } else if (kind === 'kits') {
    insist(!dependencies.length, 'Kits orders do not have session patient dependencies.');
    fields(order.kit, ['product', 'custom', 'volume', 'quantity'], [], 'Kit');
    Object.values(order.kit).forEach((v) => string(v, 'Kit configuration'));
    for (const k of ['orderFor', 'lancets', 'applicators', 'tray', 'shipping', 'paymentStatus']) string(order[k], k);
    person(order.other); person(order.billing); person(order.recipient);
    insist(order.billing.id === order.doctorId, 'Billing snapshot ID must match the billing doctor.');
    if (order.shipping !== 'other') insist(order.recipient.id === (order.shipping === 'mr' ? order.mrId : order.doctorId), 'Recipient snapshot ID must match the selected shipping relationship.');
    insist(!order.mrId || kits.MRS.some((m) => m.id === order.mrId), 'MR reference is not available in this session catalogue.');
    insist(kits.PAYMENT_STATUSES.includes(order.paymentStatus), 'Unsupported Kits payment status.');
  } else if (kind === 'spt') {
    insist(Array.isArray(order.patients) && order.patients.length <= 10000, 'Order patients must be an array.');
    order.patients.forEach((p) => patient(p, kind, true));
    insist(dependencies.length === order.patients.length && order.patients.every((p) => dependencies.some((d) => d.id === p.id)), 'Include each referenced patient in Session patients JSON.');
    insist(order.patients.every(({ amount, ...p }) => equalTransfer(p, dependencies.find((d) => d.id === p.id))), 'Order patient identity details must agree with the supplied session patient. Amount belongs only in the order patient snapshot.');
    insist(new Set(order.patients.map((p) => p.id)).size === order.patients.length, 'Duplicate patient in order.');
    insist(['Draft', 'Saved'].includes(order.status), 'SPT status must be Draft or Saved.');
  } else {
    insist(!dependencies.length, 'Lupin orders do not have individual session patients.');
    for (const k of ['patientCount', 'price', 'paymentStatus']) string(order[k], k);
    insist(['Unpaid', 'Paid (illustrative)'].includes(order.paymentStatus), 'Unsupported Lupin payment status.');
  }
  if (['spt', 'lupin'].includes(kind)) {
    for (const [key, catalogue, nameKey] of [['doctorId', domain.DOCTORS, 'doctorName'], ['mrId', domain.MRS, 'mrName']]) {
      string(order[nameKey], nameKey);
      const match = catalogue.find((d) => d.id === order[key]);
      insist((match && match.name === order[nameKey]) || (kind === 'spt' && order.status === 'Draft' && !order[key] && !order[nameKey]), `${key} and ${nameKey} must agree with this session catalogue.`);
    }
  }
  if (kind !== 'spt') {
    attachments(order.attachments, domain);
    insist(domain.STATUSES.includes(order.status), 'Unsupported order status.');
  }
  const errors = kind === 'spt' && order.status === 'Draft' ? {} : domain.validateOrder(order, dependencies);
  insist(!Object.keys(errors).length, Object.entries(errors).map(([field, message]) => `${field}: ${message}`).join(' '));
}
function parseDate(value, context) {
  let iso = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    let match;
    if (context.dateFormat === 'dd-mmm-yyyy') {
      match = /^(\d{2}) ([A-Za-z]{3}) (\d{4})$/.exec(value);
      const month = match ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2].toLowerCase()) + 1 : 0;
      insist(month > 0, 'Order date must match declared DD MMM YYYY, or use YYYY-MM-DD.');
      iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[1]}`;
    } else {
      match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
      insist(match && ['dd-mm-yyyy', 'mm-dd-yyyy'].includes(context.dateFormat), 'Order date must match the file’s declared numeric format, or use YYYY-MM-DD.');
      iso = `${match[3]}-${context.dateFormat === 'mm-dd-yyyy' ? match[1] : match[2]}-${context.dateFormat === 'mm-dd-yyyy' ? match[2] : match[1]}`;
    }
  }
  insist(formatCalendarDate(iso) !== '—', 'Order date is not a valid calendar date. Correct it using YYYY-MM-DD.');
  return iso;
}
function readContext(text) {
  const c = safeJson(text, 'Date context');
  fields(c, ['dateFormat', 'timeZone', 'clock', 'cellEncoding'], [], 'Date context');
  insist(Object.hasOwn(DATE_FORMATS, c.dateFormat) && ['12', '24'].includes(c.clock) && c.cellEncoding === 'apostrophe-v1', 'Unsupported date format, clock or cell encoding in file context.');
  insist(typeof c.timeZone === 'string' && c.timeZone !== 'browser', 'File must declare the resolved timezone, not Browser default.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: c.timeZone }); } catch { throw new Error('File timezone is invalid.'); }
  return c;
}
function identifiers(kind, id, number) {
  const config = ORDER_TRANSFER_TYPES[kind];
  const match = new RegExp(`^demo-${config.slug}-([1-9]\\d{0,11})$`).exec(id);
  insist(match && number === `DEMO-${config.prefix}-${String(Number(match[1])).padStart(4, '0')}`, 'Order ID and number must use matching sequence numbers from the template (up to 12 digits).');
}
export async function reviewOrderFile(kind, file, snapshot) {
  insist(Object.hasOwn(ORDER_TRANSFER_TYPES, kind), 'Unknown order type.');
  insist(file && file.size > 0 && file.size <= TRANSFER_MAX_BYTES, 'Choose a nonempty CSV or XLSX file up to 8 MB.');
  let rows;
  if (/\.csv$/i.test(file.name)) rows = readOrderCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  else if (/\.xlsx$/i.test(file.name)) rows = await readOrderWorkbook(file);
  else throw new Error('Choose a .csv or .xlsx file, not a legacy .xls workbook.');
  insist(rows.length >= 2 && rows.length <= TRANSFER_MAX_ROWS + 1, 'File needs a header and 1–10,000 order rows.');
  insist(rows[0].cells.length === HEADERS.length && HEADERS.every((s, i) => rows[0].cells[i] === s), `Keep the template's eight headers in order: ${HEADERS.join(', ')}.`);
  let firstContext;
  const incoming = rows.slice(1).map(({ line, cells }) => {
    let order, patients;
    try {
      insist(cells.length === HEADERS.length && HEADERS.every((_, i) => typeof cells[i] === 'string'), 'Each row must contain all eight text columns.');
      const [schema, type, rawContext, id, number, date, details, rawPatients] = cells.map(decodeTransferCell);
      insist(schema === SCHEMA && type === kind, `Expected ${SCHEMA}, order type ${kind}. Do not mix order types or schema versions.`);
      const context = readContext(rawContext);
      if (!firstContext) firstContext = context;
      insist(equalTransfer(context, firstContext), 'Date context must be identical on every row.');
      identifiers(kind, id, number);
      const payload = safeJson(details, 'Order details JSON');
      insist(object(payload) && !['id', 'number', 'date'].some((k) => Object.hasOwn(payload, k)), 'Keep id, number and date in their dedicated columns, not in Order details JSON.');
      order = { ...payload, id, number, date: parseDate(date, context) };
      patients = safeJson(rawPatients, 'Session patients JSON');
      validate(kind, order, patients);
      return { line, order, patients, errors: [] };
    } catch (error) { return { line, order: undefined, patients: [], errors: [error.message || 'Invalid row.'] }; }
  });
  return planSessionOrders(snapshot, incoming);
}
export function orderTransferBlob(kind, orders, snapshot, preferences, format) {
  insist(Object.hasOwn(ORDER_TRANSFER_TYPES, kind) && ['csv', 'xlsx'].includes(format), 'Choose a supported order type and file format.');
  insist(orders.length <= TRANSFER_MAX_ROWS, 'Transfer at most 10,000 filtered orders at a time. Narrow the filters and export again.');
  const context = JSON.stringify({ dateFormat: preferences.dateFormat, timeZone: preferences.resolvedTimeZone || preferences.timeZone, clock: preferences.clock, cellEncoding: 'apostrophe-v1' });
  const parsedContext = readContext(context);
  const rows = [HEADERS, ...orders.map((order) => {
    const { id, number, date, ...details } = order;
    const ids = kind === 'immunotherapy' ? [order.patientId] : kind === 'spt' ? order.patients.map((p) => p.id) : [];
    const patients = ids.map((pid) => {
      const p = snapshot.patients?.find((p) => p.id === pid);
      insist(p, `Cannot export ${number}: session patient ${pid} is missing.`);
      return p;
    });
    // Refuse to hand off an unsupported snapshot rather than emit a file which
    // our importer cannot restore. Never coerce or "repair" stored values here.
    try {
      identifiers(kind, id, number);
      validate(kind, order, patients);
      insist(parseDate(exportDate(date, preferences), parsedContext) === date, 'Order date cannot be represented without changing its calendar value.');
    } catch (error) { throw new Error(`Cannot export ${number}: ${error.message}`); }
    return [SCHEMA, kind, context, id, number, exportDate(date, preferences), JSON.stringify(details), JSON.stringify(patients)];
  })];
  const blob = format === 'csv' ? new Blob([writeOrderCsv(rows)], { type: 'text/csv;charset=utf-8' }) : writeOrderWorkbook(rows);
  insist(blob.size <= TRANSFER_MAX_BYTES, 'File exceeds the 8 MB import limit. Narrow the filters and export again.');
  return blob;
}

// Deliberately fictional, independent of the user's orders. The high example
// sequence avoids accidentally replacing seeded records; users choose local IDs.
export function orderTemplate(kind) {
  const n = 900001, config = ORDER_TRANSFER_TYPES[kind];
  const base = { id: `demo-${config.slug}-${n}`, number: `DEMO-${config.prefix}-${n}`, date: '2026-10-23',
    doctorId: config.domain.DOCTORS[0].id, mrId: config.domain.MRS[0].id, remarks: 'Template example — replace or remove before import.', status: 'Confirmed' };
  let order, patients = [];
  if (kind === 'immunotherapy') {
    patients = [{ id: 'IT-PT-900001', name: 'Example patient', age: 30, gender: 'Other', phone: '0000000000', dialCountry: 'IN', address: { ...imm.DOCTORS[0].address }, doctorId: base.doctorId, mrId: base.mrId, lastGiven: null }];
    order = { ...base, patientId: patients[0].id, dosage: 'B1', histamine: '6', saline: '1', groups: [{ id: 'IT-BOTTLE-900001', mrp: '1200.50', items: [{ allergenId: imm.ALLERGENS[0].id, result: '4' }] }], poNumber: '', attachments: [], shipping: 'patient' };
  } else if (kind === 'kits') order = { ...kits.blankOrder(), ...base, kit: { product: '200', custom: '', volume: '1', quantity: '1' }, billing: structuredClone(kits.DOCTORS[0]), recipient: structuredClone(kits.DOCTORS[0]), paymentStatus: 'Mock unpaid' };
  else if (kind === 'spt') {
    patients = [{ id: 'DEMO-PT-900001', name: 'Example patient', age: 30, gender: 'Other' }];
    order = { ...base, status: 'Draft', doctorName: spt.DOCTORS[0].name, mrName: spt.MRS[0].name, patients: [{ ...patients[0], amount: '1000.00' }] };
  } else order = { ...base, doctorName: lupin.DOCTORS[0].name, mrName: lupin.MRS[0].name, patientCount: '1', price: '1000.00', paymentStatus: 'Unpaid', attachments: [{ name: 'example-request.pdf', size: 1024, type: 'application/pdf' }] };
  return { orders: [order], patients };
}
