import { recordLocalChanges, recordLocalAction, reportExport } from './localActivity.js';
import { loadMRs } from './mrs.js';
import { loadZones } from './zones.js';
import { DIAL_COUNTRIES, dialCountry } from './phoneCountries.js';

const STORAGE_KEY = 'evexia.admin.doctors.v1';
export const DOCTOR_STORAGE_KEY = STORAGE_KEY;

const REQUIRED = [
  'name', 'dialCountry', 'registrationNumber',
  'qualification', 'mrId', 'invoiceType', 'orderDiscount',
  'daysLimit', 'paymentLimit', 'status', 'addressLine1', 'landmark', 'pincode',
  'country', 'state', 'city',
];
const OPTIONAL = ['phone', 'alternatePhone', 'email', 'dateOfJoining', 'clinicName', 'gstNumber', 'drugLicenceNumber', 'addressLine2'];
const STRING_FIELDS = [...REQUIRED.filter((key) => !['orderDiscount', 'daysLimit', 'paymentLimit'].includes(key)), ...OPTIONAL];
const NUMBER_FIELDS = ['orderDiscount', 'daysLimit', 'paymentLimit'];
const FIELDS = [...REQUIRED, ...OPTIONAL, 'contactRequirement'];
const LEGACY_STORED = [...REQUIRED, ...OPTIONAL, 'verification', 'id', 'createdAt', 'updatedAt'];
const STORED = [...LEGACY_STORED, 'createdBy', 'updatedBy', 'contactRequirement'];
const ADMIN_NAME = 'Admin User';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const normalized = (value) => value.trim().toLocaleLowerCase();
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function fail(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function validateDoctor(values, records = [], exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Doctor data contains unsupported fields. Nothing was saved.' } };
  }
  const errors = {};
  const fields = {};
  for (const key of STRING_FIELDS) {
    fields[key] = typeof values[key] === 'string' ? values[key].trim() : '';
    if (REQUIRED.includes(key) && !fields[key]) errors[key] = `${key === 'name' ? 'Doctor name' : key} is required.`;
  }
  fields.contactRequirement = values.contactRequirement;
  if (!['required', 'optional'].includes(fields.contactRequirement)) errors.contactRequirement = 'Choose whether phone and email are required or optional.';
  if (fields.contactRequirement === 'required') {
    for (const key of ['phone', 'email']) if (!fields[key]) errors[key] = `${key === 'phone' ? 'Phone' : 'Email'} is required.`;
  }
  for (const key of NUMBER_FIELDS) {
    const value = values[key] === '' || values[key] == null ? 0 : Number(values[key]);
    fields[key] = value;
    if (!Number.isFinite(value) || value < 0 || (key === 'daysLimit' && !Number.isSafeInteger(value))
      || (key !== 'daysLimit' && Number(value.toFixed(2)) !== value)) {
      errors[key] = `${key === 'daysLimit' ? 'Days limit' : key === 'paymentLimit' ? 'Payment limit' : 'Order discount'} must be ${key === 'daysLimit' ? 'a whole ' : 'a '}nonnegative number.`;
    }
  }
  const phoneDigits = Object.fromEntries(DIAL_COUNTRIES.map((item) => [item.value, item.digits]));
  if (!own(phoneDigits, fields.dialCountry)) errors.dialCountry = 'Choose a valid dialing country.';
  for (const key of ['phone', 'alternatePhone']) {
    if (fields[key] && (!/^[0-9 ()-]+$/.test(fields[key]) || fields[key].replace(/\D/g, '').length !== phoneDigits[fields.dialCountry])) {
      errors[key] = `Enter a valid ${phoneDigits[fields.dialCountry] || ''}-digit ${key === 'phone' ? 'phone' : 'alternate phone'} number.`;
    }
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (fields.dateOfJoining && (!validDate(fields.dateOfJoining) || fields.dateOfJoining > new Date().toISOString().slice(0, 10))) errors.dateOfJoining = 'Enter a valid joining date that is not in the future.';
  if (fields.pincode && (fields.country.toLocaleLowerCase() === 'india' ? !/^\d{6}$/.test(fields.pincode) : !/^[a-zA-Z0-9][a-zA-Z0-9 -]{1,11}$/.test(fields.pincode))) errors.pincode = 'Enter a valid postal code.';
  if (fields.invoiceType && !['normal', 'gst'].includes(fields.invoiceType)) errors.invoiceType = 'Choose a valid invoice type.';
  if (fields.invoiceType === 'gst' && !fields.gstNumber) errors.gstNumber = 'GST number is required for GST invoices.';
  if (fields.gstNumber && (fields.country.toLocaleLowerCase() === 'india' ? !/^[0-9A-Z]{15}$/i.test(fields.gstNumber) : !/^[A-Za-z0-9 -]{5,20}$/.test(fields.gstNumber))) errors.gstNumber = 'Enter a valid GST number.';
  if (fields.orderDiscount > 100) errors.orderDiscount = 'Order discount must not exceed 100%.';
  if (fields.status && !['active', 'inactive'].includes(fields.status)) errors.status = 'Choose a valid doctor status.';
  if (records.some((record) => record.id !== exceptId && record.registrationNumber && normalized(record.registrationNumber) === normalized(fields.registrationNumber))) {
    errors.registrationNumber = 'Registration number already belongs to another doctor.';
  }
  return { fields, errors };
}

function invalidSavedData() {
  fail('Saved doctor data is invalid. No records were changed. Repair or back up browser storage before retrying.', 'RECOVERY_REQUIRED');
}

function sampleDoctors(mrs) {
  const activeMRs = mrs.filter((mr) => mr.status === 'active');
  if (!activeMRs.length) return [];
  const examples = [
    { name: 'Sample Dr. Ananya Shah', clinicName: 'Northside Family Clinic', qualification: 'MBBS, MD', city: 'New Delhi', state: 'Delhi', pincode: '110001', verification: 'verified', status: 'active' },
    { name: 'Sample Dr. Rohan Iyer', clinicName: 'Harbour Health Centre', qualification: 'MBBS, DNB', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', verification: 'unverified', status: 'active' },
    { name: 'Sample Dr. Meera Sen', clinicName: 'Lakeview Medical Practice', qualification: 'MBBS', city: 'Kolkata', state: 'West Bengal', pincode: '700001', verification: 'verified', status: 'inactive' },
    { name: 'Sample Dr. Kabir Nair', clinicName: 'Garden City Clinic', qualification: 'MBBS, MS', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', verification: 'unverified', status: 'active' },
  ];
  return examples.map((example, index) => {
    const at = new Date(Date.UTC(2025, 2, index + 1, 9, 30)).toISOString();
    return {
      id: `sample-doctor-${index + 1}`,
      name: example.name,
      phone: `900000000${index + 1}`,
      dialCountry: 'IN',
      registrationNumber: `SAMPLE-REG-${String(index + 1).padStart(3, '0')}`,
      qualification: example.qualification,
      mrId: activeMRs[index % activeMRs.length].id,
      invoiceType: 'normal',
      orderDiscount: 0,
      daysLimit: 30,
      paymentLimit: 5000,
      status: example.status,
      addressLine1: `${index + 1} Sample Clinic Road`,
      landmark: 'City Centre',
      pincode: example.pincode,
      country: 'India',
      state: example.state,
      city: example.city,
      alternatePhone: '',
      email: `sample.doctor${index + 1}@example.com`,
      contactRequirement: 'optional',
      dateOfJoining: `2024-0${index + 3}-15`,
      clinicName: example.clinicName,
      gstNumber: '',
      drugLicenceNumber: '',
      addressLine2: '',
      verification: example.verification,
       createdBy: ADMIN_NAME,
      createdAt: at,
       updatedBy: ADMIN_NAME,
      updatedAt: at,
    };
  });
}

function read() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    fail('Doctor records could not be loaded because browser storage is unavailable.', 'RECOVERY_REQUIRED');
  }
  if (raw === null) {
    const mrs = loadMRs();
    const samples = sampleDoctors(mrs);
    if (!samples.length) return [];
    try {
      // Only seed a genuinely absent list; never replace saved records or an intentional [].
      if (window.localStorage.getItem(STORAGE_KEY) !== null) return read();
      if (JSON.stringify(loadMRs()) !== JSON.stringify(mrs)) {
        fail('MR records changed while preparing sample doctors. Refresh records before retrying.', 'SNAPSHOT_CONFLICT');
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
    } catch (error) {
      if (error.code) throw error;
      fail('Sample doctors could not be saved in this browser. Check browser storage settings and try again.', 'RECOVERY_REQUIRED');
    }
    return samples;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidSavedData();
  }
  if (!Array.isArray(parsed) || parsed.some((record) =>
    !record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).some((key) => !STORED.includes(key))
    || !LEGACY_STORED.every((key) => own(record, key))
    || own(record, 'createdBy') !== own(record, 'updatedBy')
    || (own(record, 'createdBy') && ![record.createdBy, record.updatedBy].every((name) => typeof name === 'string' && name.trim()))
    || typeof record.id !== 'string' || !record.id
    || !['verified', 'unverified'].includes(record.verification)
    || ![record.createdAt, record.updatedAt].every((date) => typeof date === 'string' && !Number.isNaN(Date.parse(date)))
    || NUMBER_FIELDS.some((key) => typeof record[key] !== 'number')
    || STRING_FIELDS.some((key) => typeof record[key] !== 'string')
    || Object.keys(validateDoctor(Object.fromEntries(FIELDS.map((key) => [key, key === 'contactRequirement' && !own(record, key) ? 'optional' : record[key]])), parsed, record.id).errors).length
  ) || new Set(parsed.map((record) => record.id)).size !== parsed.length
    || new Set(parsed.map((record) => normalized(record.registrationNumber))).size !== parsed.length) {
    invalidSavedData();
  }
  // Normalize legacy fields in memory; only a guarded edit persists them.
  return parsed.map((record) => ({
    ...record,
    ...(!own(record, 'createdBy') ? { createdBy: ADMIN_NAME, updatedBy: ADMIN_NAME } : {}),
    ...(!own(record, 'contactRequirement') ? { contactRequirement: 'optional' } : {}),
  }));
}

export function loadDoctors() {
  return read();
}

function currentZones(expectedMRs) {
  try {
    const zones = loadZones();
    const expectedZones = expectedMRs?.zonesSnapshot;
    if (expectedZones && JSON.stringify(zones) !== JSON.stringify(expectedZones)) {
      fail('Zones changed in another tab. Refresh records to review the latest zones before saving.', 'SNAPSHOT_CONFLICT');
    }
    return zones;
  } catch (error) {
    if (error.code) throw error;
    fail(error.message || 'Zones could not be loaded. Refresh records before saving.', 'RECOVERY_REQUIRED');
  }
}

function save(next, expectedRecords, expectedMRs) {
  if (JSON.stringify(read()) !== JSON.stringify(expectedRecords)) {
    fail('Doctor records changed in another tab. Refresh records to review the latest data before saving.', 'SNAPSHOT_CONFLICT');
  }
  let latestMRs;
  try {
    latestMRs = loadMRs();
  } catch (error) {
    fail(error.message || 'MR records could not be loaded. Refresh records before saving.', error.code || 'RECOVERY_REQUIRED');
  }
  if (JSON.stringify(latestMRs) !== JSON.stringify(expectedMRs)) {
    fail('MR records changed in another tab. Refresh records to review the latest data before saving.', 'SNAPSHOT_CONFLICT');
  }
  currentZones(expectedMRs);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    fail('Doctor records could not be saved in this browser. Check browser storage settings and try again.', 'RECOVERY_REQUIRED');
  }
  recordLocalChanges('doctor', expectedRecords, next);
  return next;
}

function checkedFields(records, mrs, values, id) {
  const { fields, errors } = validateDoctor(values, records, id);
  if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  const previous = records.find((record) => record.id === id);
  const selectedMR = mrs.find((mr) => mr.id === fields.mrId);
  if (!selectedMR) fail('The assigned MR is missing. Choose an active saved MR before saving.');
  if (fields.mrId !== previous?.mrId && (!selectedMR || selectedMR.status !== 'active')) {
    fail('Choose an active saved MR.');
  }
  return fields;
}

export function createDoctor(records, mrs, values) {
  const fields = checkedFields(records, mrs, values);
  const now = new Date().toISOString();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
   return save([{ ...fields, verification: 'unverified', id, createdBy: ADMIN_NAME, createdAt: now, updatedBy: ADMIN_NAME, updatedAt: now }, ...records], records, mrs);
}

export function updateDoctor(records, mrs, id, values) {
  if (!records.some((record) => record.id === id)) fail('This doctor is no longer available.');
  const fields = checkedFields(records, mrs, values, id);
   return save(records.map((record) => record.id === id ? { ...record, ...fields, updatedBy: ADMIN_NAME, updatedAt: new Date().toISOString() } : record), records, mrs);
}

export function setDoctorStatus(records, mrs, id, status) {
  if (!['active', 'inactive'].includes(status)) fail('Choose a valid doctor status.');
  if (!records.some((record) => record.id === id)) fail('This doctor is no longer available.');
   return save(records.map((record) => record.id === id ? { ...record, status, updatedBy: ADMIN_NAME, updatedAt: new Date().toISOString() } : record), records, mrs);
}

export function setDoctorContactRequirement(records, mrs, id, contactRequirement) {
  if (!['required', 'optional'].includes(contactRequirement)) fail('Choose a valid contact requirement.');
  const record = records.find((item) => item.id === id);
  if (!record) fail('This doctor is no longer available.');
  if (contactRequirement === 'required' && (!record.phone || !record.email)) {
    fail('Edit this doctor to add a phone number and email address before making both required.');
  }
  return save(records.map((item) => item.id === id
    ? { ...item, contactRequirement, updatedBy: ADMIN_NAME, updatedAt: new Date().toISOString() } : item), records, mrs);
}
export function setDoctorVerification(records, mrs, ids, verification) {
  if (!['verified', 'unverified'].includes(verification)) fail('Choose a valid verification status.');
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || ids.some((id) => !records.some((record) => record.id === id))) {
    fail('One or more selected doctors are no longer available.');
  }
  const selected = new Set(ids);
   return save(records.map((record) => selected.has(record.id) ? { ...record, verification, updatedBy: ADMIN_NAME, updatedAt: new Date().toISOString() } : record), records, mrs);
}

export function shiftDoctorsMR(records, mrs, ids, mrId) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || ids.some((id) => !records.some((record) => record.id === id))) {
    fail('One or more selected doctors are no longer available.');
  }
  const mr = mrs.find((item) => item.id === mrId);
  if (!mr || mr.status !== 'active') fail('Choose an active saved MR.');
  const selected = new Set(ids);
   return save(records.map((record) => selected.has(record.id) ? { ...record, mrId, updatedBy: ADMIN_NAME, updatedAt: new Date().toISOString() } : record), records, mrs);
}

export const DOCTOR_CSV_COLUMNS = [
   ['name', 'Doctor Name'], ['phone', 'Phone'], ['dialCode', 'Dial Code'], ['dialCountry', 'Dial Country'], ['alternatePhone', 'Alternate Phone'],
  ['email', 'Email'], ['contactRequirement', 'Contact Requirement'], ['dateOfJoining', 'Date of Joining'], ['registrationNumber', 'Registration Number'],
  ['qualification', 'Qualification'], ['clinicName', 'Clinic Name'], ['mrName', 'Assigned MR'], ['zoneName', 'Zone'],
  ['invoiceType', 'Invoice Type'], ['gstNumber', 'GST Number'], ['drugLicenceNumber', 'Drug Licence Number'],
  ['orderDiscount', 'Order Discount'], ['daysLimit', 'Days Limit'], ['paymentLimit', 'Payment Limit'],
  ['status', 'Status'], ['verification', 'Verification'], ['addressLine1', 'Address Line 1'],
  ['addressLine2', 'Address Line 2'], ['landmark', 'Landmark'], ['pincode', 'Pincode'],
  ['country', 'Country'], ['state', 'State'], ['city', 'City'],
];

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\p{Cc}]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportDoctorCSV(...args) { return reportExport('doctor', () => buildDoctorCSV(...args)); }
function buildDoctorCSV(visible, mrs, zones) {
  const header = DOCTOR_CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const rows = visible.map((doctor) => DOCTOR_CSV_COLUMNS.map(([key]) => {
    let value = doctor[key];
    if (key === 'dialCode') value = dialCountry(doctor.dialCountry)?.code;
    if (key === 'mrName') value = mrs.find((mr) => mr.id === doctor.mrId)?.name || (doctor.mrId ? 'Missing MR' : '');
    if (key === 'zoneName') {
      const mr = mrs.find((item) => item.id === doctor.mrId);
      value = mr ? zones.find((zone) => zone.id === mr.zoneId)?.name || 'Missing zone' : doctor.mrId ? 'Missing MR' : '';
    }
    return csvCell(value);
  }).join(','));
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}
