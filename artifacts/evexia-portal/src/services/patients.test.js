import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCTOR_STORAGE_KEY } from './doctors.js';
import { MR_STORAGE_KEY } from './mrs.js';
import {
  PATIENT_FIELDS, PATIENT_STORAGE_KEY, createPatient, exportPatientCSV, loadPatients,
  readPatientSnapshots, reviewPatientCSV, setPatientStatus, updatePatient, validatePatient,
} from './patients.js';
import { getSampleDosageHistory, samplePatientIndex } from './patientDosageHistory.js';

const ZONE_STORAGE_KEY = 'evexia.admin.zones.v1';
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
  };
}
test.beforeEach(() => { globalThis.window = { localStorage: storage() }; });

test('first visit seeds valid, distinct preview patients and refresh does not reseed', () => {
  const initial = readPatientSnapshots();
  assert.equal(initial.records.length, 4);
  assert.ok(initial.records.every((record) => record.name.startsWith('Sample Patient ')
    && /^PAT-[A-Z0-9-]{6,40}$/.test(record.id)
    && Object.keys(validatePatient(Object.fromEntries(PATIENT_FIELDS.map((key) => [key, record[key]]))).errors).length === 0));
  assert.equal(new Set(initial.records.map((record) => record.id)).size, 4);
  assert.equal(new Set(initial.records.map((record) => record.name)).size, 4);
  assert.deepEqual(new Set(initial.records.map((record) => record.status)), new Set(['active', 'inactive']));
  assert.ok(new Set(initial.records.map((record) => record.instructionsLanguage)).size > 1);
  assert.ok(new Set(initial.records.map((record) => record.dateOfBirth)).size > 1);
  assert.ok(new Set(initial.records.map((record) => record.doctorId)).size > 1);
  for (const record of initial.records) {
    const doctor = initial.doctors.find((item) => item.id === record.doctorId);
    const mr = initial.mrs.find((item) => item.id === doctor?.mrId);
    assert.equal(doctor.status, 'active');
    assert.ok(initial.zones.some((zone) => zone.id === mr?.zoneId));
  }
  const raw = window.localStorage.getItem(PATIENT_STORAGE_KEY);
  assert.deepEqual(readPatientSnapshots().records, initial.records);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), raw);
  const filtered = initial.records.filter((record) => record.status === 'inactive'
    && record.name.toLowerCase().includes('sample'));
  const csv = exportPatientCSV(filtered, initial.doctors);
  assert.equal(reviewPatientCSV(csv, { ...initial, records: [] }).length, filtered.length);
  assert.ok(csv.includes(filtered[0].id));
  assert.ok(!csv.includes(initial.records.find((record) => record.status === 'active').id));
  assert.ok(!csv.includes('Last Dose'));
});

test('only original built-in sample identities receive illustrative dose examples', () => {
  const snapshot = readPatientSnapshots();
  const raw = window.localStorage.getItem(PATIENT_STORAGE_KEY);
  for (const [index, patient] of snapshot.records.entries()) {
    assert.equal(samplePatientIndex(patient), index);
    const history = getSampleDosageHistory(patient, new Date(2026, 8, 26));
    assert.equal(history.previous.length, 2);
    assert.equal(history.upcoming.length, 2);
    assert.equal(history.last.date, '2026-09-15');
    assert.equal(history.next.date, '2026-10-15');
    assert.ok(history.previous.every((dose) => dose.date < '2026-09-26' && dose.name.includes('Example dose')));
    assert.ok(history.upcoming.every((dose) => dose.date >= '2026-09-26' && dose.name.includes('Example dose')));
    for (const mismatch of [
      { ...patient, createdAt: new Date().toISOString() },
      { ...patient, name: 'Ordinary Patient' },
      { ...patient, phone: '9999999999' },
      { ...patient, email: 'other@example.com' },
      { ...patient, dateOfBirth: '1999-01-01' },
      { ...patient, addressLine1: 'Elsewhere' },
      { ...patient, id: 'PAT-OTHER-001' },
    ]) assert.equal(getSampleDosageHistory(mismatch), null);
  }
  assert.equal(getSampleDosageHistory({ ...snapshot.records[0], id: 'PAT-USER-001' }), null);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), raw);
  assert.ok(!exportPatientCSV(snapshot.records, snapshot.doctors).includes('Example dose'));
});

test('example dates roll across calendar years and classify today as upcoming', () => {
  const patient = readPatientSnapshots().records[0];
  const onFifteenth = getSampleDosageHistory(patient, new Date(2026, 11, 15));
  assert.equal(onFifteenth.next.date, '2026-12-15');
  assert.equal(onFifteenth.last.date, '2026-11-15');
  const afterFifteenth = getSampleDosageHistory(patient, new Date(2026, 11, 16));
  assert.equal(afterFifteenth.last.date, '2026-12-15');
  assert.equal(afterFifteenth.next.date, '2027-01-15');
  assert.equal(afterFifteenth.upcoming[1].date, '2027-02-15');
});

test('new patients and imported lookalikes do not inherit sample history', () => {
  const snapshot = readPatientSnapshots();
  const seed = snapshot.records[0];
  const fields = Object.fromEntries(PATIENT_FIELDS.map((key) => [key, seed[key]]));
  const created = createPatient(snapshot, { ...fields, name: 'New Patient', phone: '1234567890' })[0];
  assert.equal(getSampleDosageHistory(created), null);
  // Even a CSV row that copies a sample ID and all visible identity fields
  // cannot masquerade as the original seed without its internal timestamp.
  const imported = { ...seed, createdAt: created.createdAt, updatedAt: created.updatedAt };
  assert.equal(samplePatientIndex(imported), -1);
  assert.equal(getSampleDosageHistory(imported), null);
});

test('saved populated and deliberately empty lists remain untouched', () => {
  const initial = readPatientSnapshots();
  const one = JSON.stringify([initial.records[0]]);
  window.localStorage.setItem(PATIENT_STORAGE_KEY, one);
  assert.equal(readPatientSnapshots().records.length, 1);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), one);
  window.localStorage.setItem(PATIENT_STORAGE_KEY, '[]');
  assert.deepEqual(readPatientSnapshots().records, []);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), '[]');
});

test('ordinary edits and status changes to samples survive reload', () => {
  const initial = readPatientSnapshots();
  const target = initial.records[0];
  const updated = updatePatient(initial, target.id, Object.fromEntries(PATIENT_FIELDS.map((key) =>
    [key, key === 'instructionsLanguage' ? 'Marathi' : target[key]])));
  const changed = setPatientStatus({ ...initial, records: updated }, target.id, 'inactive');
  assert.equal(readPatientSnapshots().records.find((item) => item.id === target.id).instructionsLanguage, 'Marathi');
  assert.equal(readPatientSnapshots().records.find((item) => item.id === target.id).status, 'inactive');
  assert.equal(changed.length, initial.records.length);
});

test('missing or inactive doctors and broken references do not add invalid patients', () => {
  const initial = readPatientSnapshots();
  for (const doctors of [[], initial.doctors.map((doctor) => ({ ...doctor, status: 'inactive' })),
    initial.doctors.map((doctor) => ({ ...doctor, mrId: 'missing-mr' }))]) {
    window.localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(doctors));
    window.localStorage.setItem(PATIENT_STORAGE_KEY, '[]');
    const snapshots = readPatientSnapshots();
    window.localStorage = storage();
    window.localStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify(snapshots.zones));
    window.localStorage.setItem(MR_STORAGE_KEY, JSON.stringify(snapshots.mrs));
    window.localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(doctors));
    assert.deepEqual(readPatientSnapshots().records, []);
    assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), null);
  }
  // No zone assignment for an otherwise active doctor.
  window.localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(initial.doctors));
  window.localStorage.setItem(MR_STORAGE_KEY, '[]');
  assert.deepEqual(readPatientSnapshots().records, []);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), null);
});

test('unavailable, unwritable and corrupt storage report errors without replacement', () => {
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadPatients(), /storage is unavailable/);
  window.localStorage = storage();
  window.localStorage.setItem(PATIENT_STORAGE_KEY, '{broken');
  assert.throws(() => readPatientSnapshots(), /invalid/);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), '{broken');
  window.localStorage = storage();
  const reference = readPatientSnapshots();
  window.localStorage = storage();
  window.localStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify(reference.zones));
  window.localStorage.setItem(MR_STORAGE_KEY, JSON.stringify(reference.mrs));
  window.localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(reference.doctors));
  const originalSet = window.localStorage.setItem;
  window.localStorage.setItem = (key, value) => {
    if (key === PATIENT_STORAGE_KEY) throw new Error('quota');
    originalSet(key, value);
  };
  assert.throws(() => readPatientSnapshots(), /could not be saved/);
  assert.equal(window.localStorage.getItem(PATIENT_STORAGE_KEY), null);
});

test('another patient write during preparation wins and is never replaced', () => {
  const initial = readPatientSnapshots();
  const saved = JSON.stringify([initial.records[0]]);
  window.localStorage.setItem(PATIENT_STORAGE_KEY, '[]');
  const originalGet = window.localStorage.getItem;
  let reads = 0;
  window.localStorage.getItem = (key) => {
    if (key === PATIENT_STORAGE_KEY && ++reads === 2) window.localStorage.setItem(PATIENT_STORAGE_KEY, saved);
    return reads === 1 && key === PATIENT_STORAGE_KEY ? null : originalGet(key);
  };
  assert.deepEqual(readPatientSnapshots().records, [initial.records[0]]);
  assert.equal(originalGet(PATIENT_STORAGE_KEY), saved);
});

test('doctor, MR and zone changes during preparation block the seed', () => {
  const initial = readPatientSnapshots();
  for (const key of [DOCTOR_STORAGE_KEY, MR_STORAGE_KEY, ZONE_STORAGE_KEY]) {
    const store = storage();
    window.localStorage = store;
    store.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(initial.doctors));
    store.setItem(MR_STORAGE_KEY, JSON.stringify(initial.mrs));
    store.setItem(ZONE_STORAGE_KEY, JSON.stringify(initial.zones));
    const originalGet = store.getItem;
    let patientReads = 0;
    store.getItem = (requested) => {
      if (requested === PATIENT_STORAGE_KEY && ++patientReads === 2) {
        store.setItem(key, JSON.stringify(key === DOCTOR_STORAGE_KEY
          ? initial.doctors.map((doctor) => ({ ...doctor, status: 'inactive' }))
          : key === MR_STORAGE_KEY
            ? initial.mrs.map((mr) => ({ ...mr, status: 'inactive' }))
            : initial.zones.map((zone) => ({ ...zone, status: 'inactive' }))));
      }
      return originalGet(requested);
    };
    assert.throws(() => readPatientSnapshots(), /changed while preparing sample patients/);
    assert.equal(originalGet(PATIENT_STORAGE_KEY), null);
  }
});