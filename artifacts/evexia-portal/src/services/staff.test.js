import test from 'node:test';
import assert from 'node:assert/strict';
import { DESIGNATION_KEY, loadDesignations } from './designations.js';
import { subscribeLocalActivity } from './localActivity.js';
import { STAFF_KEY, createStaff, exportStaffCSV, generateStaffUserId, importStaff, loadStaff, reviewStaffCSV, setStaffStatus, staffCSVTemplate, staffInvitationPreview, updateStaff, validateStaff } from './staff.js';

function storage() {
  const map = new Map();
  return { getItem: (key) => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
const staff = (userId = 'jane.test', email = 'jane@example.test') => ({
  name: 'Jane Test', phone: '9876543210', userId, email, role: 'Staff', status: 'active',
  designation: '', dateOfJoining: '2025-01-15',
});
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  window.localStorage.setItem(DESIGNATION_KEY, '[]');
  window.localStorage.setItem(STAFF_KEY, '[]');
});

test('initializes fictional samples only once and preserves intentional empty or existing browser data', () => {
  window.localStorage.removeItem(STAFF_KEY);
  const first = loadStaff();
  assert.equal(first.length, 3);
  assert.ok(first.every((row) => row.id.startsWith('sample-staff-') && row.name.startsWith('Sample ')));
  assert.deepEqual(loadStaff(), first);
  window.localStorage.setItem(STAFF_KEY, '[]');
  assert.deepEqual(loadStaff(), []);
  const created = createStaff([], staff());
  assert.deepEqual(loadStaff(), created);
});

test('validates identity, contact, role, status, date, duplicates, designation and unknown credential keys', () => {
  for (const [key, value] of [['name', ''], ['phone', '1234'], ['userId', 'a'], ['email', 'bad'], ['role', 'Root'], ['status', 'pending'], ['dateOfJoining', '2025-02-30']]) {
    assert.ok(validateStaff({ ...staff(), [key]: value }).errors[key], key);
  }
  assert.ok(validateStaff({ ...staff(), password: 'secret' }).errors.form);
  const first = createStaff([], staff());
  assert.ok(validateStaff(staff('JANE.TEST', 'other@example.test'), first).errors.userId);
  assert.ok(validateStaff(staff('another', 'JANE@example.test'), first).errors.email);
  const designation = [{ name: 'Lead', status: 'active' }];
  assert.ok(validateStaff(staff(), [], null, designation).errors.designation);
  assert.ok(validateStaff({ ...staff(), designation: 'Unknown' }, [], null, designation).errors.designation);
  assert.equal(Object.keys(validateStaff({ ...staff(), designation: 'Lead' }, [], null, designation).errors).length, 0);
});

test('creation, edits, and status changes preserve creation audit and advance update audit', () => {
  const first = createStaff([], staff());
  const updated = updateStaff(first, first[0].id, { ...staff(), name: 'Jane Revised' });
  assert.equal(updated[0].createdAt, first[0].createdAt);
  assert.equal(updated[0].createdBy, first[0].createdBy);
  assert.ok(Date.parse(updated[0].updatedAt) > Date.parse(first[0].updatedAt));
  const inactive = setStaffStatus(updated, first[0].id, 'inactive');
  assert.equal(inactive[0].status, 'inactive');
  assert.ok(Date.parse(inactive[0].updatedAt) > Date.parse(updated[0].updatedAt));
  assert.deepEqual(loadStaff(), inactive);
});

test('CSV template and export round-trip safe profile fields without credentials or audit details', () => {
  const first = createStaff([], { ...staff(), name: '=Jane, "Test"\nName' });
  const csv = exportStaffCSV(first);
  assert.match(csv, /"'=Jane/);
  assert.ok(!csv.includes('createdAt') && !csv.includes('password') && !csv.includes(first[0].id));
  const entries = reviewStaffCSV(csv, []);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.name, '=Jane, "Test"\nName');
  window.localStorage.setItem(STAFF_KEY, '[]');
  const imported = importStaff(entries, []);
  assert.equal(imported[0].name, first[0].name);
  assert.equal(imported[0].createdBy, 'Admin User');
  assert.notEqual(imported[0].id, first[0].id);
  assert.match(staffCSVTemplate(), /Date of Joining/);
});

test('invitation preview identifies recipient without password or delivery claim; passwords never persist', () => {
  const preview = staffInvitationPreview({ ...staff(), password: 'secret-from-form' });
  assert.equal(preview.email, 'jane@example.test');
  assert.match(preview.copy, /Hello Jane Test/);
  assert.match(preview.copy, /preview only/);
  assert.equal(preview.confirmation, 'No email was sent. No account was activated.');
  assert.ok(!JSON.stringify(preview).includes('secret-from-form'));
  const created = createStaff([], staff());
  assert.ok(!window.localStorage.getItem(STAFF_KEY).includes('password'));
  assert.deepEqual(Object.keys(created[0]).sort(), [
    'createdAt', 'createdBy', 'dateOfJoining', 'designation', 'email', 'id', 'name',
    'phone', 'dialCountry', 'role', 'status', 'updatedAt', 'updatedBy', 'userId',
  ].sort());
});

test('first-visit export imports new staff into another first-visit browser and skips identical seeded samples', () => {
  window.localStorage.removeItem(STAFF_KEY);
  window.localStorage.removeItem(DESIGNATION_KEY);
  const origin = loadStaff();
  const designations = loadDesignations();
  assert.ok(designations.some((item) => item.status === 'active'));
  const withNewStaff = createStaff(origin, { ...staff('unique.staff', 'unique@example.test'), designation: designations[0].name }, designations);
  const csv = exportStaffCSV(withNewStaff);
  window.localStorage = storage();
  const destination = loadStaff();
  const destinationDesignations = loadDesignations();
  const entries = reviewStaffCSV(csv, destination, destinationDesignations);
  assert.ok(entries.every((entry) => !entry.errors.length));
  assert.equal(entries.filter((entry) => entry.skipSample).length, origin.length);
  const imported = importStaff(entries, destination, destinationDesignations);
  assert.equal(imported.length, destination.length + 1);
  assert.deepEqual(imported.slice(0, destination.length), destination);
  assert.equal(imported.at(-1).userId, 'unique.staff');
  assert.deepEqual(loadStaff(), imported);
  // Sample-only transfers succeed without writing over the recipient's samples.
  window.localStorage.setItem(STAFF_KEY, JSON.stringify(destination));
  const samplesOnly = reviewStaffCSV(exportStaffCSV(origin), destination, destinationDesignations);
  assert.deepEqual(importStaff(samplesOnly, destination, destinationDesignations), destination);
  assert.deepEqual(loadStaff(), destination);
});

test('sample exemption never hides edited destination samples, changed source rows, or repeated CSV identities', () => {
  window.localStorage.removeItem(STAFF_KEY);
  window.localStorage.removeItem(DESIGNATION_KEY);
  const origin = loadStaff();
  const designations = loadDesignations();
  const csv = exportStaffCSV(origin);
  const changed = updateStaff(origin, origin[0].id, { ...staff(origin[0].userId, origin[0].email), name: origin[0].name, phone: origin[0].phone, role: origin[0].role, designation: designations[0].name, dateOfJoining: origin[0].dateOfJoining }, designations);
  assert.ok(reviewStaffCSV(csv, changed, designations)[0].errors.length);
  assert.throws(() => importStaff(reviewStaffCSV(csv, origin, designations), changed, designations), /Duplicate|Designation/);
  const repeated = reviewStaffCSV(csv + csv.split('\r\n')[1] + '\r\n', origin, designations);
  assert.ok(repeated.at(-1).errors.some((error) => error.includes('User ID')));
  assert.deepEqual(loadStaff(), changed);
});

test('bad rows, duplicates, malformed CSV and credential headers reject the entire batch', () => {
  window.localStorage.setItem(STAFF_KEY, '[]');
  const csv = legacyHeader + [
    'Jane,9876543210,jane.test,jane@example.test,Staff,active,,2025-01-01',
    'Jane 2,9876543211,JANE.TEST,jane2@example.test,Staff,active,,2025-01-01',
    'Jane 3,123,bad,jane@example.test,Root,pending,,2025-02-30',
    'Short,row',
  ].join('\n');
  const entries = reviewStaffCSV(csv, []);
  assert.equal(entries[0].errors.length, 0);
  assert.ok(entries[1].errors.some((error) => error.includes('User ID')));
  assert.ok(entries[2].errors.length >= 4);
  assert.ok(entries[3].errors.length);
  assert.throws(() => importStaff(entries, []), /row errors/);
  assert.deepEqual(loadStaff(), []);
  assert.throws(() => reviewStaffCSV(staffCSVTemplate().replace('Name', 'Password') + 'a,b', []), /headers/);
  assert.throws(() => reviewStaffCSV(staffCSVTemplate() + '"unclosed', []), /Malformed CSV/);
});

const legacyHeader = 'Name,Phone No.,User ID,Email ID,Role,Status,Designation,Date of Joining\n';

test('all supported countries normalize, save, reopen and CSV round-trip local phone numbers', () => {
  for (const [country, phone] of [['IN', '+91 9876543210'], ['US', '(202) 555-0123'], ['GB', '7700 900123'], ['AE', '50 123 4567']]) {
    window.localStorage.setItem(STAFF_KEY, '[]');
    const first = createStaff([], { ...staff(), dialCountry: country, phone });
    const expectedPhone = phone.replace(/^\+91\s?/, '').replace(/\D/g, '');
    assert.equal(first[0].phone, expectedPhone);
    assert.equal(loadStaff()[0].dialCountry, country);
    const entries = reviewStaffCSV(exportStaffCSV(first), []);
    assert.deepEqual(entries[0].errors, []);
    assert.equal(entries[0].fields.phone, expectedPhone);
    assert.equal(entries[0].fields.dialCountry, country);
    window.localStorage.setItem(STAFF_KEY, '[]');
    assert.equal(importStaff(entries, [])[0].dialCountry, country);
    assert.ok(validateStaff({ ...staff(), dialCountry: country, phone: '123' }).errors.phone);
  }
  assert.ok(validateStaff({ ...staff(), dialCountry: 'XX' }).errors.dialCountry);
  assert.ok(validateStaff({ ...staff(), dialCountry: 'US', phone: '+91 9876543210' }).errors.phone);
  assert.ok(validateStaff({ ...staff(), dialCountry: '' }).errors.dialCountry);
});

test('legacy storage and exact old CSV headers default to India without rewriting audit or samples', () => {
  const first = createStaff([], staff());
  const { dialCountry, ...legacy } = first[0];
  legacy.phone = '+91-9876543210';
  const raw = JSON.stringify([legacy]);
  window.localStorage.setItem(STAFF_KEY, raw);
  const loaded = loadStaff();
  assert.equal(loaded[0].dialCountry, 'IN');
  assert.equal(loaded[0].phone, '9876543210');
  assert.equal(loaded[0].id, legacy.id);
  assert.equal(loaded[0].createdAt, legacy.createdAt);
  assert.equal(window.localStorage.getItem(STAFF_KEY), raw);
  const entries = reviewStaffCSV(legacyHeader + 'Jane Test,+91 9876543210,old.id,old@example.test,Staff,active,,2025-01-15', []);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.dialCountry, 'IN');
  assert.equal(entries[0].fields.phone, '9876543210');
  const edited = updateStaff(loaded, legacy.id, { ...staff(), name: 'Changed' });
  assert.equal(edited[0].createdAt, legacy.createdAt);
  window.localStorage.removeItem(STAFF_KEY);
  const samples = loadStaff();
  const oldCSV = legacyHeader + samples.map((row) => [row.name, row.phone, row.userId, row.email, row.role, row.status, row.designation, row.dateOfJoining].join(',')).join('\n');
  assert.ok(reviewStaffCSV(oldCSV, samples).every((entry) => entry.skipSample && !entry.errors.length));
  const legacySamples = samples.map(({ dialCountry, ...row }) => row);
  window.localStorage.setItem(STAFF_KEY, JSON.stringify(legacySamples));
  const legacyDestination = loadStaff();
  assert.ok(reviewStaffCSV(oldCSV, legacyDestination).every((entry) => entry.skipSample && !entry.errors.length));
  assert.ok(reviewStaffCSV(exportStaffCSV(samples), legacyDestination).every((entry) => entry.skipSample && !entry.errors.length));
  for (const invalid of [{ ...legacy, dialCountry: null }, { ...legacy, dialCountry: 'XX' }, { ...legacy, invitation: true }]) {
    window.localStorage.setItem(STAFF_KEY, JSON.stringify([invalid]));
    assert.throws(() => loadStaff(), /invalid/);
  }
});

test('generated IDs check collisions; edits cannot change identity and duplicate creates do not overwrite', () => {
  const first = createStaff([], staff('staff-existing'));
  const candidates = ['STAFF-EXISTING', 'staff-new'];
  assert.equal(generateStaffUserId(first, () => candidates.shift()), 'staff-new');
  assert.match(generateStaffUserId(first), /^staff-[a-f0-9-]+$/);
  assert.throws(() => generateStaffUserId(first, () => 'staff-existing'), /unique User ID/);
  assert.throws(() => updateStaff(first, first[0].id, staff('changed.id')), /cannot be changed/);
  assert.throws(() => createStaff(first, staff('STAFF-EXISTING', 'different@example.test')), /User ID already exists/);
  assert.deepEqual(loadStaff(), first);
});

test('write failures and transient invitation fields never reach stored or exported records', () => {
  const events = [];
  const unsubscribe = subscribeLocalActivity((event) => events.push(event));
  const first = createStaff([], staff());
  const raw = window.localStorage.getItem(STAFF_KEY);
  const originalSet = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => createStaff(first, staff('new.id', 'new@example.test')), /could not be saved/);
  assert.equal(window.localStorage.getItem(STAFF_KEY), raw);
  window.localStorage.setItem = originalSet;
  for (const key of ['sendInvitation', 'invitationStatus', 'password']) {
    assert.ok(validateStaff({ ...staff(), [key]: 'transient' }).errors.form);
    assert.ok(!exportStaffCSV(first).includes(key));
    assert.ok(!raw.includes(key));
  }
  unsubscribe();
  assert.ok(events.length);
  assert.ok(events.every((event) => Object.keys(event).sort().join(',') === 'action,resource'));
});

test('corrupt storage, stale snapshots and failed writes do not overwrite records', () => {
  window.localStorage.setItem(STAFF_KEY, '{broken');
  assert.throws(() => loadStaff(), /invalid/);
  assert.throws(() => createStaff([], staff()), /invalid/);
  assert.equal(window.localStorage.getItem(STAFF_KEY), '{broken');
  window.localStorage.setItem(STAFF_KEY, '[]');
  const first = createStaff([], staff());
  createStaff(first, staff('other.test', 'other@example.test'));
  assert.throws(() => updateStaff(first, first[0].id, staff()), /changed in another tab/);
  assert.throws(() => importStaff(reviewStaffCSV(exportStaffCSV(first), []), []), /changed in another tab/);
  const corrupt = { ...first[0], password: 'should-never-exist' };
  window.localStorage.setItem(STAFF_KEY, JSON.stringify([corrupt]));
  assert.throws(() => loadStaff(), /invalid/);
  assert.equal(JSON.parse(window.localStorage.getItem(STAFF_KEY))[0].password, 'should-never-exist');
  window.localStorage = { getItem() { throw Error('blocked'); } };
  assert.throws(() => loadStaff(), /unavailable/);
});