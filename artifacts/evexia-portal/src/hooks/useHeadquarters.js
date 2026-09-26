import { useEffect, useState } from 'react';
import {
  HEADQUARTER_KEY, createHeadquarter, importHeadquarters, loadHeadquarters,
  setHeadquarterStatus, updateHeadquarter,
} from '../services/headquarters.js';

function readState() {
  try { return { records: loadHeadquarters(), error: '' }; }
  catch (cause) { return { records: [], error: cause.message || 'Headquarters could not be loaded.' }; }
}

export default function useHeadquarters() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === HEADQUARTER_KEY || event.key === null) {
        setState((previous) => ({ ...previous, error: 'Headquarters changed in another tab. Refresh records before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function retry() { setState(readState()); setFeedback(''); }
  function apply(operation, message) {
    if (state.error) return { success: false, error: 'Refresh records before making changes.' };
    try {
      const records = operation();
      setState({ records, error: '' });
      setFeedback(message);
      return { success: true };
    } catch (cause) {
      return { success: false, error: cause.message || 'Headquarters could not be saved.' };
    }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => createHeadquarter(state.records, values), 'Headquarter added successfully.'),
    edit: (id, values) => apply(() => updateHeadquarter(state.records, id, values), 'Headquarter updated successfully.'),
    changeStatus: (id, status) => apply(() => setHeadquarterStatus(state.records, id, status), `Headquarter ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    importRows: (entries, snapshot) => {
      if (JSON.stringify(state.records) !== JSON.stringify(snapshot)) return { success: false, error: 'Records changed since review. Refresh and review the CSV again.' };
      return apply(() => importHeadquarters(entries, snapshot), `${entries.length} ${entries.length === 1 ? 'headquarter' : 'headquarters'} imported successfully.`);
    },
  };
}