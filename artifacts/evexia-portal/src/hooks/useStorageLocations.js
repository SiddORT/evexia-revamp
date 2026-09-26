import { useEffect, useState } from 'react';
import {
  STORAGE_LOCATION_KEY, createStorageLocation, importStorageLocations, loadStorageLocations,
  setStorageLocationStatus, updateStorageLocation,
} from '../services/storageLocations.js';

function readState() {
  try { return { records: loadStorageLocations(), error: '' }; }
  catch (cause) { return { records: [], error: cause.message || 'Storage locations could not be loaded.' }; }
}

export default function useStorageLocations() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_LOCATION_KEY || event.key === null) {
        setState((previous) => ({ ...previous, error: 'Storage locations changed in another tab. Refresh records before saving.' }));
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
      return { success: false, error: cause.message || 'Storage locations could not be saved.' };
    }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => createStorageLocation(state.records, values), 'Storage location added successfully.'),
    edit: (id, values) => apply(() => updateStorageLocation(state.records, id, values), 'Storage location updated successfully.'),
    changeStatus: (id, status) => apply(() => setStorageLocationStatus(state.records, id, status), `Storage location ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    importRows: (entries, snapshot) => {
      if (JSON.stringify(state.records) !== JSON.stringify(snapshot)) return { success: false, error: 'Records changed since review. Refresh and review the CSV again.' };
      return apply(() => importStorageLocations(entries, snapshot), `${entries.length} storage ${entries.length === 1 ? 'location' : 'locations'} imported successfully.`);
    },
  };
}