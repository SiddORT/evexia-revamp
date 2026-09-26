import { useState } from 'react';
import { createZone, deleteZone, loadZones, setZoneStatus, updateZone } from '../services/zones.js';

export default function useZones() {
  const [state, setState] = useState(() => {
    try { return { zones: loadZones(), error: '' }; }
    catch (error) { return { zones: [], error: error.message || 'Zones could not be loaded.' }; }
  });
  const [feedback, setFeedback] = useState('');

  function retry() {
    try {
      setState({ zones: loadZones(), error: '' });
      setFeedback('');
    } catch (error) {
      setState((previous) => ({ ...previous, error: error.message || 'Zones could not be loaded.' }));
    }
  }

  function apply(operation, successMessage) {
    if (state.error) {
      return { success: false, error: 'Zones cannot be changed until saved zone data can be loaded.' };
    }
    try {
      const next = operation(state.zones);
      setState({ zones: next, error: '' });
      setFeedback(successMessage);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Your changes could not be saved.' };
    }
  }

  return {
    zones: state.zones,
    error: state.error,
    feedback,
    clearFeedback: () => setFeedback(''),
    retry,
    add: (values) => apply((zones) => createZone(zones, values), 'Zone added successfully.'),
    edit: (id, values) => apply((zones) => updateZone(zones, id, values), 'Zone updated successfully.'),
    remove: (id) => apply((zones) => deleteZone(zones, id), 'Zone deleted successfully.'),
    changeStatus: (id, status) => apply((zones) => setZoneStatus(zones, id, status), `Zone ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
  };
}