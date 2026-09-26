import { useEffect, useState } from 'react';
import { createMR, loadMRs, MR_STORAGE_KEY, setMRStatus, setMRContactRequirement, updateMR } from '../services/mrs.js';
import { DOCTOR_STORAGE_KEY } from '../services/doctors.js';
import { commitImport } from '../services/masterImport.js';
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
      if (event.key === MR_STORAGE_KEY || event.key === 'evexia.admin.zones.v1' || event.key === DOCTOR_STORAGE_KEY || event.key === null) {
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
    changeContactRequirement: (id, requirement) => apply((records, zones) => setMRContactRequirement(records, zones, id, requirement), `MR phone and email are now ${requirement}.`),
    importRows: (entries, snapshots) => {
      if (state.error) return { success: false, error: 'Refresh records before importing.' };
      if (JSON.stringify(state.records) !== JSON.stringify(snapshots.mrs) || JSON.stringify(state.zones) !== JSON.stringify(snapshots.zones)) {
        return { success: false, error: 'Records changed since review. Refresh and review the file again.' };
      }
      return apply(() => commitImport('mr', entries, snapshots), `${entries.length} MR${entries.length === 1 ? '' : 's'} imported successfully.`);
    },
  };
}