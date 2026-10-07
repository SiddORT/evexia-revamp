import { useEffect, useRef, useState } from 'react';
import { mrReferences } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';

// Server-searched, server-paged reference choices. Never silently truncates:
// "Load more" continues until total is reached; saved choice is always kept.
export default function MRReferenceSelect({ id, kind, label, value, savedName, onChange, placeholder, invalid, describedBy, excludeId, emptyGuidance, required }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState('loading');
  const [revision, setRevision] = useState(0);
  const [more, setMore] = useState(false);
  const sequence = useRef(0);
  const nextOffset = useRef(0);
  const savedRef = useRef(value);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { if (getSession().user?.id !== owner) { sequence.current++; setItems([]); } });
  }, []);
  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    setState('loading');
    const timer = setTimeout(() => {
      mrReferences(kind, { query: query.trim(), limit: 100, offset: 0, includeSaved: savedRef.current || undefined }, controller.signal)
        .then((result) => { if (current === sequence.current) { nextOffset.current = Math.min(result.offset + result.limit, result.total); setItems(result.items); setTotal(result.total); setState('ready'); } })
        .catch((cause) => { if (current === sequence.current && !controller.signal.aborted) { setState(cause.message || 'error'); } });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, query, revision]);
  async function loadMore() {
    const current = sequence.current;
    setMore(true);
    try {
      const result = await mrReferences(kind, { query: query.trim(), limit: 100, offset: nextOffset.current, includeSaved: savedRef.current || undefined });
      if (current === sequence.current) { nextOffset.current = Math.min(result.offset + result.limit, result.total); setItems((existing) => [...existing, ...result.items.filter((item) => !existing.some((known) => known.id === item.id))]); setTotal(result.total); }
    } catch (cause) { if (current === sequence.current) setState(cause.message || 'error'); }
    finally { setMore(false); }
  }
  const visible = items.filter((item) => item.id !== excludeId);
  const saved = value && !visible.some((item) => item.id === value) ? { id: value, name: savedName || 'Saved choice', status: 'active' } : null;
  const options = saved ? [saved, ...visible] : visible;
  const failed = state !== 'loading' && state !== 'ready';
  return <div className="mr-reference">
    <input className="mr-form__control mr-reference__search" type="search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)}
      placeholder="Search to narrow the list" aria-label={`Search ${label}`} data-testid={`input-search-mr-${kind}`} />
    <select id={id} name={id.replace('mr-', '')} className="mr-form__control" value={value} onChange={(event) => onChange(event.target.value)}
      aria-required={required} aria-invalid={invalid} aria-describedby={describedBy} aria-busy={state === 'loading'} data-testid={`select-mr-${kind}`}>
      <option value="">{state === 'loading' ? 'Loading choices…' : placeholder}</option>
      {options.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === 'inactive' ? ' (inactive)' : ''}{item.deleted ? ' (deleted)' : ''}</option>)}
    </select>
    <p className="mr-form__section-note" role="status">
      {failed ? <>Choices could not be loaded. <button type="button" className="mr-form__preview-action" onClick={() => setRevision((n) => n + 1)}>Retry</button></>
        : state === 'ready' && !total && !query ? emptyGuidance
        : state === 'ready' ? `Showing ${items.length} of ${total}.` : ''}
      {state === 'ready' && nextOffset.current < total && <> <button type="button" className="mr-form__preview-action" disabled={more} onClick={loadMore} data-testid={`button-more-mr-${kind}`}>{more ? 'Loading…' : 'Load more'}</button></>}
    </p>
  </div>;
}
