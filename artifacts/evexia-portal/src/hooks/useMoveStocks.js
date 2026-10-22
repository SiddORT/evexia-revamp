import { useCallback, useEffect, useRef, useState } from 'react';
import { listMovements } from '../services/serverInventory.js';

/** Server-paged movement list. Stale replies are discarded. */
export function useMoveStocks() {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [source, setSource] = useState(null);
  const [destination, setDestination] = useState(null);
  const [allergens, setAllergens] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [state, setState] = useState({ rows: [], filtered: 0, total: 0, summary: null, loading: true, error: '' });
  const seq = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => { const t = setTimeout(() => { setApplied(query.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => {
    const id = ++seq.current;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    listMovements({ query: applied, source_id: source?.value === 'unallocated' ? undefined : source?.value,
      unallocated: source?.value === 'unallocated' || undefined, destination_id: destination?.value,
      allergen_ids: allergens.map((o) => o.value), offset: (page - 1) * pageSize, limit: pageSize }, controller.signal).then((d) => {
      if (id === seq.current && !controller.signal.aborted) setState({ rows: d.items || [], filtered: d.filtered ?? 0, total: d.total ?? 0, summary: d.summary || null, loading: false, error: '' });
    }).catch((e) => {
      if (id === seq.current && !controller.signal.aborted) setState((s) => ({ ...s, rows: [], loading: false, error: e.message || 'Movements could not be loaded.' }));
    });
    return () => controller.abort();
  }, [applied, source, destination, allergens, page, pageSize, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [reload]);
  const pageCount = Math.max(1, Math.ceil(state.filtered / pageSize));
  useEffect(() => { if (!state.loading && !state.error && page > pageCount) setPage(pageCount); }, [state.loading, state.error, page, pageCount]);
  const changeFilter = (setter) => (value) => { setter(value); setPage(1); };
  const resetFilters = () => { setQuery(''); setApplied(''); setSource(null); setDestination(null); setAllergens([]); setPage(1); };
  return { ...state, query, setQuery: changeFilter(setQuery), source, destination, allergens,
    setSource: changeFilter(setSource), setDestination: changeFilter(setDestination), setAllergens: changeFilter(setAllergens),
    resetFilters, activeFilters: Number(Boolean(source)) + Number(Boolean(destination)) + Number(allergens.length > 0),
    page, pageCount, pageSize, startIndex: (page - 1) * pageSize,
    setPage, setPageSize: (n) => { setPageSize(n); setPage(1); }, reload };
}
