import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Search } from 'lucide-react';
import { MASTER_CATALOGUE, MASTER_PERMISSIONS, MASTER_KEYS as ZONE_KEYS } from '../../auth/capabilities.js';
import InfoDisclosure from './InfoDisclosure.jsx';

export const countLabel = (n) => `${n} permission${n === 1 ? '' : 's'}`;

function GroupCheckbox({ selected, locked, label, onAll, onNone, testId, keys = ZONE_KEYS }) {
  const ref = useRef(null);
  const all = keys.every((key) => selected.includes(key));
  const partial = !all && keys.some((key) => selected.includes(key));
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" aria-label={label} aria-checked={partial ? 'mixed' : all}
    checked={all} disabled={locked} onChange={all ? onNone : onAll} data-testid={testId} />;
}

// Preserve the historical component and selectors for layout coverage.
// Shortcuts select explicit catalogue keys, never implicit broad authority.
export default function ZonePermissionMatrix({ selected, saved, disabled, busy, dirty, onToggle, onSelect, onAll, onNone, onSave, onCancel, children }) {
  const [query, setQuery] = useState('');
  const all = ZONE_KEYS.every((key) => selected.includes(key));
  const none = selected.length === 0;
  const locked = disabled || busy;
  const groups = MASTER_CATALOGUE.map((master) => ({
    ...master,
    keys: ZONE_KEYS.filter((key) => key.startsWith(`${master.key}.`)),
    visible: MASTER_PERMISSIONS.filter((item) => item.master === master.key &&
      `Masters ${master.label} ${item.label} ${item.hint}`.toLowerCase().includes(query.trim().toLowerCase())),
  }));
  const selectGroup = (keys, enabled) => onSelect(ZONE_KEYS.filter((key) =>
    keys.includes(key) ? enabled : selected.includes(key)));
  return <section className="rp-matrix" aria-labelledby="rp-matrix-title" data-testid="panel-zone-permissions">
    <header className="rp-matrix__head">
      <div><p className="rp-matrix__eyebrow">Permission workspace</p><h3 id="rp-matrix-title">Masters</h3></div>
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
    {groups.every((group) => group.visible.length === 0) && <div className="admin-empty" role="status" data-testid="status-permissions-no-results"><strong>No matching permissions</strong><p>Try another search. Your selections are unchanged.</p></div>}
    {groups.map((group) => <section key={group.key}>
        <header className="rp-main__head">
          <GroupCheckbox selected={selected} keys={group.keys} locked={locked} label={`Select all ${group.label} permissions`}
            onAll={() => selectGroup(group.keys, true)} onNone={() => selectGroup(group.keys, false)} testId={`checkbox-${group.key}-permissions`} />
          <h4 id={`rp-${group.key}-title`} tabIndex={-1}>{group.label}</h4><span>{group.keys.filter((key) => selected.includes(key)).length}/{group.keys.length}</span>
        </header>
    <fieldset className="rp-matrix__grid">
      <legend className="sr-only">{group.label} permissions</legend>
      {group.visible.map(({ key, label, hint }) => <div key={key}
        className={`rp-action${selected.includes(key) ? ' rp-action--on' : ''}${locked ? ' rp-action--locked' : ''}`}>
        <label className="rp-check">
          <input type="checkbox" aria-label={`${group.label} ${label}`} disabled={locked}
            aria-describedby={saved.includes(key) ? `rp-saved-${key}` : undefined}
            checked={selected.includes(key)} onChange={() => onToggle(key)} data-testid={`checkbox-permission-${key}`} />
          <span className="rp-check__box" aria-hidden="true"><Check size={13} /></span>
          <span className="rp-check__text"><strong>{label}</strong></span>
          {saved.includes(key) && <span className="rp-check__saved" title="Saved">
            <span className="sr-only" id={`rp-saved-${key}`}>Saved permission</span>
          </span>}
        </label>
        <InfoDisclosure id={`rp-help-${key}`} title={`${group.label} ${label}`} text={hint} testId={`button-permission-help-${key}`} />
      </div>)}
    </fieldset>
    </section>)}
      </div>
    </div>
    <p className="rp-matrix__note">A dot marks a saved permission. Any one grant permits live, non-deleted list and detail access for that master. Import works without Add. No grant includes trash, restore, password reset or private history. Group selection includes hidden actions; All and Clear apply to all 40 permissions.</p>
    {children}
    <footer className="rp-matrix__foot">
      <button type="button" className="admin-button admin-button--secondary" disabled={!dirty || busy} onClick={onCancel} data-testid="button-cancel-permissions">Cancel</button>
      <button type="button" className="admin-button" disabled={!dirty || locked} onClick={onSave} data-testid="button-save-permissions">{busy ? 'Saving...' : 'Save permissions'}</button>
    </footer>
  </section>;
}
