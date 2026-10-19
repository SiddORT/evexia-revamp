import { useCallback, useEffect, useRef, useState } from 'react';
import { listMovements } from '../services/serverInventory.js';

/** Server-paged movement list. Stale replies are discarded. */
export function useMoveStocks() {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
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
    listMovements({ query: applied, offset: (page - 1) * pageSize, limit: pageSize }, controller.signal).then((d) => {
      if (id === seq.current) setState({ rows: d.items || [], filtered: d.filtered ?? 0, total: d.total ?? 0, summary: d.summary || null, loading: false, error: '' });
    }).catch((e) => {
      if (id === seq.current && !controller.signal.aborted) setState((s) => ({ ...s, rows: [], loading: false, error: e.message || 'Movements could not be loaded.' }));
    });
    return () => controller.abort();
  }, [applied, page, pageSize, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [reload]);
  const pageCount = Math.max(1, Math.ceil(state.filtered / pageSize));
  return { ...state, query, setQuery, page: Math.min(page, pageCount), pageCount, pageSize, startIndex: (page - 1) * pageSize,
    setPage, setPageSize: (n) => { setPageSize(n); setPage(1); }, reload };
}
