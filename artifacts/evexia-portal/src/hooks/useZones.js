import { useEffect, useState } from 'react';
import { createZone, deleteZone, loadZones, setZoneStatus, updateZone } from '../services/zones.js';
import { commitImport } from '../services/masterImport.js';

export default function useZones() {
  const [state, setState] = useState(() => {
    try { return { zones: loadZones(), error: '' }; }
    catch (error) { return { zones: [], error: error.message || 'Zones could not be loaded.' }; }
  });
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === 'evexia.admin.zones.v1' || event.key === null) {
        setState((previous) => ({ ...previous, error: 'Zones changed in another tab. Refresh records before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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
    importRows: (entries, snapshots) => {
      if (JSON.stringify(state.zones) !== JSON.stringify(snapshots.zones)) {
        return { success: false, error: 'Zones changed since review. Refresh and review the file again.' };
      }
      return apply(() => commitImport('zone', entries, snapshots), `${entries.length} zone${entries.length === 1 ? '' : 's'} imported successfully.`);
    },
  };
}