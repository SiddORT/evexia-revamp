import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import useDirectoryContinuation from '../../hooks/useDirectoryContinuation.js';
import './searchableSelect.css';
import { openingBalanceDoctors } from '../../services/serverOpeningBalances.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../../auth/adminSession.js';

export default function OpeningBalanceDoctorSelect({ value, record, disabled, error, onChange }) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const continuation = useDirectoryContinuation({ query, offset });
  const cursor = continuation.params.cursor;
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const [selected, setSelected] = useState(record ? { id: record.doctorId, name: record.doctorName, registrationNumber: record.registrationNumber, usable: record.doctorUsable } : null);
  useEffect(() => {
    if (record) setSelected({ id: record.doctorId, name: record.doctorName,
      registrationNumber: record.registrationNumber, usable: record.doctorUsable });
  }, [record?.doctorId, record?.doctorName, record?.registrationNumber, record?.doctorUsable]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) { setSelected(null); setState({ items: [], total: 0, loading: false, error: '' }); setQuery(''); close(); }
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setState((old) => ({ ...old, items: [], loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const data = await openingBalanceDoctors({ query, offset, cursor, limit: 50, ...(record ? { balance_id: record.id } : {}) }, controller.signal);
        guard(); if (!controller.signal.aborted) setState({ ...data, loading: false, error: '' });
      } catch (cause) {
        try { guard(); } catch { return; }
        if (!controller.signal.aborted) setState({ items: [], total: 0, loading: false, error: cause.message });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, offset, record?.id, revision, cursor]);
  const rows = [...state.items];
  if (selected && !rows.some((d) => d.id === selected.id)) rows.push(selected);
  const labelOf = (d) => `${d.name} · ${d.registrationNumber}${!d.usable ? ' (saved inactive/unavailable reference)' : ''}`;
  const choices = state.items.filter((d) => d.usable || (d.id === record?.doctorId && d.id === value));
  const current = rows.find((d) => d.id === value);
  const label = current ? labelOf(current) : '';
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menuPosition, setMenuPosition] = useState({});
  const root = useRef(null);
  const input = useRef(null);
  const close = () => { setOpen(false); setActive(-1); };
  // Keep the popup inside the visible viewport without clipping it to the
  // scrolling dialog. It remains in this DOM subtree for the dialog focus trap.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const control = input.current?.closest('.searchable-select__control');
      if (!control) return;
      const box = control.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0;
      const bottom = top + (viewport?.height || window.innerHeight);
      if (box.bottom <= top || box.top >= bottom) { close(); return; }
      const below = Math.max(0, bottom - box.bottom - 12);
      const above = Math.max(0, box.top - top - 12);
      const up = below < 200 && above > below;
      setMenuPosition({
        left: box.left, width: box.width,
        // Override the shared menu's default top when anchoring upward.
        top: up ? 'auto' : box.bottom + 4,
        bottom: up ? window.innerHeight - box.top + 4 : 'auto',
        maxHeight: Math.min(260, up ? above : below),
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { if (open && active >= 0) document.getElementById(`ob-doctor-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  function choose(d) {
    if (disabled || state.loading || !d) return;
    setSelected(d); onChange(d.id); setQuery(''); setOffset(0); close(); input.current?.focus();
  }
  function keyDown(event) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); input.current?.focus(); }
    else if (event.target === input.current) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setOpen(true);
        setActive((a) => choices.length ? (event.key === 'ArrowDown' ? Math.min(a + 1, choices.length - 1) : Math.max(a - 1, 0)) : -1);
      } else if (open && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault(); setActive(choices.length ? (event.key === 'Home' ? 0 : choices.length - 1) : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!open) setOpen(true); else if (active >= 0) choose(choices[active]);
      }
    }
  }
  const prev = () => { if (disabled || state.loading || !offset) return; setActive(-1); setOffset((n) => Math.max(0, n - 50)); input.current?.focus(); };
  const canNext = !state.loading && (state.partial ? Boolean(state.nextCursor) : offset + 50 < state.total);
  const next = () => { if (disabled || !canNext) return; setActive(-1); if (state.partial) continuation.next(state); else setOffset((n) => n + 50); input.current?.focus(); };
  const status = state.loading ? 'Loading shared Doctors…' : state.error || (state.partial
    ? `${choices.length} choices in this section; matching totals are unavailable. ${state.nextCursor ? 'More records remain to be checked.' : 'No further records remain.'}`
    : !choices.length ? 'No matching active Doctors. Clear the search or page.' : `${state.total} matching active Doctors. Only unchanged saved inactive references can be retained.`);
  return <div className="mr-form__field ob-doctor" ref={root} onKeyDown={keyDown}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <label className="mr-form__label" htmlFor="opening-balance-doctor">Doctor *</label>
    <div className={`searchable-select${open ? ' searchable-select--open' : ''}`}>
      <div className="searchable-select__control">
        <input ref={input} id="opening-balance-doctor" type="text" role="combobox" aria-required="true" aria-invalid={Boolean(error)}
          disabled={disabled} aria-describedby={[value && 'ob-doctor-selection', error && 'ob-doctor-error'].filter(Boolean).join(' ') || undefined} aria-autocomplete="list" aria-haspopup="listbox"
          aria-expanded={open} aria-controls={open ? 'ob-doctor-options' : undefined}
          aria-activedescendant={open && choices[active] ? `ob-doctor-option-${active}` : undefined}
          autoComplete="off" value={open ? query : label} title={label}
          placeholder={open ? 'Search name or registration' : 'Select a Doctor'}
          data-testid="select-opening-balance-doctor" onClick={() => setOpen(true)}
          onChange={(e) => { setActive(-1); setQuery(e.target.value.slice(0, 200)); setOffset(0); setOpen(true); }} />
        {value && <button type="button" disabled={disabled} className="searchable-select__clear" aria-label="Clear doctor"
          onClick={() => { setSelected(null); onChange(''); setQuery(''); setOffset(0); setActive(-1); input.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
        <ChevronDown size={16} className="searchable-select__chevron" aria-hidden="true" onClick={() => { if (!disabled) { input.current?.focus(); setOpen(!open); } }} />
      </div>
      {open && <div className="searchable-select__menu ob-doctor__menu" style={menuPosition}>
        <div id="ob-doctor-options" role="listbox" aria-label="Doctor" aria-busy={state.loading}>
          {!state.loading && !state.error && choices.map((d, index) => <div key={d.id} id={`ob-doctor-option-${index}`} role="option" aria-selected={d.id === value}
            className={`searchable-select__option${active === index ? ' searchable-select__option--active' : ''}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(d)}><span>{labelOf(d)}</span></div>)}
        </div>
        <p className="searchable-select__empty" role={state.error ? 'alert' : 'status'}>{status}</p>
        {state.error && <button type="button" disabled={disabled} className="admin-button admin-button--secondary" onClick={() => { setActive(-1); setRevision((n) => n + 1); input.current?.focus(); }}>Retry Doctors</button>}
        {!state.error && <div className="ob-doctor__paging">
          <button type="button" className="admin-button admin-button--secondary" aria-disabled={disabled || state.loading || !offset} onClick={prev}>Previous Doctors</button>
          <button type="button" className="admin-button admin-button--secondary" aria-disabled={disabled || !canNext} onClick={next}>{state.partial ? 'Continue search' : 'Next Doctors'}</button>
        </div>}
      </div>}
    </div>
    {value && label && <p id="ob-doctor-selection" className="ob-form__hint">{label}</p>}
    {error && <p className="mr-form__error" id="ob-doctor-error" role="alert">{error}</p>}
  </div>;
}
