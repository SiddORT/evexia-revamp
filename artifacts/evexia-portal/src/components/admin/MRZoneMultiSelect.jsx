import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { mrReferences } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import './searchableSelect.css';
import '../../mr.css';

const caption = (item) => `${item.name}${item.deleted ? ' (deleted — remove before saving)' : item.status === 'inactive' ? ' (inactive)' : ''}`;

// MR-only: form selection is a finite saved snapshot; filter [] is unrestricted.
export default function MRZoneMultiSelect({ id, values, onChange, primary, savedChoices = [], filter = false, invalid, describedBy, disabled = false, onBusyChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [known, setKnown] = useState(() => Object.fromEntries(savedChoices.map((item) => [item.id, item])));
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allBusy, setAllBusy] = useState(false);
  const [allFeedback, setAllFeedback] = useState('');
  const [active, setActive] = useState(-1);
  const [revision, setRevision] = useState(0);
  const root = useRef(null);
  const input = useRef(null);
  const pageController = useRef(null);
  const allController = useRef(null);
  const generation = useRef(0);
  const gone = useRef(false);
  const latest = useRef(values);
  latest.current = values;
  const busyPage = useRef(false);
  const busyAll = useRef(false);
  const close = () => { setOpen(false); setQuery(''); setActive(-1); };
  const remember = (rows) => setKnown((current) => ({ ...current, ...Object.fromEntries(rows.map((item) => [item.id, item])) }));

  useEffect(() => {
    gone.current = false;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) {
        gone.current = true; generation.current++;
        pageController.current?.abort(); allController.current?.abort();
        setKnown({}); setItems([]); close();
      }
    });
    return () => { gone.current = true; generation.current++; pageController.current?.abort(); allController.current?.abort(); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);
  useEffect(() => {
    if (!open || gone.current) return undefined;
    const controller = new AbortController();
    pageController.current?.abort(); pageController.current = controller;
    const sequence = ++generation.current;
    setItems([]); setOffset(0); setLoading(true); setError(''); busyPage.current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await mrReferences('zones', { query: query.trim(), limit: 100 }, controller.signal);
        if (gone.current || controller.signal.aborted || sequence !== generation.current) return;
        remember(result.items); setItems(result.items); setOffset(result.offset + result.limit); setTotal(result.total);
      } catch (cause) { if (!gone.current && !controller.signal.aborted) setError(cause.message || 'Choices could not be loaded.'); }
      finally { if (sequence === generation.current && !controller.signal.aborted) { setLoading(false); busyPage.current = false; } }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, revision]);

  async function more() {
    if (busyPage.current || gone.current) return;
    busyPage.current = true; setLoading(true); setError('');
    const sequence = generation.current;
    const controller = new AbortController(); pageController.current = controller;
    try {
      const result = await mrReferences('zones', { query: query.trim(), offset, limit: 100 }, controller.signal);
      if (gone.current || controller.signal.aborted || sequence !== generation.current) return;
      remember(result.items);
      setItems((rows) => [...rows, ...result.items.filter((item) => !rows.some((row) => row.id === item.id))]);
      setOffset(result.offset + result.limit); setTotal(result.total);
    } catch (cause) { if (!gone.current && !controller.signal.aborted && sequence === generation.current) setError(cause.message || 'More choices could not be loaded.'); }
    finally { if (sequence === generation.current && !controller.signal.aborted) { busyPage.current = false; setLoading(false); } }
  }

  async function selectAll() {
    if (disabled || gone.current || busyAll.current) return;
    if (filter) { onChange([]); setAllFeedback('All zones: no zone restriction, including unloaded choices.'); return; }
    busyAll.current = true; setAllBusy(true); onBusyChange?.(true); setAllFeedback('Loading every active saved zone. Selection has not changed.');
    const controller = new AbortController(); allController.current = controller;
    try {
      const collected = new Map();
      let expectedTotal = null, version = null, next = 0;
      do {
        const result = await mrReferences('zones', { activeOnly: true, offset: next, limit: 100 }, controller.signal);
        if (gone.current || controller.signal.aborted) return;
        if (result.partial || !Number.isInteger(result.total) || result.total > 10000 || !result.catalogueVersion
            || (expectedTotal !== null && (expectedTotal !== result.total || version !== result.catalogueVersion))
            || result.offset !== next || (result.total > next && !result.items.length)) {
          throw new Error('The zone catalogue changed or could not be fully loaded. Retry Select all; selection is unchanged.');
        }
        expectedTotal = result.total; version = result.catalogueVersion;
        result.items.forEach((item) => {
          if (item.deleted || item.status !== 'active' || collected.has(item.id)) throw new Error('The zone catalogue changed. Retry Select all; selection is unchanged.');
          collected.set(item.id, item);
        });
        next += result.limit;
      } while (next < expectedTotal);
      if (collected.size !== expectedTotal) throw new Error('Not every eligible zone was loaded. Selection is unchanged.');
      const selected = [...new Set([...latest.current, ...collected.keys()])];
      if (selected.length > 10000) throw new Error('More than 10,000 zones would be selected. Select a smaller set.');
      remember([...collected.values()]); onChange(selected);
      setAllFeedback(`Selected all ${expectedTotal} currently active saved zones. Existing selections retained. Future zones are not automatically assigned.`);
    } catch (cause) {
      if (!gone.current && !controller.signal.aborted) setAllFeedback(`Select all failed. ${cause.message} No partial selection was applied.`);
    } finally {
      if (!gone.current && !controller.signal.aborted) { busyAll.current = false; setAllBusy(false); onBusyChange?.(false); }
    }
  }

  function toggle(item) {
    const retainedInactive = !item.deleted && savedChoices.some((saved) => saved.id === item.id);
    if (disabled || allBusy || (!filter && !values.includes(item.id) && !retainedInactive && (item.deleted || item.status !== 'active'))) return;
    setAllFeedback('');
    onChange(values.includes(item.id) ? values.filter((key) => key !== item.id) : [...values, item.id]);
  }
  const summary = values.length ? `${values.length} selected${!filter && primary ? ` · Primary: ${known[primary]?.name || primary}` : ''}` : filter ? 'All zones' : 'Select at least one zone';
  function keyboard(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault(); if (items[Math.max(active, 0)]) toggle(items[Math.max(active, 0)]);
    } else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }
  return <div className="mr-zone-multi" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
    onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); input.current?.focus(); close(); } }}>
    <div className={`searchable-select${open ? ' searchable-select--open' : ''}`}>
      <div className="searchable-select__control">
        <input ref={input} id={id} name="zoneId" role="combobox" aria-label="Assigned zone"
          aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-haspopup="listbox"
          aria-required={!filter} aria-invalid={invalid || undefined} aria-describedby={`${id}-summary${describedBy ? ` ${describedBy}` : ''}`}
          aria-activedescendant={open && items[active] ? `${id}-option-${active}` : undefined}
          autoComplete="off" disabled={disabled || allBusy} value={query} placeholder={summary}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }} onKeyDown={keyboard} />
        <ChevronDown size={16} aria-hidden="true" className="searchable-select__chevron" onClick={() => input.current?.focus()} />
      </div>
      {open && <div className="mr-zone-multi__popup">
        <button type="button" className="mr-zone-multi__action" disabled={disabled || allBusy} onClick={selectAll}>
          {filter && !values.length && <Check size={14} aria-hidden="true" />}{allBusy ? 'Loading all zones…' : 'Select all'}
        </button>
        <div id={`${id}-options`} role="listbox" aria-label="Assigned zones" aria-multiselectable="true">
          {items.map((item, index) => {
            const unavailable = !filter && !values.includes(item.id) && (item.deleted
              || (item.status !== 'active' && !savedChoices.some((saved) => saved.id === item.id)));
            return <div key={item.id} id={`${id}-option-${index}`} role="option" aria-selected={values.includes(item.id) || (filter && !values.length)} aria-disabled={unavailable || disabled || allBusy}
              className={`searchable-select__option${active === index ? ' searchable-select__option--active' : ''}`}
              onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(item)}>
              <span>{caption(item)}</span>{(values.includes(item.id) || (filter && !values.length)) && <Check size={15} aria-hidden="true" />}
            </div>;
          })}
        </div>
        <p role="status" className="searchable-select__empty">{loading ? 'Loading choices…' : error || (!items.length ? 'No saved zones match.' : `Showing ${items.length} of ${total} choices.`)}</p>
        {error && <button type="button" className="mr-zone-multi__action" disabled={loading} onClick={() => items.length ? more() : setRevision((n) => n + 1)}>Retry loading choices</button>}
        {!error && offset < total && <button type="button" className="mr-zone-multi__action" disabled={loading} onClick={more}>Load more</button>}
      </div>}
    </div>
    <div id={`${id}-summary`} className="mr-zone-multi__summary" aria-live="polite">{summary}</div>
    {values.length > 0 && <div className="mr-zone-multi__selected">
      {values.map((key) => <button type="button" key={key} className="mr-zone-multi__chip" disabled={disabled || allBusy}
        aria-label={`Remove ${known[key]?.name || key}`} onClick={() => toggle(known[key] || { id: key })}>
        <span>{known[key] ? caption(known[key]) : key}{!filter && key === primary ? ' · Primary' : ''}</span><X size={12} aria-hidden="true" />
      </button>)}
      <button type="button" className="mr-zone-multi__action" disabled={disabled || allBusy} onClick={() => { onChange([]); setAllFeedback(''); }}>{filter ? 'Reset to all zones' : 'Clear selection'}</button>
    </div>}
    {allBusy && <button type="button" className="mr-zone-multi__action" onClick={() => { allController.current?.abort(); busyAll.current = false; setAllBusy(false); onBusyChange?.(false); setAllFeedback('Select all cancelled. Selection is unchanged.'); }}>Cancel Select all</button>}
    {allFeedback && <p role="status" className="mr-zone-multi__summary">{allFeedback}</p>}
  </div>;
}
