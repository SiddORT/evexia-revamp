// Isolated fictional evaluation state. Never read masters, storage or network.
export const KIT_PRODUCTS = Object.freeze(['200', '250', '100', '85', '70', '58', 'Customized']);
export const STATUSES = Object.freeze(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const PAYMENT_STATUSES = Object.freeze(['Mock unpaid', 'Mock paid', 'Mock partial']);
const freeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
};
const address = (n) => ({ line1: `${n} Fictional Lane`, line2: 'Example Quarter', landmark: 'Demo square', country: 'India', state: 'Example State', city: 'Demo City', pincode: '000000' });
export const DOCTORS = freeze(['Dr. Mira Example', 'Dr. Arun Fiction', 'Dr. Leela Sample'].map((name, i) => ({ id: `KIT-DR-${i + 1}`, name, phone: `+91 000000010${i + 1}`, address: address(i + 101) })));
export const MRS = freeze(['Dev Example', 'Riya Fiction', 'Noor Sample'].map((name, i) => ({ id: `KIT-MR-${i + 1}`, name, phone: `+91 000000020${i + 1}`, address: address(i + 201) })));
export const blankOrder = () => ({
  orderFor: 'doctor', doctorId: '', mrId: '', kit: { product: '', custom: '', volume: '', quantity: '' },
  lancets: '', applicators: '', tray: '', shipping: 'doctor',
  other: { name: '', phone: '', address: { line1: '', line2: '', landmark: '', country: '', state: '', city: '', pincode: '' } },
  remarks: '', attachments: [],
});
const text = (v) => String(v ?? '').trim();
const whole = (v) => /^\d+$/.test(text(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const positive = (v) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text(v)) && Number.isFinite(Number(v)) && Number(v) > 0;
export const hasKit = (v) => Object.values(v.kit || {}).some((x) => text(x));
export const addressText = (a) => a ? [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
export const shippingRecipient = (v) => v.shipping === 'doctor' ? DOCTORS.find((d) => d.id === v.doctorId) || null
  : v.shipping === 'mr' ? MRS.find((m) => m.id === v.mrId) || null : v.shipping === 'other' ? v.other || null : null;
const supported = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
export function validateAttachments(files, existing = []) {
  if (files.length + existing.length > 10) return 'Select at most ten files.';
  for (const f of files) {
    const ext = String(f.name || '').split('.').at(-1).toLowerCase();
    if (!supported[f.type]?.includes(ext)) return 'Supported files: PDF, JPEG, PNG and WebP. File extension and type must agree.';
    if (!Number.isFinite(f.size) || f.size <= 0 || f.size > 10 * 1024 * 1024) return 'Each file must be non-empty and no larger than 10 MB.';
  }
  return '';
}
export const fileSize = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
export function validateOrder(v) {
  const errors = {};
  if (!['doctor', 'mr'].includes(v.orderFor)) errors.orderFor = 'Choose Doctor or MR.';
  if (!DOCTORS.some((d) => d.id === v.doctorId)) errors.doctorId = 'Choose a fictional doctor for billing.';
  if ((v.orderFor === 'mr' || v.shipping === 'mr') && !MRS.some((m) => m.id === v.mrId)) errors.mrId = 'Choose a fictional MR for this recipient.';
  const kit = v.kit || {};
  if (hasKit(v)) {
    if (!KIT_PRODUCTS.includes(kit.product)) errors['kit-product'] = 'Choose a kit Products configuration.';
    if (kit.product === 'Customized' && !positive(kit.custom)) errors['kit-custom'] = 'Enter a positive custom product value.';
    if (!positive(kit.volume)) errors['kit-volume'] = 'Enter a positive kit volume in ml.';
    if (!whole(kit.quantity)) errors['kit-quantity'] = 'Enter a positive whole kit quantity.';
  }
  for (const k of ['lancets', 'applicators', 'tray']) if (text(v[k]) && !whole(v[k])) errors[k] = 'Enter a positive whole Products count, or leave this row blank.';
  if (!hasKit(v) && !['lancets', 'applicators', 'tray'].some((k) => text(v[k]))) errors.products = 'Include at least one kit or consumable.';
  if (!shippingRecipient(v)) errors.shipping = 'Choose an available Doctor, MR or Other shipping recipient.';
  if (v.shipping === 'other') {
    if (!text(v.other?.name)) errors['other-name'] = 'Enter the recipient name.';
    const phone = text(v.other?.phone);
    if (!/^[0-9 ()+-]{5,25}$/.test(phone) || (phone.match(/\d/g) || []).length < 5) errors['other-phone'] = 'Enter a phone number with at least five digits.';
    for (const k of ['line1', 'country', 'state', 'city', 'pincode']) if (!text(v.other?.address?.[k])) errors[`other-${k}`] = 'Enter this shipping address field.';
  }
  const fileError = validateAttachments(v.attachments || []);
  if (fileError) errors.attachments = fileError;
  return errors;
}
export function productSummary(v) {
  const items = [];
  if (hasKit(v)) items.push(`Stallergo Skin Prick Kit: ${v.kit.product === 'Customized' ? `Customized (${v.kit.custom})` : v.kit.product}, ${v.kit.volume} ml × ${v.kit.quantity}`);
  for (const [key, label] of [['lancets', 'Lancets'], ['applicators', 'Applicators'], ['tray', 'Tray']]) if (text(v[key])) items.push(`${label}: ${v[key]}`);
  return items.join('; ');
}
export function filterOrders(orders, { search = '', from = '', to = '', doctorId = '', statuses = [], paymentStatus = '' } = {}) {
  const q = search.trim().toLocaleLowerCase();
  return orders.filter((o) => (!from || o.date >= from) && (!to || o.date <= to)
    && (!doctorId || o.doctorId === doctorId) && (!statuses.length || statuses.includes(o.status))
    && (!paymentStatus || o.paymentStatus === paymentStatus)
    && (!q || `${o.number} ${productSummary(o)} ${o.billing.name} ${MRS.find((m) => m.id === o.mrId)?.name || ''}`.toLocaleLowerCase().includes(q)));
}
// Quotes protect separators/newlines; prefix spreadsheet formulas in every cell.
const csvCell = (value) => {
  const s = String(value ?? '');
  return `"${(/^[\s]*[=+\-@]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`;
};
export function exportCsv(orders) {
  const rows = [['Order number', 'Date', 'Products', 'Order for', 'Doctor', 'MR', 'Order status', 'Payment status'],
    ...orders.map((o) => [o.number, o.date, productSummary(o), o.orderFor === 'mr' ? 'MR' : 'Doctor', o.billing.name, MRS.find((m) => m.id === o.mrId)?.name || '', o.status, o.paymentStatus])];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
function snapshotOrder(v, n, date, status = 'Confirmed', paymentStatus = 'Mock unpaid') {
  // Explicitly project attachment metadata: never retain File instances/bytes.
  return freeze({
    ...structuredClone(v), attachments: (v.attachments || []).map(({ name, size, type }) => ({ name, size, type })),
    id: `demo-kit-${n}`, number: `DEMO-KIT-${String(n).padStart(4, '0')}`, date, status, paymentStatus,
    billing: structuredClone(DOCTORS.find((d) => d.id === v.doctorId)),
    recipient: structuredClone(shippingRecipient(v)),
  });
}
export function createDemoStore({ empty = false } = {}) {
  let sequence = empty ? 0 : 6;
  const listeners = new Set();
  let snapshot = freeze({ orders: empty ? [] : STATUSES.map((status, i) => {
    const v = { ...blankOrder(), doctorId: DOCTORS[i % 3].id, mrId: i % 2 ? MRS[i % 3].id : '', orderFor: i % 2 ? 'mr' : 'doctor',
      shipping: i % 2 ? 'mr' : 'doctor', kit: { product: KIT_PRODUCTS[i], custom: '', volume: '1', quantity: String(i + 1) },
      lancets: '20', remarks: 'Fictional evaluation order.' };
    return snapshotOrder(v, i + 1, `2026-10-${String(10 - i).padStart(2, '0')}`, status, PAYMENT_STATUSES[i % 3]);
  }).reverse(), notice: '' });
  function publish(next) { snapshot = freeze({ ...snapshot, ...next }); listeners.forEach((fn) => fn()); }
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setNotice(notice) { publish({ notice }); },
    saveOrder(v) {
      const errors = validateOrder(v);
      if (Object.keys(errors).length) return { errors };
      const order = snapshotOrder(v, ++sequence, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
      publish({ orders: [order, ...snapshot.orders], notice: `${order.number} saved for this mock session only. No real order submitted.` });
      return { order, errors: {} };
    },
  };
}
export const demoStore = createDemoStore();
