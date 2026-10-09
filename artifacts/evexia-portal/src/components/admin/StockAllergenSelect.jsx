import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import './searchableSelect.css';

// Stock-only multi-selection: do not change master-directory selector contracts.
export default function StockAllergenSelect({ options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const root = useRef(null);
  const input = useRef(null);
  const matches = options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const close = () => { setOpen(false); setQuery(''); setActive(-1); };
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`stock-allergen-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  function toggle(option) {
    onChange(values.includes(option.value) ? values.filter((value) => value !== option.value) : [...values, option.value]);
  }
  function keyboard(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (matches.length) toggle(matches[Math.max(0, active)]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  }
  return <div className="stock-allergens" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation(); close(); input.current?.focus();
    }
  }}>
    <div className={`searchable-select${open ? ' searchable-select--open' : ''}`}>
      <div className="searchable-select__control">
        <input ref={input} id="stock-product" role="combobox" aria-label="Allergens"
          aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
          aria-controls="stock-allergen-options" aria-describedby="stock-allergen-summary"
          aria-activedescendant={open && matches[active] ? `stock-allergen-option-${active}` : undefined}
          autoComplete="off" value={query} placeholder={values.length ? `${values.length} selected — search allergens` : 'All allergens — search to select'}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }} onKeyDown={keyboard} />
        <ChevronDown size={16} className="searchable-select__chevron" aria-hidden="true" onClick={() => { input.current?.focus(); setOpen(true); }} />
      </div>
      {open && <div id="stock-allergen-options" role="listbox" aria-label="Allergens" aria-multiselectable="true" className="searchable-select__menu">
        {matches.length ? matches.map((option, index) => <div key={option.value} id={`stock-allergen-option-${index}`}
          role="option" aria-selected={values.includes(option.value)}
          className={`searchable-select__option${active === index ? ' searchable-select__option--active' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => { toggle(option); input.current?.focus(); }}>
          <span>{option.label}</span>{values.includes(option.value) && <Check size={15} aria-hidden="true" />}
        </div>) : <div className="searchable-select__empty" role="status">No allergens match this search</div>}
      </div>}
    </div>
    <div id="stock-allergen-summary" className="stock-selection-summary" aria-live="polite">{values.length ? `${values.length} allergens selected` : 'All allergens'}</div>
    {values.length > 0 && <div className="stock-selected">
      {options.filter((option) => values.includes(option.value)).map((option) => <button key={option.value}
        type="button" className="stock-selection-chip" aria-label={`Remove ${option.label}`} onClick={() => toggle(option)}>
        <span>{option.label}</span><X size={13} aria-hidden="true" /></button>)}
      <button type="button" className="stock-clear-all" onClick={() => onChange([])}>Clear all allergens</button>
    </div>}
  </div>;
}
