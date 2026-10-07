// Isolated, in-memory preview only. Never import master or persistence services here.
const locations = [
  { id: 'demo-warehouse', name: 'Demo Main Warehouse' },
  { id: 'demo-clinic', name: 'Demo Clinic Store' },
  { id: 'demo-cold-room', name: 'Demo Cold Room' },
  { id: 'demo-empty', name: 'Demo Empty Store' },
];
const products = [
  { id: 'demo-dust', name: 'Demo House Dust Mite Allergen', unit: 'vials' },
  { id: 'demo-pollen', name: 'Demo Grass Pollen Allergen', unit: 'vials' },
  { id: 'demo-mould', name: 'Demo Mould Allergen', unit: 'bottles' },
];

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createDemoSnapshot() {
  return freeze({
    locations: locations.map((l) => ({ ...l })),
    products: products.map((p) => ({ ...p })),
    balances: {
      'demo-warehouse': { 'demo-dust': 48, 'demo-pollen': 32, 'demo-mould': 15 },
      'demo-clinic': { 'demo-dust': 12, 'demo-pollen': 8 },
      'demo-cold-room': { 'demo-mould': 6 },
      'demo-empty': {},
    },
    movements: [{
      id: 'demo-movement-example', sourceName: 'Demo Main Warehouse', destinationName: 'Demo Clinic Store',
      date: '2026-10-01', deliveredBy: 'Example demo operator',
      lines: [
        { productId: 'demo-dust', productName: products[0].name, unit: 'vials', quantity: 4 },
        { productId: 'demo-pollen', productName: products[1].name, unit: 'vials', quantity: 2 },
      ],
    }],
    notice: '',
  });
}

export function validateMovement(snapshot, values = {}) {
  const errors = {};
  const source = snapshot.locations.find((l) => l.id === values.sourceId);
  const destination = snapshot.locations.find((l) => l.id === values.destinationId);
  if (!source) errors.sourceId = 'Choose a demo source location.';
  if (!destination) errors.destinationId = 'Choose a demo destination location.';
  else if (values.sourceId === values.destinationId) errors.destinationId = 'Destination must differ from source.';
  const date = typeof values.date === 'string' ? values.date : '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    errors.date = 'Enter a valid movement date.';
  }
  const deliveredBy = typeof values.deliveredBy === 'string' ? values.deliveredBy.trim() : '';
  if (!deliveredBy || deliveredBy.length > 80) errors.deliveredBy = 'Enter a delivered-by name (1–80 characters).';
  const requested = Array.isArray(values.lines) ? values.lines : [];
  if (!requested.length) errors.lines = 'Select at least one product to move.';
  const seen = new Set();
  const lines = requested.map((line) => {
    const product = snapshot.products.find((p) => p.id === line?.productId);
    const available = snapshot.balances[values.sourceId]?.[line?.productId] || 0;
    const raw = line?.quantity;
    const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
    const quantity = Number(text);
    const key = `quantity.${line?.productId}`;
    if (!product || !available) errors[key] = 'This product has no available stock at the source.';
    else if (seen.has(product.id)) errors[key] = 'Select each product only once.';
    else if (!text || !Number.isFinite(quantity) || !Number.isSafeInteger(quantity) || quantity <= 0) {
      errors[key] = `Enter a positive whole number of ${product.unit}.`;
    } else if (quantity > available) errors[key] = `Only ${available} ${product.unit} are available.`;
    else if (!Number.isSafeInteger((snapshot.balances[values.destinationId]?.[product.id] || 0) + quantity)) {
      errors[key] = 'The resulting destination quantity is too large.';
    }
    seen.add(line?.productId);
    return { productId: product?.id, productName: product?.name, unit: product?.unit, quantity };
  });
  return { errors, lines, source, destination, date, deliveredBy };
}

export function createMoveStocksStore(initial = createDemoSnapshot()) {
  let snapshot = freeze(initial);
  const listeners = new Set();
  const applied = new Map();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    submitMovement(values, submissionId) {
      if (typeof submissionId !== 'string' || !submissionId.trim()) {
        return { errors: { lines: 'This draft needs a submission identifier. Return to the list and try again.' } };
      }
      // An already-applied draft is returned without revalidating depleted stock.
      if (applied.has(submissionId)) return { errors: {}, movement: applied.get(submissionId) };
      const result = validateMovement(snapshot, values);
      if (Object.keys(result.errors).length) return { errors: result.errors };
      const balances = Object.fromEntries(Object.entries(snapshot.balances).map(([id, stock]) => [id, { ...stock }]));
      for (const line of result.lines) {
        balances[result.source.id][line.productId] -= line.quantity;
        balances[result.destination.id][line.productId] = (balances[result.destination.id][line.productId] || 0) + line.quantity;
      }
      const movement = freeze({
        id: submissionId, sourceName: result.source.name, destinationName: result.destination.name,
        date: result.date, deliveredBy: result.deliveredBy, lines: result.lines,
      });
      snapshot = freeze({
        ...snapshot, balances, movements: [movement, ...snapshot.movements],
        notice: 'Demo movement recorded. Demo availability updated for this browser session only.',
      });
      applied.set(submissionId, movement);
      listeners.forEach((listener) => listener());
      return { errors: {}, movement };
    },
  };
}

export const moveStocksStore = createMoveStocksStore();
