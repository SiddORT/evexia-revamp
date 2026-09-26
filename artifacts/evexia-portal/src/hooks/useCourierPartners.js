import { useEffect, useState } from 'react';
import {
  COURIER_PARTNER_STORAGE_KEY, createCourierPartner, deleteCourierPartner,
  loadCourierPartners, setCourierPartnerStatus, updateCourierPartner,
} from '../services/courierPartners.js';

export default function useCourierPartners() {
  const [state, setState] = useState(() => {
    try { return { records: loadCourierPartners(), error: '' }; }
    catch (error) { return { records: [], error: error.message }; }
  });
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === COURIER_PARTNER_STORAGE_KEY || event.key === null) {
        setState((previous) => ({ ...previous, error: 'Courier partners changed in another tab. Refresh records before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  function retry() {
    try { setState({ records: loadCourierPartners(), error: '' }); setFeedback(''); }
    catch (error) { setState((previous) => ({ ...previous, error: error.message })); }
  }
  function apply(operation, message) {
    if (state.error) return { success: false, error: 'Courier partners cannot be changed until saved data is refreshed.' };
    try {
      const records = operation(state.records);
      setState({ records, error: '' });
      setFeedback(message);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Your changes could not be saved.' };
    }
  }
  return {
    records: state.records, error: state.error, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply((records) => createCourierPartner(records, values), 'Courier partner added successfully.'),
    edit: (id, values) => apply((records) => updateCourierPartner(records, id, values), 'Courier partner updated successfully.'),
    remove: (id) => apply((records) => deleteCourierPartner(records, id), 'Courier partner deleted successfully.'),
    changeStatus: (id, status) => apply((records) => setCourierPartnerStatus(records, id, status), `Courier partner ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
  };
}