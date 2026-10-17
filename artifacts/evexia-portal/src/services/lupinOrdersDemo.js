// Fictional, session-only data. No storage, master services, uploads or APIs.
import { roundRate } from './rates.js';
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const DOCTORS = freeze([
  { id: 'LP-DR-1', name: 'Dr. Mira Example' },
  { id: 'LP-DR-2', name: 'Dr. Arun Fiction' },
  { id: 'LP-DR-3', name: 'Dr. Leela Sample' },
]);
export const MRS = freeze([
  { id: 'LP-MR-1', name: 'Dev Example' },
  { id: 'LP-MR-2', name: 'Riya Fiction' },
  { id: 'LP-MR-3', name: 'Noor Sample' },
]);
export const STATUSES = freeze(['Confirmed', 'Approved', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const nameOf = (list, id) => list.find((item) => item.id === id)?.name || 'Not recorded';

export function parsePatientCount(value) {
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? BigInt(value) : null;
}
export function parsePrice(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  let normalized;
  try { normalized = roundRate(value); } catch { return null; }
  if (normalized.split('.')[0].length > 40) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor > 0n ? minor : null;
}
export const totalMinor = (patientCount, price) => (parsePatientCount(patientCount) ?? 0n) * (parsePrice(price) ?? 0n);
export const money = (minor) => `₹${(minor / 100n).toLocaleString('en-IN')}.${String(minor % 100n).padStart(2, '0')}`;

const supported = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
export function validateAttachments(files, existing = []) {
  if (files.length + existing.length > 10) return 'Select at most ten attachments.';
  for (const file of [...existing, ...files]) {
    const extension = String(file.name || '').split('.').at(-1).toLowerCase();
    if (!supported[file.type]?.includes(extension)) return 'Choose PDF, JPEG, PNG or WebP files; the extension and type must agree.';
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) return 'Each attachment must be non-empty and no larger than 10 MB.';
  }
  return '';
}
export function validateOrder(values) {
  const errors = {};
  if (!DOCTORS.some((d) => d.id === values.doctorId)) errors.doctorId = 'Choose a fictional doctor.';
  if (!MRS.some((m) => m.id === values.mrId)) errors.mrId = 'Choose a fictional MR.';
  if (parsePatientCount(values.patientCount) === null) errors.patientCount = 'Enter a positive safe whole number of patients (up to 9,007,199,254,740,991).';
  if (parsePrice(values.price) === null) errors.price = 'Enter a positive INR price; rounded half-up to two decimal places, for example 1000.00.';
  const attachments = values.attachments || [];
  if (!attachments.length) errors.attachments = 'Select at least one accepted attachment. Files are not uploaded.';
  else {
    const problem = validateAttachments(attachments);
    if (problem) errors.attachments = problem;
  }
  return errors;
}
export function filterOrders(orders, { search = '', date = '', doctorId = '', statuses = [] } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return orders.filter((order) => (!date || order.date === date)
    && (!doctorId || order.doctorId === doctorId)
    && (!statuses.length || statuses.includes(order.status))
    && (!query || `${order.number} ${order.date} ${order.doctorName} ${order.mrName} ${order.patientCount} ${money(totalMinor(order.patientCount, order.price))} ${order.status} ${order.paymentStatus}`.toLocaleLowerCase().includes(query)));
}
// Explicit visible-field allowlist; attachments, remarks and internal IDs never leave.
const csvCell = (value) => {
  const text = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export function ordersCsv(orders) {
  const rows = [['Sr. No.', 'Order number', 'Date', 'Patients', 'Price per test (INR)', 'Total amount (INR)', 'Doctor', 'MR', 'Order status', 'Payment status'],
    ...orders.map((o, index) => [index + 1, o.number, o.date, o.patientCount, money(parsePrice(o.price)), money(totalMinor(o.patientCount, o.price)), o.doctorName, o.mrName, o.status, o.paymentStatus])];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export function createDemoStore({ empty = false } = {}) {
  let sequence = empty ? 0 : 6;
  const listeners = new Set();
  let snapshot = freeze({ notice: '', orders: empty ? [] : STATUSES.map((status, i) => ({
    id: `demo-lupin-${i + 1}`, number: `DEMO-LUPIN-${String(i + 1).padStart(4, '0')}`,
    date: `2026-10-${String(10 - i).padStart(2, '0')}`,
    doctorId: DOCTORS[i % 3].id, doctorName: DOCTORS[i % 3].name,
    mrId: MRS[i % 3].id, mrName: MRS[i % 3].name,
    patientCount: String(i + 1), price: i % 2 ? '1000' : '1250.50',
    attachments: [{ name: 'fictional-request.pdf', size: 2048, type: 'application/pdf' }],
    remarks: 'Fictional evaluation order. No real patients, payment or processing.',
    status, paymentStatus: i === 3 ? 'Paid (illustrative)' : 'Unpaid',
  })).reverse() });
  const publish = (patch) => { snapshot = freeze({ ...snapshot, ...patch }); listeners.forEach((fn) => fn()); };
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setNotice(notice) { publish({ notice }); },
    saveOrder(values) {
      const errors = validateOrder(values);
      if (Object.keys(errors).length) return { errors };
      const n = ++sequence;
      const order = freeze({
        id: `demo-lupin-${n}`, number: `DEMO-LUPIN-${String(n).padStart(4, '0')}`, date: today(),
        doctorId: values.doctorId, doctorName: nameOf(DOCTORS, values.doctorId),
        mrId: values.mrId, mrName: nameOf(MRS, values.mrId),
        patientCount: values.patientCount, price: roundRate(values.price), remarks: String(values.remarks || ''),
        attachments: values.attachments.map(({ name, size, type }) => ({ name, size, type })),
        status: 'Confirmed', paymentStatus: 'Unpaid',
      });
      publish({ orders: [order, ...snapshot.orders], notice: `${order.number} saved for this session only. Confirmed / unpaid is illustrative; no real order was submitted.` });
      return { order, errors: {} };
    },
  };
}
export const demoStore = createDemoStore();
