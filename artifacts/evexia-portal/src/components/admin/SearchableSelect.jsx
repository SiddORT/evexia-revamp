import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

export default function SearchableSelect({ id, label, value, options, onChange, placeholder, invalid, describedBy }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
        setActive(-1);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [active, id, open]);

  function choose(option) {
    onChange(option.value);
    setOpen(false);
    setQuery('');
    setActive(-1);
    inputRef.current?.focus();
  }

  function openMenu() {
    setOpen(true);
    setQuery('');
    setActive(-1);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      setActive(-1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); setQuery(''); setActive(-1); return; }
      setActive((index) => event.key === 'ArrowDown'
        ? Math.min(index + 1, matches.length - 1)
        : Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (matches.length) choose(matches[Math.max(active, 0)]);
    } else if (event.key === 'Tab') {
      setOpen(false);
      setQuery('');
      setActive(-1);
    }
  }

  return <div className={`searchable-select${open ? ' searchable-select--open' : ''}`} ref={rootRef}>
    <div className="searchable-select__control">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
        aria-invalid={Boolean(invalid)}
        aria-describedby={describedBy}
        autoComplete="off"
        value={open ? query : selected?.label || ''}
        placeholder={open ? `Search ${label.toLowerCase()}…` : placeholder}
        onFocus={openMenu}
        onClick={() => { if (!open) openMenu(); }}
        onChange={(event) => { setOpen(true); setQuery(event.target.value); setActive(-1); }}
        onKeyDown={handleKeyDown}
        data-testid={`select-${id}`}
      />
      {value && <button type="button" className="searchable-select__clear" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { onChange(''); setQuery(''); setActive(-1); inputRef.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
      <ChevronDown size={16} className="searchable-select__chevron" aria-hidden="true" onClick={() => { inputRef.current?.focus(); openMenu(); }} />
    </div>
    {open && <div id={`${id}-options`} role="listbox" aria-label={label} className="searchable-select__menu">
      {matches.length ? matches.map((option, index) => <div
        key={option.value}
        id={`${id}-option-${index}`}
        role="option"
        aria-selected={option.value === value}
        className={`searchable-select__option${index === active ? ' searchable-select__option--active' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >{option.label}{option.value === value && <Check size={15} aria-hidden="true" />}</div>) : <div className="searchable-select__empty" role="status">No matches found</div>}
    </div>}
  </div>;
}