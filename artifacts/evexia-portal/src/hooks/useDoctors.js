import { useEffect, useState } from 'react';
import {
  createDoctor, DOCTOR_STORAGE_KEY, loadDoctors, setDoctorStatus, setDoctorVerification,
  shiftDoctorsMR, updateDoctor,
} from '../services/doctors.js';
import { loadMRs, MR_STORAGE_KEY } from '../services/mrs.js';
import { loadZones } from '../services/zones.js';

const ZONE_STORAGE_KEY = 'evexia.admin.zones.v1';

function readState(previous = { records: [], mrs: [], zones: [], error: '' }) {
  try {
    const zones = loadZones();
    const mrs = loadMRs();
    // Carry the zone snapshot through the existing service contract without
    // changing the array's serialized MR snapshot.
    Object.defineProperty(mrs, 'zonesSnapshot', { value: zones, configurable: true });
    const records = loadDoctors();
    return { records, mrs, zones, error: '' };
  } catch (error) {
    return {
      ...previous,
      error: error.message || 'Saved doctor, MR, or zone data could not be loaded.',
    };
  }
}

export default function useDoctors() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const onStorage = (event) => {
      if ([DOCTOR_STORAGE_KEY, MR_STORAGE_KEY, ZONE_STORAGE_KEY, null].includes(event.key)) {
        setState((previous) => ({
          ...previous,
          error: 'Doctor records, MRs, or zones changed in another tab. Refresh records to review the latest data before saving.',
        }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function retry() {
    const next = readState(state);
    setState(next);
    if (!next.error) setFeedback('');
    return next.error ? { success: false, error: next.error } : { success: true };
  }

  function apply(operation, message) {
    if (state.error) {
      return { success: false, error: 'Changes are blocked until saved doctor, MR, and zone records can be loaded. Refresh records first.' };
    }
    try {
      const records = operation(state.records, state.mrs);
      setState({ ...state, records });
      setFeedback(message);
      return { success: true };
    } catch (error) {
      const messageText = error.message || 'Changes could not be saved.';
      if (['SNAPSHOT_CONFLICT', 'RECOVERY_REQUIRED'].includes(error.code)) {
        setState((previous) => ({ ...previous, error: messageText }));
      }
      return { success: false, error: messageText };
    }
  }

  return {
    ...state,
    feedback,
    retry,
    clearFeedback: () => setFeedback(''),
    add: (values) => apply((records, mrs) => createDoctor(records, mrs, values), 'Doctor added successfully.'),
    edit: (id, values) => apply((records, mrs) => updateDoctor(records, mrs, id, values), 'Doctor updated successfully.'),
    changeStatus: (id, status) => apply((records, mrs) => setDoctorStatus(records, mrs, id, status), `Doctor ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    changeVerification: (ids, verification) => apply(
      (records, mrs) => setDoctorVerification(records, mrs, ids, verification),
      'Doctor verification updated successfully.',
    ),
    shiftMR: (ids, mrId) => apply((records, mrs) => shiftDoctorsMR(records, mrs, ids, mrId), 'Doctor assignment updated successfully.'),
  };
}