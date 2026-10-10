// Isolated, fictional evaluation state. No master services, storage or network.
export const STATUSES = Object.freeze(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
export const DOSES = Object.freeze(['PD', 'DD', ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`)]);
export const GENDERS = Object.freeze(['Male', 'Female', 'Other', 'Prefer not to say']);
const address = (n, city = 'Demo City') => ({ line1: `${n} Fictional Lane`, line2: 'Example Quarter', landmark: 'Demo square', pincode: '000000', city, state: 'Example State', country: 'India' });
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const DOCTORS = freeze([
  { id: 'IT-DR-1', name: 'Dr. Mira Example', phone: '+91 0000000101', address: address(101), email: 'mira@example.invalid' },
  { id: 'IT-DR-2', name: 'Dr. Arun Fiction', phone: '+91 0000000102', address: address(102, 'Sample Town'), email: 'arun@example.invalid' },
  { id: 'IT-DR-3', name: 'Dr. Leela Sample', phone: '+91 0000000103', address: address(103), email: 'leela@example.invalid' },
]);
export const MRS = freeze([
  { id: 'IT-MR-1', name: 'Dev Example', phone: '+91 0000000201', email: 'dev@example.invalid' },
  { id: 'IT-MR-2', name: 'Riya Fiction', phone: '+91 0000000202', email: 'riya@example.invalid' },
  { id: 'IT-MR-3', name: 'Noor Sample', phone: '+91 0000000203', email: 'noor@example.invalid' },
]);
export const ALLERGENS = freeze([
  { id: 'IT-AL-1', name: 'Example Grass A', mix: true },
  { id: 'IT-AL-2', name: 'Fictional Pollen B', mix: true },
  { id: 'IT-AL-3', name: 'Sample Tree C', mix: true },
  { id: 'IT-AL-4', name: 'Example Mite D', mix: false },
  { id: 'IT-AL-5', name: 'Fictional Mold E', mix: false },
  { id: 'IT-AL-6', name: 'Sample Weed F', mix: true },
]);
const seedPatients = freeze(['Asha Example', 'Rohan Fiction', 'Taylor Sample', 'Kiran Example', 'Neel Fiction', 'Ira Sample', 'Robin Example', 'Meera Fiction', 'Sam Sample', 'Dia Example', 'Anil Fiction', 'Alex Sample'].map((name, i) => ({
  id: `IT-PT-${i + 1}`, name, age: 20 + i, gender: GENDERS[i % 4], phone: `000000${String(i + 1).padStart(4, '0')}`, dialCountry: 'IN',
  address: address(i + 1), doctorId: DOCTORS[i % 3].id, mrId: MRS[i % 3].id,
  // Explicit administration evidence, never derived from order status.
  lastGiven: ['PD', 'DD', 'B1', null, 'B8', 'unknown', 'B3', null, 'B6', 'B2', null, 'B7'][i],
})));
export function nextDose(patient) {
  const index = DOSES.indexOf(patient?.lastGiven);
  if (index < 0) return { dosage: '', explanation: 'No known last-given demo administration. Choose a dosage explicitly. Order placement, shipping and delivery are not administration evidence.' };
  if (index === DOSES.length - 1) return { dosage: '', explanation: 'Last-given demo history is B8, the end of this illustrative sequence. There is no automatic next item; choose explicitly.' };
  return { dosage: DOSES[index + 1], explanation: `Last-given demo administration: ${patient.lastGiven}. ${DOSES[index + 1]} is selected using the illustrative PD → DD → B1–B8 sequence. Manually editable; not a clinical recommendation.` };
}
export function parseAmount(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const totalMinor = (groups) => groups.reduce((sum, group) => sum + (parseAmount(group.mrp) ?? 0n), 0n);
export const money = (minor) => `₹${(minor / 100n).toLocaleString('en-IN')}.${String(minor % 100n).padStart(2, '0')}`;
const validMm = (v) => typeof v === 'string' && /^\d{1,6}(?:\.\d{1,2})?$/.test(v);
let groupSequence = 0;
export const newGroup = () => ({ id: `IT-BOTTLE-${++groupSequence}`, mrp: '', items: [] });
export function groupingError(items) {
  if (new Set(items.map((item) => item.allergenId)).size !== items.length) return 'Duplicate allergens within a bottle are not allowed.';
  if (items.some((item) => !ALLERGENS.some((a) => a.id === item.allergenId))) return 'Choose fictional allergens from this demo.';
  if (items.length > 1 && items.some((item) => !ALLERGENS.find((a) => a.id === item.allergenId)?.mix)) return 'No Mix allergens must be alone in their bottle. Move to a separate bottle explicitly.';
  return '';
}
export function shippingRecipient(order, patients) {
  const person = order.shipping === 'patient' ? patients.find((p) => p.id === order.patientId) : order.shipping === 'doctor' ? DOCTORS.find((d) => d.id === order.doctorId) : null;
  return person ? { name: person.name, phone: person.phone, dialCountry: person.dialCountry, address: person.address } : null;
}
const supported = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
export function validateAttachments(files, existing = []) {
  if (files.length + existing.length > 10) return 'Select at most ten prescription files.';
  for (const file of files) {
    const ext = String(file.name || '').split('.').at(-1).toLowerCase();
    if (!supported[file.type]?.includes(ext)) return 'Supported files: PDF, JPEG, PNG and WebP. File extension and type must agree.';
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) return 'Each file must be non-empty and no larger than 10 MB.';
  }
  return '';
}
export function validateOrder(values, patients) {
  const errors = {};
  if (!patients.some((p) => p.id === values.patientId)) errors.patientId = 'Choose a demo patient.';
  if (!DOCTORS.some((d) => d.id === values.doctorId)) errors.doctorId = 'Choose a demo doctor.';
  if (!MRS.some((m) => m.id === values.mrId)) errors.mrId = 'Choose a demo MR.';
  if (!DOSES.includes(values.dosage)) errors.dosage = 'Choose PD, DD or B1–B8 explicitly.';
  for (const key of ['histamine', 'saline']) if (!validMm(values[key])) errors[key] = 'Enter a non-negative result in mm with up to two decimal places.';
  if (!STATUSES.includes(values.status)) errors.status = 'Choose a supported demo status.';
  if (!shippingRecipient(values, patients)) errors.shipping = 'Choose patient or doctor shipping.';
  const groups = values.groups || [];
  if (!groups.length) errors.groups = 'Add at least one bottle.';
  if (new Set(groups.map((g) => g.id)).size !== groups.length) errors.groups = 'Bottle IDs must be unique.';
  groups.forEach((g) => {
    const problem = groupingError(g.items);
    if (!g.items.length || problem) errors[`group-${g.id}`] = problem || 'Add at least one allergen to this bottle.';
    if (parseAmount(g.mrp) === null) errors[`mrp-${g.id}`] = 'Enter a non-negative INR MRP with at most two decimal places.';
    g.items.forEach((item) => { if (!validMm(item.result)) errors[`result-${g.id}-${item.allergenId}`] = 'Enter a non-negative skin-test result in mm with up to two decimal places.'; });
  });
  const attachmentError = validateAttachments(values.attachments || []);
  if (attachmentError) errors.attachments = attachmentError;
  return errors;
}
export function filterOrders(orders, patients, { search = '', status = 'All', from = '', to = '' } = {}) {
  const q = search.trim().toLocaleLowerCase();
  return orders.filter((o) => {
    const p = patients.find((p) => p.id === o.patientId);
    const d = DOCTORS.find((d) => d.id === o.doctorId);
    const m = MRS.find((m) => m.id === o.mrId);
    return (status === 'All' || !status || o.status === status) && (!from || o.date >= from) && (!to || o.date <= to)
      && (!q || `${o.number} ${p?.name} ${p?.phone} ${d?.name} ${m?.name}`.toLocaleLowerCase().includes(q));
  });
}
export function createDemoStore({ empty = false } = {}) {
  let patientSequence = seedPatients.length;
  let orderSequence = empty ? 0 : 18;
  const listeners = new Set();
  let snapshot = freeze({ patients: [...seedPatients], orders: empty ? [] : Array.from({ length: 18 }, (_, i) => ({
    id: `demo-it-${i + 1}`, number: `DEMO-IT-${String(i + 1).padStart(4, '0')}`, date: `2026-10-${String(10 - i % 10).padStart(2, '0')}`,
    patientId: seedPatients[i % 12].id, doctorId: DOCTORS[i % 3].id, mrId: MRS[i % 3].id, dosage: DOSES[i % 10],
    histamine: '6', saline: '1', groups: [
      { id: `IT-SEED-${i + 1}-A`, mrp: '1200.50', items: [{ allergenId: 'IT-AL-1', result: '4' }, { allergenId: 'IT-AL-2', result: '5' }] },
      { id: `IT-SEED-${i + 1}-B`, mrp: '800.00', items: [{ allergenId: 'IT-AL-4', result: '3' }] },
    ], remarks: 'Fictional evaluation order. Reaction values are examples, not fixed clinical values.', poNumber: i % 2 ? '' : `EXAMPLE-PO-${i + 1}`,
    attachments: i === 0 ? [{ name: 'demo-prescription.pdf', type: 'application/pdf', size: 1024 }] : [],
    shipping: i % 2 ? 'doctor' : 'patient', status: STATUSES[i % 6],
  })).reverse(), notice: '' });
  const publish = (next) => { snapshot = freeze({ ...snapshot, ...next }); listeners.forEach((fn) => fn()); };
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setNotice(notice) { publish({ notice }); },
    registerPatient(values) {
      const errors = {};
      const name = String(values.name || '').trim();
      if (!name || name.length > 100) errors.name = 'Enter a name of 1–100 characters.';
      if (!/^\d{1,3}$/.test(String(values.age)) || Number(values.age) > 120) errors.age = 'Enter a whole age from 0 to 120.';
      if (!GENDERS.includes(values.gender)) errors.gender = 'Choose a gender.';
      if (!/^[0-9 ()+-]{5,25}$/.test(values.phone || '') || (values.phone.match(/\d/g) || []).length < 5) errors.phone = 'Enter a demo phone with at least five digits.';
      if (!values.dialCountry) errors.phone = 'Choose a phone country.';
      for (const key of ['line1', 'pincode', 'city', 'state', 'country']) if (!String(values.address?.[key] || '').trim()) errors[`address-${key}`] = 'Enter this address field manually; no live PIN lookup.';
      if (!DOCTORS.some((d) => d.id === values.doctorId)) errors.doctorId = 'Choose a demo doctor.';
      if (!MRS.some((m) => m.id === values.mrId)) errors.mrId = 'Choose a demo MR.';
      if (Object.keys(errors).length) return { errors };
      const patient = freeze({ ...structuredClone(values), id: `IT-PT-${++patientSequence}`, name, age: Number(values.age), lastGiven: null });
      publish({ patients: [...snapshot.patients, patient] });
      return { patient, errors: {} };
    },
    saveOrder(values, id) {
      const previous = id ? snapshot.orders.find((o) => o.id === id) : null;
      if (id && !previous) return { errors: { form: 'This session-only demo order is unavailable. Return to the listing.' } };
      const errors = validateOrder(values, snapshot.patients);
      if (Object.keys(errors).length) return { errors };
      const n = previous ? null : ++orderSequence;
      const order = freeze({ ...structuredClone(values), id: previous?.id || `demo-it-${n}`, number: previous?.number || `DEMO-IT-${String(n).padStart(4, '0')}`, date: previous?.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) });
      publish({ orders: previous ? snapshot.orders.map((o) => o.id === id ? order : o) : [order, ...snapshot.orders], notice: `${order.number} ${previous ? 'updated' : 'saved'} for this demo session only. No real order submitted.` });
      return { order, errors: {} };
    },
  };
}
export const demoStore = createDemoStore();
