import { patientRequest } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';
import { allDoctorMRChoices } from './serverDoctors.js';

const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all'));
export const listPatients = (params, signal) => patientRequest('', { params: clean(params), signal });
export const getPatient = (id, signal) => patientRequest(`/${id}`, { signal });
export const patientDoctorChoices = (params, signal) => patientRequest('/references', { params: clean(params), signal });
export const patientMRChoices = allDoctorMRChoices;
export const createPatient = (body) => patientRequest('', { body });
export const editPatient = (record, body) => patientRequest(`/${record.id}/edit`, { body: { ...body, expected_version: record.version } });
export const statusPatient = (record, status) => patientRequest(`/${record.id}/status`, { body: { status, expected_version: record.version } });
export const samplePatients = (format, signal) => patientRequest('/sample', { params: { format }, download: true, signal });
export const exportPatients = (params, format, signal) => patientRequest('/export', { params: { ...clean(params), format }, download: true, signal });
export const reviewPatients = (file, signal) => patientRequest('/import/review', { file, params: { filename: file.name }, signal });
export const importPatients = (file, digest) => patientRequest('/import/commit', { file, params: { filename: file.name, digest, confirm: true } });
export const downloadPatientFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-patient-${sample ? 'sample' : 'master'}.${format}`);
export function businessToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (key) => parts.find((part) => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function patientAge(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const [y, m, d] = businessToday().split('-').map(Number);
  return y - year - (m < month || (m === month && d < day) ? 1 : 0);
}
