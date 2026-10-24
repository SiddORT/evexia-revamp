import { useEffect, useRef, useState } from 'react';
import { request } from '../services/serverImmunotherapy.js';
import { contactReadScope, reportingIdentityGuard } from '../auth/adminSession.js';
import { useAdminSession } from '../auth/AdminBoundary.jsx';

// One finite section per explicit search/continuation; no hidden directory walk.
export default function useImmunotherapyReferences(kind, saved = [], selected = '', requester = request) {
  const { user } = useAdminSession();
  const scope = contactReadScope(user);
  const savedScope = useRef(scope);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState({ items: [], nextCursor: null });
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const token = ++sequence.current;
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setState('loading'); setError('');
    const timer = setTimeout(() => {
      requester(`/references/${kind}`, { params: { search: query, limit: 25, selected }, signal: controller.signal })
        .then((result) => { guard(); if (token === sequence.current) { setPage({ ...result, scope }); setState('ready'); } })
        .catch((cause) => { if (!controller.signal.aborted && token === sequence.current) { setPage({ items: [], nextCursor: null }); setError(cause.message); setState('error'); } });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; };
  }, [kind, query, revision, selected, requester, scope]);
  async function more() {
    if (page.scope !== scope || !page.nextCursor || state === 'loading') return;
    const token = ++sequence.current;
    const guard = reportingIdentityGuard();
    setState('loading'); setError('');
    try {
      const result = await requester(`/references/${kind}`, { params: { search: query, cursor: page.nextCursor, limit: 25, selected } });
      guard();
      if (token === sequence.current) { setPage((p) => ({ ...result, scope, items: [...(p.scope === scope ? p.items : []), ...result.items] })); setState('ready'); }
    } catch (cause) { if (token === sequence.current) { setError(cause.message); setState('error'); } }
  }
  const liveItems = page.scope === scope ? page.items : [];
  const items = [...(savedScope.current === scope ? saved.filter(Boolean) : []), ...liveItems].filter((item, i, all) => all.findIndex((v) => v.id === item.id) === i);
  return { items, liveItems, query, onSearch: setQuery, state, error, more, nextCursor: page.scope === scope ? page.nextCursor : null,
    retry: () => setRevision((n) => n + 1), remember: (item) => {
      if (contactReadScope() === scope) setPage((p) => ({ ...p, scope, items: [item, ...(p.scope === scope ? p.items.filter((v) => v.id !== item.id) : [])] }));
    } };
}
