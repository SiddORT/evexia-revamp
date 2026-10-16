// MR business data is deliberately fictional and memory-only. No transport,
// browser stores, patient records, or Admin business services belong here.
export const DEMO_DATE = '2026-10-16';
export const FINANCIAL_YEAR = '2026–2027';
export const PRODUCTS = Object.freeze([
  { id: 'demo-spt', name: 'SPT starter panel (demo)', category: 'Skin Prick Test', price: 250000 },
  { id: 'demo-kit', name: 'Allergy care kit (demo)', category: 'Kits & Consumables', price: 125050 },
  { id: 'demo-therapy', name: 'Immunotherapy starter (demo)', category: 'Immunotherapy', price: 450000 },
  { id: 'demo-lupin', name: 'Lupin assessment pack (demo)', category: 'Lupin', price: 180075 },
]);
export const QUARTER_TARGETS = Object.freeze([3000000, 3000000, 3000000, 3000000]);
const METHODS = ['Cash', 'UPI', 'Bank transfer', 'Cheque'];
const sum = (values) => values.reduce((a, b) => {
  const next = a + b;
  if (!Number.isSafeInteger(next)) throw new Error('Demo total exceeds the supported limit.');
  return next;
}, 0);
const text = (value) => typeof value === 'string' ? value.trim() : '';
export function parseMoney(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Enter a positive amount with at most two decimal places, without signs or separators.');
  }
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function money(value) {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid demo money value.');
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value / 100);
}
function dateValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
function ownDoctor(state, id) {
  const doctor = state.doctors.find((d) => d.id === id && d.owner === state.owner);
  if (!doctor) throw new Error('Select one of your demo doctors.');
  return doctor;
}
function lineItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > PRODUCTS.length) throw new Error('Choose at least one demo product.');
  const seen = new Set();
  return items.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    const quantity = typeof item.quantity === 'string' && /^[1-9]\d{0,3}$/.test(item.quantity) ? Number(item.quantity) : item.quantity;
    if (!product || seen.has(product.id)) throw new Error('Choose each valid demo product only once.');
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 9999) throw new Error('Quantities must be positive whole numbers, at most 9999.');
    seen.add(product.id);
    return { productId: product.id, quantity };
  });
}
export function calculateOrderTotal(items) {
  return sum(lineItems(items).map((item) => PRODUCTS.find((p) => p.id === item.productId).price * item.quantity));
}
function activity(state, label, href, date = DEMO_DATE) {
  return [{ id: `demo-event-${state.sequence}`, label, href, date }, ...state.activity];
}
export function doctorErrors(input) {
  const errors = {};
  for (const field of ['name', 'qualification', 'registration', 'clinic', 'phone', 'address']) {
    if (!text(input[field])) errors[field] = 'This field is required. Use fictional details only.';
    else if (text(input[field]).length > (field === 'address' ? 500 : 120)) errors[field] = 'Please shorten this field.';
  }
  if (text(input.phone) && !/^[0-9 ()+-]{6,24}$/.test(text(input.phone))) errors.phone = 'Enter a fictional contact number (6–24 characters).';
  if (text(input.email) && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(input.email)) || text(input.email).length > 120)) errors.email = 'Enter a valid fictional email or leave it blank.';
  return errors;
}
export function addDoctor(state, input) {
  const errors = doctorErrors(input);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  if (state.doctors.some((d) => d.registration.toLowerCase() === text(input.registration).toLowerCase())) throw new Error('This demo registration number already exists.');
  const id = `demo-doctor-${state.sequence}`;
  // Explicit allowlist prevents accidentally introducing clinical/patient fields.
  const doctor = { id, owner: state.owner, status: 'Active', phoneCountry: text(input.phoneCountry) || 'IN' };
  for (const field of ['name', 'qualification', 'registration', 'clinic', 'phone', 'email', 'address']) doctor[field] = text(input[field]);
  return { ...state, sequence: state.sequence + 1, doctors: [...state.doctors, doctor],
    achievements: [...new Set([...state.achievements, 'onboarding'])],
    activity: activity(state, `${doctor.name} onboarded · demo`, `/mr/doctors/${id}`) };
}
export function saveOrder(state, input, place = false, id = null) {
  ownDoctor(state, input.doctorId);
  const old = id ? state.orders.find((o) => o.id === id) : null;
  if (id && (!old || old.status !== 'draft')) throw new Error('Only an existing demo draft can be changed or placed.');
  const items = lineItems(input.items);
  const order = { id: id || `demo-order-${state.sequence}`, doctorId: input.doctorId, items,
    status: place ? 'placed' : 'draft', date: DEMO_DATE, total: calculateOrderTotal(items) };
  return { ...state, sequence: state.sequence + 1,
    orders: old ? state.orders.map((o) => o.id === id ? order : o) : [...state.orders, order],
    achievements: place ? [...new Set([...state.achievements, 'first-order'])] : state.achievements,
    activity: activity(state, `${place ? 'Order placed' : 'Draft saved'} · ${order.id}`, `/mr/orders/${order.id}`) };
}
export function orderBalance(state, order) {
  if (order.status !== 'placed') return 0;
  return order.total - sum(state.payments.filter((p) => p.orderId === order.id && p.kind !== 'advance').map((p) => p.amount));
}
export function orderPaymentStatus(state, order) {
  const balance = orderBalance(state, order);
  return order.status !== 'placed' ? 'Not payable' : balance === 0 ? 'Paid' : balance === order.total ? 'Unpaid' : 'Partial';
}
export function recordPayment(state, input) {
  ownDoctor(state, input.doctorId);
  if (!['advance', 'partial', 'full'].includes(input.kind)) throw new Error('Select advance, partial or full payment.');
  const amount = parseMoney(input.amount);
  if (amount <= 0) throw new Error('Payment must be greater than zero.');
  if (!dateValid(input.date) || input.date > DEMO_DATE) throw new Error(`Choose a valid payment date on or before ${DEMO_DATE}.`);
  if (!METHODS.includes(input.method)) throw new Error('Select a payment method.');
  if (text(input.reference).length > 100 || text(input.remark).length > 300) throw new Error('Shorten the reference or remark.');
  let orderId = null;
  if (input.kind !== 'advance') {
    const order = state.orders.find((o) => o.id === input.orderId && o.doctorId === input.doctorId && o.status === 'placed');
    if (!order) throw new Error('Select an eligible placed order for this doctor.');
    if (input.date < order.date) throw new Error('Payment date cannot precede the placed order.');
    const balance = orderBalance(state, order);
    if (balance <= 0 || amount > balance) throw new Error('Payment exceeds the remaining payable balance.');
    if (input.kind === 'partial' && amount >= balance) throw new Error('Partial payment must be below the remaining balance. Choose full payment instead.');
    if (input.kind === 'full' && amount !== balance) throw new Error('Full payment must equal the remaining balance.');
    orderId = order.id;
  }
  const payment = { id: `demo-payment-${state.sequence}`, doctorId: input.doctorId, orderId,
    kind: input.kind, amount, date: input.date, method: input.method, reference: text(input.reference), remark: text(input.remark) };
  return { ...state, sequence: state.sequence + 1, payments: [...state.payments, payment],
    activity: activity(state, `${input.kind === 'advance' ? 'Unapplied advance' : 'Payment'} recorded · demo`, `/mr/payments/${payment.id}`, input.date) };
}
function quarterFor(date) {
  if (date < '2026-04-01' || date > '2027-03-31') return null;
  return `Q${Math.floor(((Number(date.slice(5, 7)) + 8) % 12) / 3) + 1}`;
}
export function summarize(state, quarter = 'all') {
  if (!['all', 'Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) throw new Error('Unknown demo quarter.');
  const eligible = state.orders.filter((o) => o.status === 'placed' && quarterFor(o.date) && (quarter === 'all' || quarterFor(o.date) === quarter));
  const target = quarter === 'all' ? sum(QUARTER_TARGETS) : QUARTER_TARGETS[Number(quarter.slice(1)) - 1];
  const achieved = sum(eligible.map((o) => o.total));
  const percentage = achieved / target * 100;
  return { target, achieved, remaining: Math.max(0, target - achieved), percentage, fill: Math.min(100, percentage),
    collections: sum(state.payments.map((p) => p.amount)),
    outstanding: sum(state.orders.filter((o) => o.status === 'placed').map((o) => orderBalance(state, o))),
    advances: sum(state.payments.filter((p) => p.kind === 'advance').map((p) => p.amount)),
    nextMilestone: [25, 50, 75, 100].find((percent) => percentage < percent) ?? null,
    milestones: [25, 50, 75, 100].map((percent) => ({ percent, reached: percentage >= percent })) };
}
export function createWorkspace(owner) {
  if (typeof owner !== 'string' || !owner) throw new Error('A verified MR owner is required.');
  const doctors = [
    { id: 'demo-doctor-a', name: 'Dr. Mira Sample', clinic: 'Demo Bloom Clinic', qualification: 'MD', registration: 'DEMO-REG-A', phone: '0000000000', email: 'mira@example.test', address: '10 Fictional Lane, Demo City' },
    { id: 'demo-doctor-b', name: 'Dr. Arun Example', clinic: 'Demo Cedar Clinic', qualification: 'MBBS', registration: 'DEMO-REG-B', phone: '0000000001', email: 'arun@example.test', address: '20 Sample Road, Demo City' },
    { id: 'demo-doctor-c', name: 'Dr. Tara Fiction', clinic: 'Demo Fern Clinic', qualification: 'MD, DNB', registration: 'DEMO-REG-C', phone: '0000000002', email: 'tara@example.test', address: '30 Example Avenue, Demo City' },
  ].map((d) => ({ ...d, owner, phoneCountry: 'IN', status: 'Active' }));
  const orders = [
    { id: 'demo-order-a', doctorId: doctors[0].id, items: [{ productId: 'demo-spt', quantity: 8 }], status: 'placed', date: '2026-04-16', total: 2000000 },
    { id: 'demo-order-b', doctorId: doctors[1].id, items: [{ productId: 'demo-therapy', quantity: 7 }], status: 'placed', date: '2026-07-16', total: 3150000 },
    { id: 'demo-order-c', doctorId: doctors[2].id, items: [{ productId: 'demo-kit', quantity: 4 }], status: 'placed', date: DEMO_DATE, total: 500200 },
    { id: 'demo-order-d', doctorId: doctors[0].id, items: [{ productId: 'demo-lupin', quantity: 2 }], status: 'draft', date: DEMO_DATE, total: 360150 },
  ];
  return { owner, doctors, orders, sequence: 10, achievements: [], payments: [
    { id: 'demo-payment-a', doctorId: doctors[0].id, orderId: orders[0].id, kind: 'partial', amount: 1000000, date: '2026-04-17', method: 'Cash', reference: 'DEMO-ONLY', remark: '' },
    { id: 'demo-payment-b', doctorId: doctors[1].id, orderId: null, kind: 'advance', amount: 150000, date: '2026-07-17', method: 'UPI', reference: '', remark: 'Unapplied demo credit' },
  ], activity: [
    { id: 'demo-event-c', label: 'Sample kit order placed · demo', href: '/mr/orders/demo-order-c', date: DEMO_DATE },
    { id: 'demo-event-b', label: 'Unapplied advance recorded · demo', href: '/mr/payments/demo-payment-b', date: '2026-07-17' },
    { id: 'demo-event-a', label: 'Dr. Mira Sample · demo doctor', href: '/mr/doctors/demo-doctor-a', date: '2026-04-16' },
  ] };
}
