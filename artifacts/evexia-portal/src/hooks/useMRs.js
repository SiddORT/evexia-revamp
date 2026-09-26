import { useEffect, useState } from 'react';
import { createMR, loadMRs, MR_STORAGE_KEY, setMRStatus, updateMR } from '../services/mrs.js';
import { loadZones } from '../services/zones.js';

function readState() {
  try {
    // Both collections must be readable before exposing MR mutations.
    const zones = loadZones();
    return { records: loadMRs(), zones, error: '' };
  } catch (error) {
    return { records: [], zones: [], error: error.message || 'Saved data could not be loaded.' };
  }
}

export default function useMRs() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === MR_STORAGE_KEY || event.key === 'evexia.admin.zones.v1' || event.key === null) {
        setState((previous) => ({ ...previous, error: 'MR records or zones changed in another tab. Refresh records to review them before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function retry() {
    const next = readState();
    setState(next);
    if (!next.error) setFeedback('');
  }
  function apply(operation, message) {
    if (state.error) return { success: false, error: 'Changes are blocked until saved records and zones can be loaded. Refresh records first.' };
    try {
      const records = operation(state.records, state.zones);
      setState({ ...state, records });
      setFeedback(message);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Changes could not be saved.' };
    }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply((records, zones) => createMR(records, zones, values), 'MR added successfully.'),
    edit: (id, values) => apply((records, zones) => updateMR(records, zones, id, values), 'MR updated successfully.'),
    changeStatus: (id, status) => apply((records, zones) => setMRStatus(records, zones, id, status), `MR ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
  };
}