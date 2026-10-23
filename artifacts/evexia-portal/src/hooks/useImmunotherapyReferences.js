import { useEffect, useRef, useState } from 'react';
import { request } from '../services/serverImmunotherapy.js';

// One finite section per explicit search/continuation; no hidden directory walk.
export default function useImmunotherapyReferences(kind, saved = [], selected = '') {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState({ items: [], nextCursor: null });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const token = ++sequence.current;
    const controller = new AbortController();
    setState('loading'); setError('');
    const timer = setTimeout(() => {
      request(`/references/${kind}`, { params: { search: query, limit: 25, selected }, signal: controller.signal })
        .then((result) => { if (token === sequence.current) { setPage(result); setState('ready'); } })
        .catch((cause) => { if (!controller.signal.aborted && token === sequence.current) { setPage({ items: [], nextCursor: null }); setError(cause.message); setState('error'); } });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; };
  }, [kind, query, revision, selected]);
  async function more() {
    if (!page.nextCursor || state === 'loading') return;
    const token = ++sequence.current;
    setState('loading'); setError('');
    try {
      const result = await request(`/references/${kind}`, { params: { search: query, cursor: page.nextCursor, limit: 25, selected } });
      if (token === sequence.current) { setPage((p) => ({ ...result, items: [...p.items, ...result.items] })); setState('ready'); }
    } catch (cause) { if (token === sequence.current) { setError(cause.message); setState('error'); } }
  }
  const items = [...saved.filter(Boolean), ...page.items].filter((item, i, all) => all.findIndex((v) => v.id === item.id) === i);
  return { items, liveItems: page.items, query, onSearch: setQuery, state, error, more, nextCursor: page.nextCursor,
    retry: () => setRevision((n) => n + 1), remember: (item) => setPage((p) => ({ ...p, items: [item, ...p.items.filter((v) => v.id !== item.id)] })) };
}
