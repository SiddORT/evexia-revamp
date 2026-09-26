import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCTOR_STORAGE_KEY } from './doctors.js';
import { MR_STORAGE_KEY } from './mrs.js';
import {
  PATIENT_FIELDS, PATIENT_STORAGE_KEY, exportPatientCSV, loadPatients,
  readPatientSnapshots, reviewPatientCSV, setPatientStatus, updatePatient, validatePatient,
} from './patients.js';

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