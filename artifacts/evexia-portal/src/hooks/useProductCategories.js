import { useEffect, useState } from 'react';
import { CATEGORY_STORAGE_KEY, createCategory, importCategories, loadCategories, setCategoryStatus, updateCategory } from '../services/productCategories.js';

function readState() {
  try { return { records: loadCategories(), error: '' }; }
  catch (cause) { return { records: [], error: cause.message || 'Product categories could not be loaded.' }; }
}

export default function useProductCategories() {
  const [state, setState] = useState(readState);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === CATEGORY_STORAGE_KEY || event.key === null) {
        setState((previous) => ({ ...previous, error: 'Product categories changed in another tab. Refresh records before saving.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function retry() {
    setState(readState());
    setFeedback('');
  }
  function apply(operation, message) {
    if (state.error) return { success: false, error: 'Refresh records before making changes.' };
    try {
      const records = operation();
      setState({ records, error: '' });
      setFeedback(message);
      return { success: true };
    } catch (cause) {
      return { success: false, error: cause.message || 'Product categories could not be saved.' };
    }
  }
  return {
    ...state, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => createCategory(state.records, values), 'Category added successfully.'),
    edit: (id, values) => apply(() => updateCategory(state.records, id, values), 'Category updated successfully.'),
    changeStatus: (id, status) => apply(() => setCategoryStatus(state.records, id, status), `Category ${status === 'active' ? 'activated' : 'inactivated'} successfully.`),
    importRows: (entries, snapshot) => {
      if (!sameRecords(state.records, snapshot)) return { success: false, error: 'Records changed since review. Refresh and review the CSV again.' };
      return apply(() => importCategories(entries, snapshot), `${entries.length} categor${entries.length === 1 ? 'y' : 'ies'} imported successfully.`);
    },
  };
}

function sameRecords(a, b) { return JSON.stringify(a) === JSON.stringify(b); }