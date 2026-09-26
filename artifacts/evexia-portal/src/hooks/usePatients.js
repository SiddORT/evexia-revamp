import { useEffect, useState } from 'react';
import { DOCTOR_STORAGE_KEY } from '../services/doctors.js';
import { MR_STORAGE_KEY } from '../services/mrs.js';
import { PATIENT_STORAGE_KEY, createPatient, importPatients, readPatientSnapshots, setPatientStatus, updatePatient } from '../services/patients.js';

const EMPTY = { records: [], doctors: [], mrs: [], zones: [], error: '' };
function readState(previous = EMPTY) {
  try { return { ...readPatientSnapshots(), error: '' }; }
  catch (cause) { return { ...previous, error: cause.message || 'Saved records could not be loaded.' }; }
}
export default function usePatients() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if ([PATIENT_STORAGE_KEY, DOCTOR_STORAGE_KEY, MR_STORAGE_KEY, 'evexia.admin.zones.v1', null].includes(event.key)) {
        setState((previous) => ({ ...previous, error: 'Patient, doctor, MR, or zone records changed in another tab. Refresh records before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  function retry() {
    const next = readState(state);
    setState(next);
    if (!next.error) setFeedback('');
    return { success: !next.error, error: next.error };
  }
  function apply(operation, message) {
    if (state.error) return { success: false, error: `${state.error} Refresh records before continuing.` };
    try {
      const records = operation(state);
      setState({ ...state, records });
      setFeedback(message);
      return { success: true };
    } catch (cause) {
      const messageText = cause.message || 'Patient records could not be saved.';
      if (['RECOVERY_REQUIRED', 'SNAPSHOT_CONFLICT'].includes(cause.code)) setState((previous) => ({ ...previous, error: messageText }));
      return { success: false, error: messageText };
    }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply((snapshot) => createPatient(snapshot, values), 'Patient added successfully.'),
    edit: (id, values) => apply((snapshot) => updatePatient(snapshot, id, values), 'Patient updated successfully.'),
    changeStatus: (id, status) => apply((snapshot) => setPatientStatus(snapshot, id, status), `Patient ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    importRows: (entries, snapshot) => {
      if (state.error || ['records', 'doctors', 'mrs', 'zones'].some((key) => JSON.stringify(state[key]) !== JSON.stringify(snapshot[key]))) {
        return { success: false, error: 'Records changed since review. Refresh and review the CSV again.' };
      }
      return apply(() => importPatients(entries, snapshot), `${entries.length} patient${entries.length === 1 ? '' : 's'} imported successfully.`);
    },
  };
}