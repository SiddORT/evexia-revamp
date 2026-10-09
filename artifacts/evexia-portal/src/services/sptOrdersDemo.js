// Fictional evaluation data only. No storage, domain APIs, or master services.
export const DOCTORS = Object.freeze([
  { id: 'DEMO-DR-001', name: 'Dr. Mira Example' },
  { id: 'DEMO-DR-002', name: 'Dr. Arun Sample' },
  { id: 'DEMO-DR-003', name: 'Dr. Leela Fiction' },
].map(Object.freeze));
export const MRS = Object.freeze([
  { id: 'DEMO-MR-001', name: 'Dev Sample' },
  { id: 'DEMO-MR-002', name: 'Riya Example' },
  { id: 'DEMO-MR-003', name: 'Noor Fiction' },
].map(Object.freeze));
export const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const seedPatients = [
  { id: 'DEMO-PT-001', name: 'Asha Example', gender: 'Female', age: 32 },
  { id: 'DEMO-PT-002', name: 'Rohan Sample', gender: 'Male', age: 24 },
  { id: 'DEMO-PT-003', name: 'Taylor Fiction', gender: 'Other', age: 41 },
  { id: 'DEMO-PT-004', name: 'Kiran Example', gender: 'Prefer not to say', age: 18 },
];

// Parse decimal lexemes, never multiply a floating-point rupee value.
export function parseAmount(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function totalMinor(patients) {
  return patients.reduce((sum, patient) => sum + (parseAmount(patient.amount) ?? 0n), 0n);
}
export function money(minor) {
  const whole = (minor / 100n).toLocaleString('en-IN');
  return `₹${whole}.${String(minor % 100n).padStart(2, '0')}`;
}
export function validateOrder(values) {
  const errors = {};
  if (!DOCTORS.some((item) => item.id === values.doctorId)) errors.doctorId = 'Choose a demo doctor.';
  if (!MRS.some((item) => item.id === values.mrId)) errors.mrId = 'Choose a demo MR.';
  if (!values.patients.length) errors.patients = 'Add at least one demo patient.';
  if (new Set(values.patients.map((p) => p.id)).size !== values.patients.length) errors.patients = 'Each patient can appear only once.';
  values.patients.forEach((p) => {
    if (parseAmount(p.amount) === null) errors[`amount-${p.id}`] = 'Enter a non-negative amount with up to two decimal places (for example 250.00).';
  });
  return errors;
}
const freezeOrder = (order) => Object.freeze({
  ...order, patients: Object.freeze(order.patients.map((patient) => Object.freeze({ ...patient }))),
});
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function createDemoStore() {
  let patientSequence = seedPatients.length;
  let orderSequence = 2;
  const listeners = new Set();
  let snapshot = Object.freeze({
    patients: Object.freeze(seedPatients.map((p) => Object.freeze({ ...p }))),
    orders: Object.freeze([
      freezeOrder({ id: 'demo-spt-2', number: 'DEMO-SPT-0002', date: today(), doctorId: DOCTORS[1].id, doctorName: DOCTORS[1].name, mrId: '', mrName: '', patients: [{ ...seedPatients[2], amount: '' }], remarks: 'Fictional draft — choose an MR and enter an amount.', status: 'Draft' }),
      freezeOrder({ id: 'demo-spt-1', number: 'DEMO-SPT-0001', date: today(), doctorId: DOCTORS[0].id, doctorName: DOCTORS[0].name, mrId: MRS[0].id, mrName: MRS[0].name, patients: [{ ...seedPatients[0], amount: '1500.00' }, { ...seedPatients[1], amount: '1250.50' }], remarks: 'Fictional saved order for workflow review only.', status: 'Saved' }),
    ]),
    notice: '',
  });
  function publish(next) {
    snapshot = Object.freeze({ ...snapshot, ...next });
    listeners.forEach((listener) => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setNotice(notice) { publish({ notice }); },
    registerPatient(values) {
      const errors = {};
      const name = String(values.name ?? '').trim();
      const age = String(values.age ?? '');
      if (!name || name.length > 100) errors.name = 'Enter a demo name of 1–100 characters.';
      if (!GENDERS.includes(values.gender)) errors.gender = 'Choose a gender.';
      if (!/^\d{1,3}$/.test(age) || Number(age) > 120) errors.age = 'Enter a whole age from 0 to 120.';
      if (Object.keys(errors).length) return { errors };
      const patient = Object.freeze({ id: `DEMO-PT-${String(++patientSequence).padStart(3, '0')}`, name, gender: values.gender, age: Number(age) });
      publish({ patients: Object.freeze([...snapshot.patients, patient]) });
      return { patient, errors: {} };
    },
    saveOrder(values, status, id) {
      if (!['Draft', 'Saved'].includes(status)) return { errors: { form: 'Choose Draft or Saved.' } };
      const previous = id ? snapshot.orders.find((order) => order.id === id) : null;
      if (id && !previous) return { errors: { form: 'This demo order no longer exists. Reloading resets the demo.' } };
      if (previous?.status === 'Saved') return { errors: { form: 'Saved demo orders are read-only.' } };
      const errors = status === 'Saved' ? validateOrder(values) : {};
      // All patient snapshots originate from this isolated directory.
      if (values.patients.some((p) => !snapshot.patients.some((source) => source.id === p.id))) errors.patients = 'Choose patients from the demo directory.';
      if (new Set(values.patients.map((p) => p.id)).size !== values.patients.length) errors.patients = 'Each patient can appear only once.';
      if (Object.keys(errors).length) return { errors };
      const sequence = previous ? null : ++orderSequence;
      const order = freezeOrder({
        id: previous?.id || `demo-spt-${sequence}`,
        number: previous?.number || `DEMO-SPT-${String(sequence).padStart(4, '0')}`,
        date: previous?.date || today(),
        doctorId: values.doctorId, doctorName: DOCTORS.find((d) => d.id === values.doctorId)?.name || '',
        mrId: values.mrId, mrName: MRS.find((mr) => mr.id === values.mrId)?.name || '',
        patients: values.patients.map((p) => ({ ...snapshot.patients.find((source) => source.id === p.id), amount: p.amount })),
        remarks: values.remarks, status,
      });
      publish({
        orders: Object.freeze(previous ? snapshot.orders.map((old) => old.id === id ? order : old) : [order, ...snapshot.orders]),
        notice: `${order.number} ${status === 'Draft' ? 'saved as Draft' : 'saved'} for this demo session only. No real order was submitted.`,
      });
      return { order, errors: {} };
    },
  };
}
export const demoStore = createDemoStore();
