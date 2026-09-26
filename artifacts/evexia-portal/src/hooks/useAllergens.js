import { useEffect, useState } from 'react';
import { ALLERGEN_KEY, createAllergen, importAllergens, loadAllergenReferences, loadAllergens, setAllergenStatus, updateAllergen } from '../services/allergens.js';
import { CATEGORY_STORAGE_KEY } from '../services/productCategories.js';
import { STORAGE_LOCATION_KEY } from '../services/storageLocations.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function readState() {
  try {
    const refs = loadAllergenReferences();
    return { refs, records: loadAllergens(refs), error: '' };
  } catch (cause) {
    return { refs: { categories: [], locations: [] }, records: [], error: cause.message || 'Allergen records could not be loaded.' };
  }
}
export default function useAllergens() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    function onStorage(event) {
      if (event.key === null || [ALLERGEN_KEY, CATEGORY_STORAGE_KEY, STORAGE_LOCATION_KEY].includes(event.key)) {
        setState((previous) => ({ ...previous, error: 'Allergen records or reference masters changed in another tab. Refresh records before saving.' }));
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  function retry() { setState(readState()); setFeedback(''); }
  function apply(operation, message) {
    if (state.error) return { success: false, error: 'Refresh records before making changes.' };
    try {
      const records = operation();
      setState((previous) => ({ ...previous, records, error: '' }));
      setFeedback(message);
      return { success: true };
    } catch (cause) { return { success: false, error: cause.message || 'Allergen records could not be saved.' }; }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => createAllergen(state.records, state.refs, values), 'Product added successfully.'),
    edit: (id, values) => apply(() => updateAllergen(state.records, state.refs, id, values), 'Product updated successfully.'),
    changeStatus: (id, status) => apply(() => setAllergenStatus(state.records, state.refs, id, status), `Product ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    importRows: (entries, snapshot, referenceSnapshot) => {
      if (!same(state.records, snapshot) || !same(state.refs, referenceSnapshot)) return { success: false, error: 'Records changed since review. Refresh and review the CSV again.' };
      return apply(() => importAllergens(entries, snapshot, referenceSnapshot), `${entries.length} product${entries.length === 1 ? '' : 's'} imported successfully.`);
    },
  };
}