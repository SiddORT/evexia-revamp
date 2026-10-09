import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import './searchableSelect.css';

// Bounded, server-searched, paginated combobox. fetchPage(query, offset, signal) -> { items:[{value,label,raw}], total }.
export default function RemoteSelect({ id, label, value, selected, fetchPage, resetKey = '', onChange, placeholder, invalid, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState('idle');
  const root = useRef(null);
  const input = useRef(null);
  const seq = useRef(0);
  const ctl = useRef(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  function load(text, offset) {
    const mine = ++seq.current;
    ctl.current?.abort();
    const controller = new AbortController();
    ctl.current = controller;
    setState('loading');
    fetchRef.current(text, offset, controller.signal)
      .then((page) => { if (mine !== seq.current) return; setItems((old) => offset ? [...old, ...page.items] : page.items); setTotal(page.total); setState('ready'); })
      .catch((cause) => { if (mine === seq.current) setState(cause?.message || 'error'); });
  }
  useEffect(() => {
    // Invalidate immediately: older responses and options never survive a query or scope change.
    seq.current++; ctl.current?.abort();
    setItems([]); setTotal(0); setActive(-1);
    if (!open) { setState('idle'); return undefined; }
    setState('loading');
    const t = setTimeout(() => load(query.trim(), 0), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, query, resetKey]);
  useEffect(() => () => { seq.current++; ctl.current?.abort(); }, []);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id, open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  function close() { setOpen(false); setQuery(''); setActive(-1); seq.current++; ctl.current?.abort(); }
  function choose(item) { onChange(item); close(); input.current?.focus(); }
  const more = items.length < total;
  function key(event) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => event.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open) { event.preventDefault(); if (items[Math.max(active, 0)]) choose(items[Math.max(active, 0)]); }
    else if (event.key === 'Tab') close();
  }
  return <div className={`searchable-select${open ? ' searchable-select--open' : ''}`} ref={root}>
    <div className="searchable-select__control">
      <input ref={input} id={id} type="text" role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-invalid={Boolean(invalid)}
        aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} autoComplete="off" disabled={disabled} maxLength={100}
        value={open ? query : selected?.label || ''} placeholder={open ? `Search ${label.toLowerCase()}…` : placeholder}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(e) => { setOpen(true); setQuery(e.target.value); setActive(-1); }} onKeyDown={key} data-testid={`select-${id}`} />
      {value && !disabled && <button type="button" className="searchable-select__clear" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { onChange(null); close(); input.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
      <ChevronDown size={16} className="searchable-select__chevron" aria-hidden="true" onClick={() => { input.current?.focus(); setOpen(true); }} />
    </div>
    {open && <div id={`${id}-options`} role="listbox" aria-label={label} className="searchable-select__menu">
      {items.map((item, index) => <div key={item.value} id={`${id}-option-${index}`} role="option" aria-selected={item.value === value}
        className={`searchable-select__option${index === active ? ' searchable-select__option--active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(item)}>{item.label}{item.value === value && <Check size={15} aria-hidden="true" />}</div>)}
      {state === 'loading' && <div className="searchable-select__empty" role="status">Searching…</div>}
      {state === 'ready' && !items.length && <div className="searchable-select__empty" role="status">No matches found</div>}
      {state !== 'loading' && state !== 'ready' && state !== 'idle' && <div className="searchable-select__empty" role="alert">{state} <button type="button" className="admin-button admin-button--secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => load(query.trim(), 0)}>Retry</button></div>}
      {state === 'ready' && more && <button type="button" className="admin-button admin-button--secondary" style={{ margin: 6 }} onMouseDown={(e) => e.preventDefault()} onClick={() => load(query.trim(), items.length)} data-testid={`button-more-${id}`}>Load more ({items.length} of {total})</button>}
    </div>}
  </div>;
}
