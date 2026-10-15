import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './SearchableSelect.jsx';
import { listPurchaseOrderFilterOptions, listPurchaseOrderReferences } from '../../services/serverPurchaseOrders.js';

const LIMIT = 25;
const empty = { items: [], filtered: 0, total: 0, offset: 0 };

/**
 * Searchable, server-paged reference picker. Searches never include selected_id, so a replacement search is never
 * restricted to the current selection. The selected record comes from the parent (set only by explicit choice).
 */
export default function PurchaseOrderReferenceSelect({ id, kind, source = 'references', label, selected, onChange, placeholder, invalid, describedBy, disabled }) {
  const [page, setPage] = useState(empty);
  const [state, setState] = useState('idle');
  const seq = useRef(0);
  const abort = useRef(null);
  const timer = useRef(null);
  const queryRef = useRef('');
  const selectedId = selected?.id || '';

  const invalidate = useCallback(() => {
    seq.current += 1;
    abort.current?.abort();
    clearTimeout(timer.current);
  }, []);

  const load = useCallback((query, offset) => {
    invalidate();
    const controller = new AbortController();
    abort.current = controller;
    const request = seq.current;
    setState('loading');
    const fetcher = source === 'filter-options' ? listPurchaseOrderFilterOptions : listPurchaseOrderReferences;
    fetcher(kind, { query, limit: LIMIT, offset }, controller.signal).then((result) => {
      if (request !== seq.current) return;
      setPage({ items: result.items || [], filtered: result.filtered ?? 0, total: result.total ?? 0, offset: result.offset ?? offset });
      setState('ready');
    }).catch((error) => {
      if (request !== seq.current || error?.name === 'AbortError') return;
      setPage(empty);
      setState('error');
    });
  }, [kind, source, invalidate]);

  useEffect(() => invalidate, [invalidate]);
  useEffect(() => { if (disabled) { invalidate(); setState('idle'); } }, [disabled, invalidate]);

  const options = useMemo(() => {
    const list = page.items.map((item) => ({ value: item.id, label: item.name, item }));
    if (selected && !list.some((option) => option.value === selected.id)) list.unshift({ value: selected.id, label: selected.name, item: selected });
    return list;
  }, [page.items, selected]);

  function search(query) {
    const text = query.trim();
    invalidate(); // drop any in-flight response for the previous query right away
    queryRef.current = text;
    setState('loading');
    setPage(empty);
    timer.current = setTimeout(() => { if (!disabled) load(text, 0); }, text ? 250 : 0);
  }

  function go(offset) {
    load(queryRef.current, Math.max(0, offset));
    // The menu closes when focus moves to the pager; reopen it with the preserved query.
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

  const first = page.filtered ? page.offset + 1 : 0;
  const last = page.offset + page.items.length;
  const paged = state === 'ready' && page.filtered > LIMIT;

  return <>
    <SearchableSelect id={id} label={label} value={selectedId} options={options} searchOptions={() => state === 'ready' ? page.items.map((item) => ({ value: item.id, label: item.name, item })) : []} onSearch={search} preserveSearch
      onChange={(value) => onChange(options.find((option) => option.value === value)?.item || null)}
      placeholder={placeholder} invalid={invalid} describedBy={describedBy} disabled={disabled} />
    {state === 'error' && <p className="mr-form__error" role="alert">Could not load {label.toLowerCase()} choices. <button type="button" className="po-link" onClick={() => load(queryRef.current, page.offset)}>Retry</button></p>}
    {state === 'loading' && <p className="mr-form__hint" role="status">Loading matches…</p>}
    {paged && <p className="mr-form__hint" role="group" aria-label={`${label} result pages`}>
      Matches {first}–{last} of {page.filtered}{' '}
      <button type="button" className="po-link" disabled={disabled || page.offset === 0} onClick={() => go(page.offset - LIMIT)}>Previous</button>{' · '}
      <button type="button" className="po-link" disabled={disabled || last >= page.filtered} onClick={() => go(page.offset + LIMIT)}>Next</button>
    </p>}
  </>;
}
