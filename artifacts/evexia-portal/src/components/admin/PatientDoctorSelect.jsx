import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { patientDoctorChoices } from '../../services/serverPatients.js';
import './searchableSelect.css';

const PAGE_SIZE = 50;

export default function PatientDoctorSelect({ value, original, savedName, blocked, error, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState(null);
  const [active, setActive] = useState(-1);
  const root = useRef(null);
  const input = useRef(null);
  const request = useRef(0);
  const controllerRef = useRef(null);

  function invalidate() {
    request.current++;
    controllerRef.current?.abort();
    setActive(-1);
    setState((old) => ({ ...old, items: [], loading: true, error: '' }));
  }

  useEffect(() => {
    const current = ++request.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((old) => ({ ...old, items: [], loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const data = await patientDoctorChoices({ query, offset, limit: PAGE_SIZE, include_saved: value || undefined }, controller.signal);
        if (controller.signal.aborted || current !== request.current) return;
        const saved = data.items.find((item) => item.id === value);
        if (saved) setSelection(saved);
        setState({ ...data, loading: false, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted && current === request.current) {
          setState({ items: [], total: 0, loading: false, error: cause.message || 'Doctors could not be loaded.' });
        }
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, offset, value, revision]);

  function close() { setOpen(false); setActive(-1); }
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (blocked) close(); }, [blocked]);

  const selected = selection?.id === value ? selection : null;
  const retained = value && value === original;
  const label = !value ? '' : selected
    ? `${selected.name}${!selected.usable ? ' (inactive relationship; retained only)' : ''}`
    : retained ? `${savedName || 'Saved Doctor'} — unavailable; unchanged reference retained`
      : 'Doctor unavailable — choose another';
  const choices = state.items.filter((item) => item.usable || (item.id === original && item.id === value));
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`patient-doctorId-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(item) {
    if (blocked || state.loading || !item?.usable) return;
    setSelection(item);
    onChange(item.id);
    close();
    input.current?.focus();
  }
  function pageTo(next) {
    if (state.loading) return;
    invalidate();
    setOffset(next);
    input.current?.focus();
  }
  function keyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); close(); input.current?.focus();
    } else if (event.target === input.current) {
      const eligible = choices.map((item, index) => item.usable ? index : -1).filter((index) => index >= 0);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setOpen(true);
        const position = eligible.indexOf(active);
        setActive(eligible[event.key === 'ArrowDown' ? Math.min(position + 1, eligible.length - 1) : Math.max(position - 1, 0)] ?? -1);
      } else if (open && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault(); setActive(eligible[event.key === 'Home' ? 0 : eligible.length - 1] ?? -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!open) setOpen(true);
        else if (active >= 0) choose(choices[active]);
      }
    }
  }

  return <div className="mr-form__field patient-doctor" ref={root} onKeyDown={keyDown}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <label className="mr-form__label" htmlFor="patient-doctorId">Assigned doctor <span className="mr-form__required" aria-hidden="true">*</span></label>
    <div className={`searchable-select${open ? ' searchable-select--open' : ''}`}>
      <div className="searchable-select__control">
        <input ref={input} id="patient-doctorId" name="doctorId" type="text" role="combobox"
          required aria-required="true" aria-invalid={Boolean(error)} disabled={blocked}
          aria-describedby={`patient-doctor-help${value ? ' patient-doctor-selection' : ''}${error ? ' patient-doctorId-error' : ''}`}
          aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
          aria-controls={open ? 'patient-doctorId-options' : undefined}
          aria-activedescendant={open && choices[active] ? `patient-doctorId-option-${active}` : undefined}
          autoComplete="off" value={open ? query : label} title={label}
          placeholder={open ? 'Search Doctors…' : 'Select a Doctor'}
          onClick={() => setOpen(true)}
          onChange={(event) => { invalidate(); setQuery(event.target.value); setOffset(0); setOpen(true); }}
          data-testid="select-patient-doctorId" />
        <ChevronDown size={16} className="searchable-select__chevron" aria-hidden="true"
          onClick={() => { if (!blocked) { input.current?.focus(); setOpen(!open); } }} />
      </div>
      {open && <div className="searchable-select__menu patient-doctor__menu">
        <div id="patient-doctorId-options" role="listbox" aria-label="Assigned doctor" aria-busy={state.loading}>
          {!state.loading && !state.error && choices.map((item, index) => <div key={item.id} id={`patient-doctorId-option-${index}`}
            role="option" aria-selected={item.id === value} aria-disabled={!item.usable}
            className={`searchable-select__option${active === index ? ' searchable-select__option--active' : ''}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
            <span>{item.name}{!item.usable ? ' (inactive relationship; retained only)' : ''}
              <small>MR: {item.mrName || 'Missing'} · Zone: {item.zoneName || 'Missing'}</small></span>
          </div>)}
        </div>
        <p className="searchable-select__empty" role="status">
          {state.loading ? 'Loading Doctors…' : state.error || (!choices.length
            ? 'No matching eligible Doctors. Clear the search, or check active Doctor, MR and Zone records.'
            : `${state.total} matching Doctors`)}
        </p>
        {state.error && <button type="button" className="admin-button admin-button--secondary"
          onClick={() => { invalidate(); setRevision((n) => n + 1); input.current?.focus(); }}>Retry Doctors</button>}
        {!state.error && <div className="patient-doctor__paging">
          <button type="button" className="admin-button admin-button--secondary" aria-disabled={!offset || state.loading}
            onClick={() => { if (offset) pageTo(Math.max(0, offset - PAGE_SIZE)); }}>Previous Doctors</button>
          <button type="button" className="admin-button admin-button--secondary" aria-disabled={offset + PAGE_SIZE >= state.total || state.loading}
            onClick={() => { if (offset + PAGE_SIZE < state.total) pageTo(offset + PAGE_SIZE); }}>Next Doctors</button>
        </div>}
      </div>}
    </div>
    {value && <p className="mr-form__hint" id="patient-doctor-selection">Doctor: {label}</p>}
    <p className="mr-form__hint" id="patient-doctor-help">{selected
      ? `MR: ${selected.mrName || 'Missing'} · Zone: ${selected.zoneName || 'Missing'}`
      : retained ? 'The saved assignment is retained unchanged. Search to choose an eligible replacement.'
        : 'Search server Doctors and select an active Doctor, MR and Zone relationship.'}</p>
    {error && <p className="mr-form__error" id="patient-doctorId-error" role="alert" data-testid="error-patient-doctorId">{error}</p>}
  </div>;
}
