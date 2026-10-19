import { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './SearchableSelect.jsx';
import '../../inventoryServer.css';

const PAGE = 50;

/** Server-searched, server-paged choices. "Load more" keeps later choices reachable. */
export default function ReferenceSelect({ id, label, kind, extra, value, selected, onChange, exclude, pinned = [], placeholder, invalid, describedBy, fetchPage, disabled = false }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ items: [], filtered: 0, loading: true, error: '' });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const extraKey = JSON.stringify(extra || {});

  function run(offset, replace) {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '', items: replace ? [] : s.items }));
    fetchPage(kind, { ...(extra || {}), query, offset, limit: PAGE }).then((d) => {
      if (mine !== seq.current) return;
      setState((s) => ({ items: replace ? d.items : [...s.items, ...d.items], filtered: d.filtered, loading: false, error: '' }));
    }).catch((e) => { if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: e.message || 'Choices could not be loaded.' })); });
  }
  useEffect(() => { const t = setTimeout(() => run(0, true), query ? 250 : 0); return () => { clearTimeout(t); seq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, extraKey, tick, kind]);

  const options = useMemo(() => {
    const map = new Map();
    pinned.forEach((o) => map.set(o.value, o));
    if (selected) map.set(selected.value, { ...selected });
    state.items.forEach((i) => { const typedItem = kind === 'items' && i.itemKind; const k = typedItem ? `${i.itemKind}:${i.id}` : i.id; if (!map.has(k)) map.set(k, typedItem ? { value: k, itemId: i.id, label: `${i.name} (${i.itemKind === 'combo' ? 'Product' : 'Allergen'}, ${i.unit}; ${i.id})`, itemKind: i.itemKind, unit: i.unit } : { value: i.id, label: i.name }); });
    if (exclude) map.delete(exclude);
    return [...map.values()];
  }, [state.items, selected, exclude, pinned, kind]);
  const hasMore = state.items.length < state.filtered;
  return <div>
    <SearchableSelect id={id} label={label} value={value} options={options} searchOptions={() => options} onSearch={setQuery} onChange={(v) => { if (!disabled) onChange(v, options.find((o) => o.value === v)); }} placeholder={placeholder} invalid={invalid} describedBy={describedBy} disabled={disabled} />
    <div className="inv-more" aria-live="polite">
      {state.loading && <span>Loading choices…</span>}
      {state.error && <><span role="alert">{state.error}</span><button type="button" className="admin-button admin-button--secondary" onClick={() => (state.items.length ? run(state.items.length, false) : setTick((t) => t + 1))}>Retry</button></>}
      {!state.loading && !state.error && state.filtered > 0 && <span>Showing {state.items.length} of {state.filtered}. Search to narrow.</span>}
      {hasMore && !state.loading && <button type="button" className="admin-button admin-button--secondary" onClick={() => run(state.items.length, false)}>Load more</button>}
    </div>
  </div>;
}
