import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Search } from 'lucide-react';
import { ZONE_PERMISSIONS, ZONE_KEYS } from '../../auth/capabilities.js';

export const countLabel = (n) => `${n} permission${n === 1 ? '' : 's'}`;

function GroupCheckbox({ selected, locked, label, onAll, onNone, testId }) {
  const ref = useRef(null);
  const all = ZONE_KEYS.every((key) => selected.includes(key));
  const partial = !all && ZONE_KEYS.some((key) => selected.includes(key));
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" aria-label={label} aria-checked={partial ? 'mixed' : all}
    checked={all} disabled={locked} onChange={all ? onNone : onAll} data-testid={testId} />;
}

// Masters > Zone grants. All/None are selection shortcuts only; the saved
// payload is always the explicit list of the five keys.
export default function ZonePermissionMatrix({ selected, saved, disabled, busy, dirty, onToggle, onAll, onNone, onSave, onCancel, children }) {
  const [query, setQuery] = useState('');
  const all = ZONE_KEYS.every((key) => selected.includes(key));
  const none = selected.length === 0;
  const locked = disabled || busy;
  const visible = ZONE_PERMISSIONS.filter(({ label, hint }) => `Masters Zone ${label} ${hint}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="rp-matrix" aria-labelledby="rp-matrix-title" data-testid="panel-zone-permissions">
    <header className="rp-matrix__head">
      <div><p className="rp-matrix__eyebrow">Permission workspace</p><h3 id="rp-matrix-title">Masters &gt; Zone</h3></div>
      <div className="rp-matrix__counts" aria-live="polite">
        <span data-testid="text-selected-permission-count"><strong>{selected.length}</strong> of {ZONE_KEYS.length} selected</span>
        <span data-testid="text-saved-permission-count"><strong>{saved.length}</strong> of {ZONE_KEYS.length} saved</span>
        {dirty && <span className="rp-matrix__pending" data-testid="text-draft-permission-count"><strong>{selected.length}</strong> of {ZONE_KEYS.length} selected, not saved</span>}
      </div>
    </header>
    <progress className="rp-progress" value={selected.length} max={ZONE_KEYS.length} aria-label="Selected permissions" />
    <div className="rp-matrix__shortcuts" role="group" aria-label="Selection shortcuts">
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || all} onClick={onAll} data-testid="button-permissions-all"><Check size={14} aria-hidden="true" /> All</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || none} onClick={onNone} data-testid="button-permissions-none"><Minus size={14} aria-hidden="true" /> Clear</button>
    </div>
    <label className="rp-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search permissions</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search permissions..." data-testid="input-search-permissions" /></label>
    <div className="rp-body">
      <nav className="rp-rail" aria-label="Permission modules">
        <div className="rp-rail__item rp-rail__item--active">
          <GroupCheckbox selected={selected} locked={locked} label="Select all Masters permissions" onAll={onAll} onNone={onNone} testId="checkbox-masters-permissions" />
          <button type="button" aria-current="true" onClick={() => document.getElementById('rp-zone-title')?.focus()}>Masters <span>{selected.length}/{ZONE_KEYS.length}</span></button>
        </div>
      </nav>
      <div className="rp-main">
        <header className="rp-main__head">
          <GroupCheckbox selected={selected} locked={locked} label="Select all Zone permissions" onAll={onAll} onNone={onNone} testId="checkbox-zone-permissions" />
          <h4 id="rp-zone-title" tabIndex={-1}>Zone</h4><span>{selected.length}/{ZONE_KEYS.length}</span>
        </header>
    {visible.length === 0 && <div className="admin-empty" role="status" data-testid="status-permissions-no-results"><strong>No matching permissions</strong><p>Try another search. Your selections are unchanged.</p></div>}
    <fieldset className="rp-matrix__grid" disabled={locked}>
      <legend className="sr-only">Zone permissions</legend>
      {visible.map(({ key, label, hint }) => <label key={key} className={`rp-check${selected.includes(key) ? ' rp-check--on' : ''}`}>
        <input type="checkbox" checked={selected.includes(key)} onChange={() => onToggle(key)} data-testid={`checkbox-permission-${key}`} />
        <span className="rp-check__box" aria-hidden="true"><Check size={13} /></span>
        <span className="rp-check__text"><strong>{label}</strong><small>{hint}</small></span>
        {saved.includes(key) && <em className="rp-check__saved">Saved</em>}
      </label>)}
    </fieldset>
      </div>
    </div>
    <p className="rp-matrix__note">Any one grant lets staff view active zones. Import works without Add, and no grant includes trash or restore.</p>
    {children}
    <footer className="rp-matrix__foot">
      <button type="button" className="admin-button admin-button--secondary" disabled={!dirty || busy} onClick={onCancel} data-testid="button-cancel-permissions">Cancel</button>
      <button type="button" className="admin-button" disabled={!dirty || locked} onClick={onSave} data-testid="button-save-permissions">{busy ? 'Saving...' : 'Save permissions'}</button>
    </footer>
  </section>;
}
