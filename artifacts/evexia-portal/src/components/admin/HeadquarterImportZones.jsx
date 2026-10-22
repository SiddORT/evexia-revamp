import { useEffect, useRef, useState } from 'react';
import { listZoneChoices } from '../../services/serverHeadquarters.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';

/** Read-only, HQ-authorized references; never invent or create a zone. */
export default function HeadquarterImportZones({ disabled }) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const request = useRef(null);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) {
        generation.current++; request.current?.abort();
        setQuery(''); setOffset(0); setPage(null); setError(''); setPending(false);
      }
    });
  }, []);
  useEffect(() => {
    if (getSession().status !== 'authenticated') return;
    const controller = new AbortController();
    request.current = controller;
    const guard = reportingIdentityGuard();
    const mine = ++generation.current;
    setPending(true); setPage(null); setError('');
    const timer = setTimeout(() => {
      listZoneChoices({ query: query.trim(), limit: 20, offset }, controller.signal)
        .then((result) => { guard(); if (!controller.signal.aborted && generation.current === mine) setPage(result); })
        .catch((cause) => { try { guard(); } catch { return; } if (!controller.signal.aborted && generation.current === mine) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted && generation.current === mine) setPending(false); });
    }, 250);
    return () => { generation.current++; controller.abort(); clearTimeout(timer); };
  }, [query, offset, tick]);
  return <details className="excel-import__row">
    <summary>Find saved active Zone IDs for your file</summary>
    <label className="admin-search">Search saved zones
      <input value={query} maxLength={200} disabled={disabled} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Zone name" />
    </label>
    {pending && <p role="status">Loading zone references…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="admin-button admin-button--secondary" disabled={pending || disabled} onClick={() => setTick((n) => n + 1)}>Retry zone references</button></div>}
    {page && <><p>Showing {page.items.length ? offset + 1 : 0}–{offset + page.items.length} of {page.total} active zones. Copy the ID exactly into every row for the HQ.</p>
      <dl>{page.items.map((zone) => <div key={zone.id}><dt>{zone.name}</dt><dd style={{ overflowWrap: 'anywhere' }}>{zone.id}</dd></div>)}</dl>
      <button type="button" className="admin-button admin-button--secondary" disabled={disabled || pending || !offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous zones</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={disabled || pending || offset + page.items.length >= page.total} onClick={() => setOffset(offset + 20)}>Next zones</button></>}
  </details>;
}
