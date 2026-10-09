import { useEffect, useRef, useState } from 'react';
import { listAllergenReferences } from '../../services/serverAllergens.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

const PAGE = 25;
// Debounced, searchable, paged selector over shared reference masters. The
// retained option keeps an unchanged saved inactive/deleted reference visible.
export default function AllergenRefPicker({ id, kind, label, value, onChange, retained = null, includeUnusable = false, allLabel = '', invalid = false, testId, className = 'mr-form__control' }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const seen = useRef(new Map());
  useEffect(() => { setOffset(0); setItems([]); }, [search, kind, includeUnusable]);
  useEffect(() => {
    const controller = new AbortController();
    let guard;
    try { guard = reportingIdentityGuard(); } catch { return undefined; }
    setLoading(true);
    const timer = setTimeout(() => {
      listAllergenReferences(kind, { query: search.trim(), limit: PAGE, offset, include_unusable: includeUnusable }, controller.signal)
        .then((result) => {
          guard();
          if (controller.signal.aborted) return;
          result.items.forEach((item) => seen.current.set(item.id, item));
          setItems((current) => offset ? [...current, ...result.items.filter((item) => !current.some((c) => c.id === item.id))] : result.items);
          setTotal(result.total); setError('');
        })
        .catch((cause) => { try { guard(); } catch { return; } if (!controller.signal.aborted) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, offset ? 0 : 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, search, offset, includeUnusable, revision]);
  const options = [...items];
  if (value && !options.some((item) => item.id === value)) {
    const known = retained && retained.id === value ? retained : seen.current.get(value);
    if (known) options.unshift(known);
  }
  const suffix = (item) => item.status && item.status !== 'active' ? ` (${item.status})` : '';
  const noun = kind === 'categories' ? 'categories' : 'storage locations';
  return <div className="admin-allergen-picker">
    <label className="sr-only" htmlFor={`${id}-search`}>Search {noun} for {label}</label>
    <input id={`${id}-search`} className={className} maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${noun}`} data-testid={`${testId}-search`} />
    <select id={id} className={className} value={value || ''} onChange={(event) => { const item = options.find((o) => o.id === event.target.value); onChange(event.target.value, item || null); }} aria-invalid={invalid || undefined} aria-busy={loading} data-testid={testId}>
      <option value="">{allLabel || `Select ${label.toLowerCase()}`}</option>
      {options.map((item) => <option key={item.id} value={item.id}>{item.name}{suffix(item)}</option>)}
    </select>
    {error ? <p className="mr-form__error" role="alert">{error} <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((v) => v + 1)}>Retry</button></p>
      : loading ? <p className="mr-form__hint" role="status">Loading {noun}…</p>
      : !options.length ? <p className="mr-form__hint" role="status">No matching {noun}.</p>
      : items.length < total && <button type="button" className="admin-button admin-button--secondary" onClick={() => setOffset(items.length)} data-testid={`${testId}-more`}>Load more ({total - items.length} remaining)</button>}
  </div>;
}
