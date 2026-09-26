import { useEffect, useState } from 'react';
import { DESIGNATION_KEY, createDesignation, importDesignations, loadDesignations, setDesignationStatus, updateDesignation } from '../services/designations.js';

function readState() {
  try { return { records: loadDesignations(), error: '' }; }
  catch (cause) { return { records: [], error: cause.message || 'Designations could not be loaded.' }; }
}
export default function useDesignations() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === DESIGNATION_KEY || event.key === null) {
        setState((previous) => ({ ...previous, error: 'Designations changed in another tab. Refresh records before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  function retry() { setState(readState()); setFeedback(''); }
  function apply(operation, message) {
    if (state.error) return { success: false, error: 'Refresh records before making changes.' };
    try {
      setState({ records: operation(), error: '' });
      setFeedback(message);
      return { success: true };
    } catch (cause) { return { success: false, error: cause.message || 'Designations could not be saved.' }; }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => createDesignation(state.records, values), 'Designation added successfully.'),
    edit: (id, values) => apply(() => updateDesignation(state.records, id, values), 'Designation updated successfully.'),
    changeStatus: (id, status) => apply(() => setDesignationStatus(state.records, id, status), `Designation ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    importRows: (entries, snapshot) => {
      if (JSON.stringify(state.records) !== JSON.stringify(snapshot)) return { success: false, error: 'Records changed since review. Refresh and review the CSV again.' };
      return apply(() => importDesignations(entries, snapshot), `${entries.length} ${entries.length === 1 ? 'designation' : 'designations'} imported successfully.`);
    },
  };
}