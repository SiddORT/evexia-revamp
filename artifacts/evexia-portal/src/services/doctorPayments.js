import { loadDoctors } from './doctors.js';
import { loadMRs } from './mrs.js';

export const DOCTOR_PAYMENT_STORAGE_KEY = 'evexia.admin.doctor-demo-payments.v1';

export function validPaymentDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const sampleEntries = [
  ['sample-doctor-1', '2025-03-05', 750000, 750000, 'DEMO-DS1-001'],
  ['sample-doctor-1', '2025-04-15', 1200000, 500000, 'DEMO-DS1-002'],
  ['sample-doctor-1', '2025-04-30', 450000, 0, 'DEMO-DS1-003'],
  ['sample-doctor-2', '2025-03-22', 820000, 820000, 'DEMO-DS2-001'],
  ['sample-doctor-2', '2025-05-01', 300000, 150000, 'DEMO-DS2-002'],
  ['sample-doctor-3', '2025-06-10', 600000, 0, 'DEMO-DS3-001'],
  ['sample-doctor-4', '2025-07-07', 965000, 965000, 'DEMO-DS4-001'],
];

function seedPayments() {
  const doctors = loadDoctors();
  const mrs = loadMRs();
  return sampleEntries.flatMap(([doctorId, date, billedPaise, receivedPaise, reference]) => {
    const doctor = doctors.find((item) => item.id === doctorId && item.registrationNumber === `SAMPLE-REG-${doctorId.slice(-1).padStart(3, '0')}`);
    if (!doctor) return [];
    const mr = mrs.find((item) => item.id === doctor.mrId);
    return [{
      id: reference, doctorId, date, billedPaise, receivedPaise, reference,
      status: receivedPaise === billedPaise ? 'Received' : receivedPaise ? 'Partially received' : 'Outstanding',
      mrId: doctor.mrId,
      mrName: mr?.name || 'MR unavailable at sample creation',
    }];
  });
}

function validatePayments(parsed) {
  const fields = ['id', 'doctorId', 'date', 'billedPaise', 'receivedPaise', 'reference', 'status', 'mrId', 'mrName'];
  if (!Array.isArray(parsed) || parsed.some((item) =>
    !item || typeof item !== 'object' || Array.isArray(item)
    || Object.keys(item).length !== fields.length
    || fields.some((field) => !Object.prototype.hasOwnProperty.call(item, field))
    || ['id', 'doctorId', 'reference', 'mrId', 'mrName'].some((field) => typeof item[field] !== 'string' || !item[field].trim())
    || !validPaymentDate(item.date)
    || ![item.billedPaise, item.receivedPaise].every((amount) => Number.isSafeInteger(amount) && amount >= 0)
    || item.receivedPaise > item.billedPaise
    || item.status !== (item.receivedPaise === item.billedPaise ? 'Received' : item.receivedPaise ? 'Partially received' : 'Outstanding')
  ) || new Set(parsed.map((item) => item.id)).size !== parsed.length
    || new Set(parsed.map((item) => item.reference)).size !== parsed.length) {
    throw new Error('Saved demo payment data is invalid. No payment records were changed. Repair or back up browser storage before retrying.');
  }
  return parsed;
}

export function loadDemoPayments() {
  let raw;
  try { raw = window.localStorage.getItem(DOCTOR_PAYMENT_STORAGE_KEY); }
  catch { throw new Error('Demo payments could not be loaded because browser storage is unavailable.'); }
  if (raw !== null) {
    try { return validatePayments(JSON.parse(raw)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('Saved demo payment data is unreadable. No payment records were changed. Repair or back up browser storage before retrying.');
      throw error;
    }
  }
  const samples = seedPayments();
  try {
    // An intentionally empty [] or a concurrent write must not be replaced by samples.
    if (window.localStorage.getItem(DOCTOR_PAYMENT_STORAGE_KEY) !== null) return loadDemoPayments();
    if (samples.length) window.localStorage.setItem(DOCTOR_PAYMENT_STORAGE_KEY, JSON.stringify(samples));
  } catch {
    throw new Error('Demo payments could not be saved in this browser. Check browser storage settings and refresh.');
  }
  return samples;
}

export function filterDemoPayments(records, doctorId, from = '', to = '') {
  if ((from && !validPaymentDate(from)) || (to && !validPaymentDate(to))) throw new Error('Enter valid from and to dates.');
  if (from && to && from > to) throw new Error('From date must be on or before to date.');
  return records.filter((item) => item.doctorId === doctorId && (!from || item.date >= from) && (!to || item.date <= to))
    .sort((a, b) => b.date.localeCompare(a.date) || a.reference.localeCompare(b.reference));
}

export function demoPaymentTotals(records) {
  return records.reduce((totals, item) => {
    totals.billed += item.billedPaise;
    totals.received += item.receivedPaise;
    totals.outstanding += item.billedPaise - item.receivedPaise;
    if (![totals.billed, totals.received, totals.outstanding].every(Number.isSafeInteger)) throw new Error('Demo totals exceed the supported range.');
    return totals;
  }, { billed: 0, received: 0, outstanding: 0 });
}