import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import useSelectViewportMenu from './useSelectViewportMenu.js';
import './searchableSelect.css';

const caption = (item) => `${item.name}${item.status !== 'active' ? ` (${item.status})` : ''}`;

// Pricing-only finite membership. Never turns category selection into a wildcard.
export default function PricingMultiSelect({ id, label, values, onChange, fetchPage, scopeKey = '',
  categories, disabled, invalid, describedBy, max = 100, onBusyChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setItems] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);
  // Render-time scope gate also covers the interval before effects invalidate.
  const items = loadedFor === `${scopeKey}\n${query}` ? rows : [];
  const [total, setTotal] = useState(0);
  const [state, setState] = useState('idle');
  const [feedback, setFeedback] = useState('');
  const [allBusy, setAllBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const [revision, setRevision] = useState(0);
  const root = useRef(null), anchor = useRef(null), input = useRef(null), menu = useRef(null);
  const generation = useRef(0), pageCtl = useRef(null), allCtl = useRef(null), pageBusy = useRef(false);
  const pageVersion = useRef(null);
  const latest = useRef(null);
  latest.current = { values, scopeKey, disabled, fetchPage, onChange, onBusyChange };
  const style = useSelectViewportMenu(open && !disabled, anchor, menu);
  const cancelAll = () => {
    allCtl.current?.abort(); allCtl.current = null; setAllBusy(false); latest.current.onBusyChange?.(false);
  };
  const cancel = () => {
    generation.current++; pageCtl.current?.abort(); pageBusy.current = false; cancelAll();
  };
  const close = () => { cancel(); setOpen(false); setQuery(''); setActive(-1); };
  useEffect(() => () => {
    generation.current++; pageCtl.current?.abort(); allCtl.current?.abort();
    latest.current.onBusyChange?.(false);
  }, []);
  useEffect(() => {
    cancel(); setItems([]); setLoadedFor(null); pageVersion.current = null; setTotal(0); setActive(-1); setFeedback('');
    if (!open || disabled) { setState('idle'); return undefined; }
    setState('loading');
    const timer = setTimeout(() => load(0), query ? 250 : 0);
    return () => { clearTimeout(timer); generation.current++; pageCtl.current?.abort(); allCtl.current?.abort(); };
  }, [open, query, scopeKey, disabled, revision]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!root.current?.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);

  async function load(offset) {
    if (pageBusy.current || latest.current.disabled) return;
    pageBusy.current = true; setState('loading');
    const seq = generation.current, scope = scopeKey;
    const ctl = new AbortController(); pageCtl.current = ctl;
    try {
      const page = await latest.current.fetchPage(query.trim(), offset, ctl.signal);
      if (ctl.signal.aborted || seq !== generation.current || scope !== latest.current.scopeKey) return;
      if (offset && (page.catalogueVersion !== pageVersion.current || total !== page.total
        || page.items.some((a) => items.some((b) => a.id === b.id)))) {
        throw new Error('The catalogue changed during paging. Retry choices to load it again; selections are retained.');
      }
      // Keep focus before the last paging button disappears.
      if (offset && document.activeElement?.dataset.pricingMore === id) input.current?.focus();
      pageVersion.current = page.catalogueVersion;
      setLoadedFor(`${scopeKey}\n${query}`);
      setItems((old) => offset ? [...old, ...page.items] : page.items);
      setTotal(page.total); setState('ready');
    } catch (cause) {
      if (!ctl.signal.aborted && seq === generation.current && scope === latest.current.scopeKey) setState(cause.message || 'Choices could not be loaded.');
    } finally { if (seq === generation.current) pageBusy.current = false; }
  }

  async function selectAll() {
    if (allCtl.current && !allCtl.current.signal.aborted) return;
    const ctl = new AbortController(); allCtl.current = ctl;
    const seq = generation.current, scope = scopeKey;
    setAllBusy(true); latest.current.onBusyChange?.(true); setFeedback('Collecting every matching allergen. Selection is unchanged until complete.');
    try {
      const collected = new Map();
      let offset = 0, expected = null, version = null;
      do {
        const page = await latest.current.fetchPage(query.trim(), offset, ctl.signal);
        if (ctl.signal.aborted || seq !== generation.current || scope !== latest.current.scopeKey || latest.current.disabled) return;
        if (expected !== null && (expected !== page.total || version !== page.catalogueVersion)) throw new Error('The catalogue changed. Retry Select all.');
        expected = page.total; version = page.catalogueVersion;
        if (expected > max) throw new Error(`More than ${max} allergens match. Narrow the search or categories.`);
        page.items.forEach((a) => {
          if (collected.has(a.id)) throw new Error('The catalogue changed. Retry Select all.');
          collected.set(a.id, { ...a, savedCategoryId: a.categoryId });
        });
        offset += page.items.length;
        if (offset < expected && !page.items.length) throw new Error('Not every match could be loaded.');
      } while (offset < expected);
      if (collected.size !== expected) throw new Error('Not every match could be loaded.');
      const union = new Map(latest.current.values.map((a) => [a.id, a]));
      collected.forEach((a, key) => { if (!union.has(key)) union.set(key, a); });
      if (union.size > max) throw new Error(`This would exceed ${max} selected allergens. Remove selections or narrow the search.`);
      latest.current.onChange([...union.values()]);
      setFeedback(`Selected all ${expected} matching active allergens; existing choices retained. Future allergens are not included.`);
    } catch (cause) {
      if (!ctl.signal.aborted && seq === generation.current) setFeedback(`${cause.message} No partial selection was applied.`);
    } finally {
      if (allCtl.current === ctl) { allCtl.current = null; setAllBusy(false); latest.current.onBusyChange?.(false); }
    }
  }

  function toggle(item) {
    if (disabled || allBusy) return;
    const exists = values.some((a) => a.id === item.id);
    if (!exists && values.length >= max) { setFeedback(`Choose at most ${max}. Remove a selection first.`); return; }
    setFeedback('');
    onChange(exists ? values.filter((a) => a.id !== item.id) : [...values, { ...item, ...(categories ? { savedCategoryId: item.categoryId } : {}) }]);
  }
  const groups = categories
    ? [...new Set(items.map((a) => a.categoryId))].map((cid) => ({ id: cid, name: categories.find((c) => c.id === cid)?.name, items: items.filter((a) => a.categoryId === cid) }))
    : [{ id: 'categories', items }];
  const summary = `${values.length} selected${categories ? ` / ${max}` : ''}`;
  const keyboard = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true); setActive((n) => e.key === 'ArrowDown' ? Math.min(n + 1, items.length - 1) : Math.max(0, n - 1));
    } else if (e.key === 'Enter' && open) { e.preventDefault(); if (items[Math.max(0, active)]) toggle(items[Math.max(0, active)]); }
  };
  return <div ref={root} className="pricing-multi" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}
    onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); input.current?.focus(); close(); } }}>
    <div ref={anchor} className={`searchable-select searchable-select--viewport${open ? ' searchable-select--open' : ''}`}>
      <div className="searchable-select__control">
        <input id={id} ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-options`}
          aria-autocomplete="list" aria-required="true" aria-invalid={Boolean(invalid)}
          aria-describedby={[`${id}-summary`, describedBy].filter(Boolean).join(' ')}
          aria-activedescendant={open && items[active] ? `${id}-option-${active}` : undefined}
          autoComplete="off" maxLength={100} disabled={disabled} value={open ? query : ''} placeholder={disabled ? 'Choose active categories first' : `Search ${label.toLowerCase()}…`}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={keyboard}
          onChange={(e) => { cancel(); setItems([]); setTotal(0); setState('loading'); setActive(-1); setQuery(e.target.value); setOpen(true); }} />
        <ChevronDown className="searchable-select__chevron" size={16} aria-hidden="true" onClick={() => { if (!disabled) { input.current?.focus(); setOpen(true); } }} />
      </div>
      {open && !disabled && <div ref={menu} className="searchable-select__menu pricing-multi__menu" style={style}>
        {categories && <div className="pricing-multi__scope"><small>{query.trim() ? 'All matching active allergens in selected categories, across every page.' : 'Every active allergen in selected categories, across every page.'}</small>
          <button type="button" className="admin-button admin-button--secondary" disabled={allBusy} onClick={selectAll}>{allBusy ? 'Selecting…' : 'Select all'}</button>
          {allBusy && <button type="button" className="admin-button admin-button--secondary" onClick={() => { cancelAll(); setFeedback('Select all cancelled. Selection unchanged.'); }}>Cancel Select all</button>}
        </div>}
        <div id={`${id}-options`} role="listbox" aria-label={label} aria-multiselectable="true" aria-busy={state === 'loading'}>
          {groups.map((group) => <div key={group.id} role={categories ? 'group' : undefined} aria-label={group.name}>
            {categories && <h3 className="pricing-multi__heading">{group.name}</h3>}
            {group.items.map((item) => {
              const index = items.findIndex((a) => a.id === item.id), selected = values.some((a) => a.id === item.id);
              return <div id={`${id}-option-${index}`} key={item.id} role="option" aria-selected={selected} aria-disabled={allBusy || (!selected && values.length >= max)}
                className={`searchable-select__option${index === active ? ' searchable-select__option--active' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(item)}>
                <span className="pricing-multi__check" aria-hidden="true">{selected && <Check size={13} />}</span><span>{item.name}</span>
              </div>;
            })}
          </div>)}
        </div>
        <div className="searchable-select__empty" role="status">{state === 'loading' ? 'Loading choices…' : state === 'ready' ? (items.length ? `${items.length} of ${total} choices` : 'No active matches.') : state === 'idle' ? '' : state}</div>
        {!['loading', 'ready', 'idle'].includes(state) && <button type="button" className="admin-button admin-button--secondary" onClick={() => { setItems([]); setRevision((n) => n + 1); }}>Retry choices</button>}
        {state === 'ready' && items.length < total && <button type="button" className="admin-button admin-button--secondary" data-pricing-more={id} onClick={() => load(items.length)}>Load more</button>}
      </div>}
    </div>
    <small id={`${id}-summary`} aria-live="polite">{summary}</small>
    {values.length > 0 && <div className="pricing-multi__selected">
      <ul className="pricing-rule-row__chips" aria-label={`Selected ${label.toLowerCase()}`}>{values.map((item) => {
        const moved = categories && item.categoryId !== item.savedCategoryId;
        const group = categories?.find((c) => c.id === item.savedCategoryId);
        return <li className={`pricing-chip${item.status !== 'active' || moved ? ' pricing-chip--deleted' : ''}`} key={item.id}>
          <span>{group && `${group.name}: `}{caption(item)}{moved && ' (moved — remove and reselect)'}</span>
          <button type="button" disabled={disabled || allBusy} aria-label={`Remove ${group ? `${group.name}: ` : ''}${item.name}`} onClick={() => toggle(item)}><X size={12} aria-hidden="true" /></button>
        </li>;
      })}</ul>
      <button type="button" className="pricing-multi__clear" disabled={disabled} onClick={() => { cancelAll(); onChange([]); setFeedback(''); }}>Clear selection</button>
    </div>}
    {feedback && <small role="status">{feedback}</small>}
  </div>;
}
