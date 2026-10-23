// Pure session-only transaction planning. No storage, network or master writes.
const plans = new WeakMap();
export function freezeTransfer(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTransfer);
    Object.freeze(value);
  }
  return value;
}
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
export const equalTransfer = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

export function planSessionOrders(snapshot, incoming) {
  const ids = new Set(), numbers = new Set(), dependencies = new Map();
  const entries = incoming.map(({ line, order, patients, errors = [] }) => {
    const problems = [...errors];
    const previous = snapshot.orders.find((o) => o.id === order?.id);
    if (order) {
      if (ids.has(order.id) || numbers.has(order.number)) problems.push('Duplicate order ID or number in this file.');
      ids.add(order.id); numbers.add(order.number);
      if (snapshot.orders.some((o) => (o.id === order.id) !== (o.number === order.number))) {
        problems.push('Order ID and order number conflict with an existing order. Keep both original identifiers for an update.');
      }
      for (const patient of patients || []) {
        const existing = snapshot.patients?.find((p) => p.id === patient.id) || dependencies.get(patient.id);
        if (existing && !equalTransfer(existing, patient)) problems.push(`Patient ${patient.id} conflicts with the session directory or another file row. Patient history is never overwritten by order imports.`);
        else dependencies.set(patient.id, patient);
      }
    }
    return { line, order, patients: patients || [], previous, errors: problems,
      action: problems.length ? 'Rejected' : previous ? equalTransfer(previous, order) ? 'Unchanged' : 'Update' : 'Add',
      changed: previous && order ? [...new Set([...Object.keys(previous), ...Object.keys(order)])].filter((k) => !equalTransfer(previous[k], order[k])) : [] };
  });
  const newPatients = [...dependencies.values()].filter((p) => !snapshot.patients?.some((old) => old.id === p.id));
  const review = freezeTransfer({ entries, additions: entries.filter((e) => e.action === 'Add').length,
    updates: entries.filter((e) => e.action === 'Update').length, unchanged: entries.filter((e) => e.action === 'Unchanged').length,
    rejected: entries.filter((e) => e.action === 'Rejected').length,
    patientAdditions: newPatients.length, valid: entries.length > 0 && entries.every((e) => !e.errors.length) });
  if (review.valid) {
    const replacements = new Map(entries.map((e) => [e.order.id, e.order]));
    const orders = [...entries.filter((e) => e.action === 'Add').map((e) => e.order),
      ...snapshot.orders.map((o) => replacements.get(o.id) || o)];
    plans.set(review, { ordersRef: snapshot.orders, patientsRef: snapshot.patients,
      patch: freezeTransfer({ orders, ...(snapshot.patients ? { patients: [...snapshot.patients, ...newPatients] } : {}) }) });
  }
  return review;
}

export function acceptSessionOrders(review, snapshot, confirmUpdates) {
  const plan = plans.get(review);
  if (!plan || !review.valid) throw new Error('Review a valid file before importing.');
  if (plan.ordersRef !== snapshot.orders || plan.patientsRef !== snapshot.patients) throw new Error('Session records changed after review. Review the file again before applying it.');
  if (review.updates && confirmUpdates !== true) throw new Error('Explicitly confirm changes to existing orders.');
  plans.delete(review); // one confirmation, one atomic publication
  return plan.patch;
}

export function sequenceAfter(records, expression, current) {
  return records.reduce((maximum, row) => {
    const match = expression.exec(row.id);
    const value = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? Math.max(maximum, value) : maximum;
  }, current);
}
