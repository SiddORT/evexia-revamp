import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import './searchableSelect.css';

// Allergen-only variant: remote menus own their result filtering and paging.
export default function AllergenSearchableSelect({ id, label, value, options, selectedLabel, onChange, placeholder, invalid, describedBy, disabled = false, testId, onSearch, loading = false, error = '', onRetry, onMore, remaining = 0, empty }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState({});
  const root = useRef(null);
  const trigger = useRef(null);
  const input = useRef(null);
  const selected = options.find((option) => option.value === value);
  const matches = onSearch ? options : options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const rect = root.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 230 && above > below;
      setPlacement({ top: up ? 'auto' : 'calc(100% + 4px)', bottom: up ? 'calc(100% + 4px)' : 'auto', maxHeight: Math.max(60, Math.min(300, up ? above : below)) });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  function search(text) { setQuery(text); setActive(-1); onSearch?.(text); }
  function close(focus = false) { setOpen(false); setActive(-1); if (focus) trigger.current?.focus(); }
  function choose(option) { if (disabled) return; onChange(option.value); close(true); search(''); }
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return undefined;
    input.current?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { setActive(-1); }, [options]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  function keyboard(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.target !== input.current) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (['Home', 'End'].includes(event.key) && !event.ctrlKey) return;
      event.preventDefault();
      setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1)
        : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : matches.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!loading && !error && matches.length) choose(matches[Math.max(0, active)]);
    }
  }
  return <div ref={root} className={`searchable-select admin-allergen-combobox${open ? ' searchable-select--open' : ''}`}
    onKeyDown={keyboard} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <div className="searchable-select__control">
      <button ref={trigger} id={id} type="button" role="combobox" aria-label={label} aria-expanded={open}
        aria-haspopup="listbox" aria-controls={`${id}-options`} aria-invalid={Boolean(invalid)} aria-describedby={describedBy}
        disabled={disabled} data-testid={testId} className="admin-allergen-combobox__trigger" title={selectedLabel || selected?.label}
        onClick={() => { if (open) close(); else { search(''); setOpen(true); } }}
        onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); search(''); setOpen(true); } }}>
        <span>{selectedLabel || selected?.label || placeholder}</span><ChevronDown size={16} aria-hidden="true" />
      </button>
      {value && <button type="button" disabled={disabled} className="searchable-select__clear" aria-label={`Clear ${label.toLowerCase()}`}
        onClick={() => { onChange(''); search(''); close(true); }}><X size={14} aria-hidden="true" /></button>}
    </div>
    {open && <div className="searchable-select__menu admin-allergen-combobox__menu" style={placement}>
      <input ref={input} role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-expanded="true" aria-autocomplete="list"
        aria-controls={`${id}-options`} aria-activedescendant={active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off" maxLength={200} value={query} disabled={disabled} data-testid={`${testId}-search`}
        placeholder={`Search ${label.toLowerCase()}…`} onChange={(event) => search(event.target.value)} />
      <div id={`${id}-options`} role="listbox" aria-label={label} aria-busy={loading} className="admin-allergen-combobox__options">
        {matches.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option"
          aria-selected={option.value === value} className={`searchable-select__option${active === index ? ' searchable-select__option--active' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
          <span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true" />}
        </div>)}
      </div>
      {loading ? <div className="searchable-select__empty" role="status">Loading {label.toLowerCase()}…</div>
        : error ? <div className="searchable-select__empty" role="alert">{error}<button type="button" disabled={disabled} className="admin-button admin-button--secondary" onClick={onRetry}>Retry</button></div>
        : <>{(empty ?? !matches.length) && <div className="searchable-select__empty" role="status">No matching {label.toLowerCase()}.</div>}
          {remaining > 0 && <button type="button" disabled={disabled} className="admin-button admin-button--secondary" onClick={onMore} data-testid={`${testId}-more`}>Load more ({remaining} remaining)</button>}</>}
    </div>}
  </div>;
}
