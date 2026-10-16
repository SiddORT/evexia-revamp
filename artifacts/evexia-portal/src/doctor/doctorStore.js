// Doctor-only fictional data. No auth, network, storage or Admin business imports.
export const doctor = Object.freeze({ id: 'doctor-demo', name: 'Dr. Mira Sen', clinic: 'Willow Allergy Clinic', specialty: 'Allergy care · fictional doctor' });
export const products = Object.freeze([
  Object.freeze({ id: 'sample-kit', name: 'Sample allergy-care kit (illustrative)', priceMinor: 125050 }),
  Object.freeze({ id: 'sample-diary', name: 'Sample care diary', priceMinor: 18525 }),
  Object.freeze({ id: 'sample-covers', name: 'Sample protective covers', priceMinor: 46000 }),
]);
export const mappedMR = {
  name: 'Arun Vale (fictional)', territory: 'Willow demonstration territory',
  email: 'arun@example.invalid', phone: 'Not connected · sample contact',
  history: [
    { date: '2026-01-10', title: 'Previous assignment: Nila Rowan', detail: 'Fictional assignment ended on 30 June 2026.', current: false },
    { date: '2026-07-01', title: 'Current assignment: Arun Vale', detail: 'Sample business contact for this demo doctor.', current: true },
    { date: '2026-09-10', title: 'Sample clinic introduction', detail: 'Illustrative in-person product overview; no message was sent.' },
    { date: '2026-10-01', title: 'Sample catalogue discussion', detail: 'Fictional interaction recorded for demonstration.' },
  ],
};
export const reviews = [
  { id: 'review-1', name: 'Sample patient A', rating: 5, text: 'The clinic team explained the visit clearly and gave me time to ask questions.', date: '2026-09-20' },
  { id: 'review-2', name: 'Sample patient B', rating: 4, text: 'A welcoming space and an organised appointment. I appreciated the clear follow-up notes.', date: '2026-09-25' },
  { id: 'review-3', name: 'Sample patient C', rating: 5, text: 'A thoughtful, friendly clinic experience from arrival to the end of the visit.', date: '2026-10-02' },
];
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function offsetDate(offset) {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function date(value, label = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error(`${label} is required.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw Error(`${label} must be a valid calendar date.`);
  return value;
}
function text(value, label, min = 1, max = 1000) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < min || result.length > max) throw Error(`${label} must contain ${min}–${max} characters.`);
  return result;
}
export function parseMoney(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)) throw Error('Enter a non-negative amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function money(minor) {
  if (!Number.isSafeInteger(minor)) throw Error('Invalid minor-unit amount.');
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}
function seed() {
  const patients = [
    { id: 'patient-1', doctorId: doctor.id, name: 'Avery Bloom', age: '34', phone: '', email: 'avery@example.invalid', notes: 'Fictional initial visit: requests a clear record of sample care activities.', createdDate: offsetDate(-30) },
    { id: 'patient-2', doctorId: doctor.id, name: 'Rowan Lake', age: '28', phone: '', email: 'rowan@example.invalid', notes: 'Sample visit note: prefers an in-app reminder example.', createdDate: offsetDate(-20) },
    { id: 'patient-3', doctorId: doctor.id, name: 'Jamie Fern', age: '42', phone: '', email: 'jamie@example.invalid', notes: 'Fictional consultation note for demonstration only.', createdDate: offsetDate(-10) },
  ];
  return {
    patients,
    tests: [{ id: 'test-1', patientId: 'patient-1', date: offsetDate(-7), type: 'Sample skin-prick record', allergen: 'Sample grass extract', result: '3', unit: 'mm (wheal diameter)', positiveControl: '5', negativeControl: '0' }],
    doses: [
      { id: 'dose-1', patientId: 'patient-1', scheduledDate: offsetDate(-2), details: 'Sample vial A · 0.1 mL · fictional subcutaneous entry, not a prescription', reminderDate: offsetDate(-2), completedDate: null },
      { id: 'dose-2', patientId: 'patient-2', scheduledDate: today(), details: 'Sample vial B · 0.2 mL · fictional oral entry, not a prescription', reminderDate: today(), completedDate: null },
      { id: 'dose-3', patientId: 'patient-1', scheduledDate: offsetDate(-14), details: 'Sample vial A · 0.1 mL · fictional recorded event', reminderDate: '', completedDate: offsetDate(-13) },
      { id: 'dose-4', patientId: 'patient-3', scheduledDate: offsetDate(3), details: 'Sample vial C · 0.1 mL · illustrative details entered manually', reminderDate: offsetDate(2), completedDate: null },
    ],
    orders: [
      { id: 'order-1', patientId: 'patient-1', items: [{ productId: products[0].id, name: products[0].name, quantity: 1, priceMinor: products[0].priceMinor }], status: 'Shipped', date: offsetDate(-6), totalMinor: 125050, timeline: [{ date: offsetDate(-6), title: 'Demo order placed' }, { date: offsetDate(-3), title: 'Sample shipment progress · not treatment' }] },
      { id: 'order-2', patientId: 'patient-2', items: [{ productId: products[1].id, name: products[1].name, quantity: 2, priceMinor: products[1].priceMinor }], status: 'Draft', date: offsetDate(-1), totalMinor: 37050, timeline: [{ date: offsetDate(-1), title: 'Draft saved · not submitted' }] },
      { id: 'order-3', patientId: 'patient-3', items: [{ productId: products[2].id, name: products[2].name, quantity: 1, priceMinor: products[2].priceMinor }], status: 'Delivered', date: offsetDate(-8), totalMinor: 46000, timeline: [{ date: offsetDate(-8), title: 'Demo order placed' }, { date: offsetDate(-4), title: 'Sample delivery · not dose completion' }] },
    ],
    payments: [{ id: 'payment-1', orderId: 'order-1', amountMinor: 50000, date: offsetDate(-5) }, { id: 'payment-2', orderId: 'order-3', amountMinor: 46000, date: offsetDate(-7) }],
    feedback: [],
  };
}
const listeners = new Set();
let sequence = 10;
let requests = new Map();
function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
let state = immutable(seed());
export const getSnapshot = () => state;
export const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
function publish(next) { state = immutable(next); listeners.forEach((listener) => listener()); }
export function resetDemo() { requests = new Map(); sequence = 10; publish(seed()); }
function append(collection, value) {
  const record = { ...value, id: `${collection}-${++sequence}` };
  publish({ ...state, [collection]: [...state[collection], record] });
  return record;
}
function patient(id) {
  if (!state.patients.some((record) => record.id === id && record.doctorId === doctor.id)) throw Error('Choose a patient belonging to the fictional demo doctor.');
  return id;
}
function find(collection, id) {
  const result = state[collection].find((record) => record.id === id);
  if (!result) throw Error('This demo record is unavailable. Reloading resets demo data.');
  return result;
}
function replace(collection, value) {
  publish({ ...state, [collection]: state[collection].map((record) => record.id === value.id ? value : record) });
  return value;
}
function once(kind, requestId, input, create) {
  if (requestId == null || requestId === '') throw Error('A demo submission reference is required.');
  const key = `${kind}:${text(requestId, 'Submission reference', 1, 200)}`;
  const fingerprint = JSON.stringify(input);
  const existing = requests.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw Error('This submission reference has already been used for different inputs.');
    return existing.record;
  }
  const record = create();
  requests.set(key, { fingerprint, record });
  return record;
}
export function addPatient(input) {
  const name = text(input.name, 'Sample name', 2, 100);
  const age = String(input.age ?? '');
  if (!/^(0|[1-9]\d{0,2})$/.test(age) || Number(age) > 120) throw Error('Enter a whole sample age between 0 and 120.');
  const email = text(input.email || '', 'Sample email', 0, 120);
  if (email && !/^[^\s@]+@example\.invalid$/.test(email)) throw Error('Use only a fictional @example.invalid email address.');
  const phone = text(input.phone || '', 'Sample phone', 0, 40);
  if (phone && !/^[+\d ()-]{4,25}$/.test(phone)) throw Error('Enter a fictional sample phone using digits, spaces, +, ( ) or -.');
  return append('patients', { doctorId: doctor.id, name, age, email, phone, notes: text(input.notes || '', 'Care notes', 0, 1000), createdDate: today() });
}
export function addTest(input) {
  const record = {
    patientId: patient(input.patientId), date: date(input.date, 'Test date'),
    type: text(input.type, 'Test type', 2, 100), allergen: text(input.allergen, 'Sample allergen', 2, 100),
    result: text(input.result, 'Illustrative result', 1, 100), unit: text(input.unit, 'Result unit', 1, 60),
    positiveControl: text(input.positiveControl, 'Sample positive control', 1, 100),
    negativeControl: text(input.negativeControl, 'Sample negative control', 1, 100),
  };
  if (record.date > today()) throw Error('A recorded sample test cannot have a future date.');
  return append('tests', record);
}
export function addDose(input) {
  const record = { patientId: patient(input.patientId), scheduledDate: date(input.scheduledDate, 'Scheduled date'), details: text(input.details, 'Explicit sample dose details', 5, 1000), reminderDate: input.reminderDate ? date(input.reminderDate, 'Reminder date') : '', completedDate: null };
  return append('doses', record);
}
export function completeDose(id, completionDate) {
  const record = find('doses', id);
  if (record.completedDate) return record;
  const completedDate = date(completionDate, 'Recorded completion date');
  if (completedDate > today()) throw Error('Recorded completion cannot be in the future.');
  return replace('doses', { ...record, completedDate });
}
export function setReminder(id, reminderDate) {
  const record = find('doses', id);
  if (record.completedDate) throw Error('A completed demo dose does not need a reminder.');
  return replace('doses', { ...record, reminderDate: date(reminderDate, 'Reminder date') });
}
export function addOrder(input) {
  return once('order', input.requestId, input, () => {
    patient(input.patientId);
    if (!['Draft', 'Placed'].includes(input.status)) throw Error('Choose Draft or Placed.');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > products.length) throw Error('Choose at least one sample item.');
    const seen = new Set();
    const items = input.items.map(({ productId, quantity }) => {
      const product = products.find((item) => item.id === productId);
      if (!product || seen.has(productId)) throw Error('Choose valid, distinct sample products.');
      seen.add(productId);
      if (!/^[1-9]\d{0,2}$/.test(String(quantity))) throw Error('Quantities must be positive whole numbers up to 999.');
      return { productId, name: product.name, priceMinor: product.priceMinor, quantity: Number(quantity) };
    });
    return append('orders', { patientId: input.patientId, items, status: input.status, date: today(), totalMinor: items.reduce((total, item) => total + item.quantity * item.priceMinor, 0), timeline: [{ date: today(), title: input.status === 'Draft' ? 'Draft saved · not submitted' : 'Demo order placed · no real fulfillment' }] });
  });
}
export function placeDraft(id) {
  const order = find('orders', id);
  if (order.status !== 'Draft') return order;
  return replace('orders', { ...order, status: 'Placed', timeline: [...order.timeline, { date: today(), title: 'Demo draft placed · no real fulfillment' }] });
}
export function orderBalance(order, snapshot = state) {
  return order.status === 'Draft' ? 0 : order.totalMinor - snapshot.payments.filter((payment) => payment.orderId === order.id).reduce((total, payment) => total + payment.amountMinor, 0);
}
export function paymentStatus(order, snapshot = state) {
  if (order.status === 'Draft') return 'Draft';
  const balance = orderBalance(order, snapshot);
  return balance === 0 ? 'Paid' : balance === order.totalMinor ? 'Unpaid' : 'Partially paid';
}
export function addPayment(input) {
  return once('payment', input.requestId, input, () => {
    const order = find('orders', input.orderId);
    if (order.status === 'Draft') throw Error('Drafts are not submitted and cannot be paid.');
    const amountMinor = parseMoney(input.amount);
    if (amountMinor <= 0 || amountMinor > orderBalance(order)) throw Error('Payment must be positive and no greater than the outstanding balance.');
    const paymentDate = date(input.date, 'Payment date');
    if (paymentDate > today() || paymentDate < order.date) throw Error('Payment date must be between the order date and today.');
    return append('payments', { orderId: order.id, amountMinor, date: paymentDate });
  });
}
export function addFeedback(input) {
  if (!['Suggestion', 'Issue', 'Experience', 'Other'].includes(input.category)) throw Error('Choose a feedback category.');
  const rating = input.rating === '' || input.rating == null ? null : Number(input.rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw Error('Optional rating must be 1–5.');
  return append('feedback', { category: input.category, rating, message: text(input.message, 'Feedback message', 10, 2000), date: today() });
}
export const doseStatus = (dose, asOf = today()) => dose.completedDate ? 'Completed' : dose.scheduledDate < asOf ? 'Overdue' : 'Upcoming';
export const reviewAverage = (selectedReviews = reviews) => selectedReviews.length ? selectedReviews.reduce((sum, review) => sum + review.rating, 0) / selectedReviews.length : 0;
export function dashboard(snapshot = state) {
  return {
    patientCount: snapshot.patients.length,
    recentTests: [...snapshot.tests].sort((a, b) => b.date.localeCompare(a.date)),
    activeOrders: snapshot.orders.filter((order) => ['Placed', 'Shipped'].includes(order.status)),
    outstandingMinor: snapshot.orders.reduce((sum, order) => sum + orderBalance(order, snapshot), 0),
    upcomingDoses: snapshot.doses.filter((dose) => doseStatus(dose) === 'Upcoming').sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    overdueDoses: snapshot.doses.filter((dose) => doseStatus(dose) === 'Overdue').sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
  };
}
export function patientHistory(patientId, snapshot = state) {
  const record = snapshot.patients.find((item) => item.id === patientId);
  if (!record) return [];
  return [
    { id: `visit-${record.id}`, date: record.createdDate, title: 'Demo patient added / initial note', detail: record.notes || 'No care notes recorded.', href: `/doctor/patients/${record.id}` },
    ...snapshot.tests.filter((item) => item.patientId === patientId).map((item) => ({ id: item.id, date: item.date, title: 'Sample allergy test recorded', detail: `${item.allergen}: ${item.result} ${item.unit} · no interpretation`, href: `/doctor/tests/${item.id}` })),
    ...snapshot.doses.filter((item) => item.patientId === patientId).flatMap((item) => [
      { id: `${item.id}-scheduled`, date: item.scheduledDate, title: 'Demo dose scheduled', detail: item.details, href: `/doctor/doses/${item.id}` },
      ...(item.completedDate ? [{ id: `${item.id}-completed`, date: item.completedDate, title: 'Recorded demo completion', detail: `${item.details} · Original schedule preserved in linked dose`, href: `/doctor/doses/${item.id}` }] : []),
    ]),
    ...snapshot.orders.filter((item) => item.patientId === patientId).map((item) => ({ id: item.id, date: item.date, title: `Demo order · ${item.status}`, detail: `${money(item.totalMinor)} · ${paymentStatus(item, snapshot)} · not evidence of treatment`, href: `/doctor/orders/${item.id}` })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export function reportRows(kind, snapshot = state, { patientId = '', from = '', to = '', status = '' } = {}) {
  if (from) date(from, 'From date');
  if (to) date(to, 'To date');
  if (from && to && from > to) throw Error('From date must not be after To date.');
  let rows;
  if (kind === 'patients') rows = snapshot.patients.flatMap((patient) => patientHistory(patient.id, snapshot).map((entry) => ({ ...entry, patientId: patient.id, status: 'Recorded' })));
  else if (kind === 'tests') rows = snapshot.tests.map((item) => ({ id: item.id, patientId: item.patientId, date: item.date, title: item.type, detail: `${item.allergen}: ${item.result} ${item.unit}; positive control ${item.positiveControl}; negative control ${item.negativeControl}. Illustrative only; no diagnostic interpretation.`, status: 'Recorded' }));
  else if (kind === 'doses') rows = snapshot.doses.map((item) => ({ id: item.id, patientId: item.patientId, date: item.scheduledDate, title: 'Scheduled demo dose', detail: item.details, completedDate: item.completedDate, reminderDate: item.reminderDate, status: doseStatus(item) }));
  else if (kind === 'orders') rows = snapshot.orders.map((item) => ({ id: item.id, patientId: item.patientId, date: item.date, title: `Demo order ${item.id}`, detail: `Total ${money(item.totalMinor)} · Balance ${money(orderBalance(item, snapshot))} · Payment ${paymentStatus(item, snapshot)} · Fulfillment is separate from dosage`, status: item.status }));
  else if (kind === 'payments') rows = snapshot.payments.map((item) => ({ id: item.id, patientId: snapshot.orders.find((order) => order.id === item.orderId)?.patientId, date: item.date, title: `DEMO payment ${item.id}`, detail: `${money(item.amountMinor)} against ${item.orderId} · no money moved`, status: 'Recorded' }));
  else throw Error('Choose a supported demo report.');
  return rows.filter((row) => (!patientId || row.patientId === patientId) && (!from || row.date >= from) && (!to || row.date <= to) && (!status || row.status === status)).sort((a, b) => b.date.localeCompare(a.date));
}
