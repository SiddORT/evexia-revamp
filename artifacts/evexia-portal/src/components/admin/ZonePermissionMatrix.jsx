import { Check, Minus } from 'lucide-react';
import { ZONE_PERMISSIONS, ZONE_KEYS } from '../../auth/capabilities.js';

export const countLabel = (n) => `${n} permission${n === 1 ? '' : 's'}`;

// Masters > Zone grants. All/None are selection shortcuts only; the saved
// payload is always the explicit list of the five keys.
export default function ZonePermissionMatrix({ selected, saved, disabled, busy, dirty, onToggle, onAll, onNone, onSave, onCancel, children }) {
  const all = ZONE_KEYS.every((key) => selected.includes(key));
  const none = selected.length === 0;
  const locked = disabled || busy;
  return <section className="rp-matrix" aria-labelledby="rp-matrix-title" data-testid="panel-zone-permissions">
    <header className="rp-matrix__head">
      <div><p className="rp-matrix__eyebrow">Masters</p><h3 id="rp-matrix-title">Zone</h3></div>
      <div className="rp-matrix__counts" aria-live="polite">
        <span data-testid="text-saved-permission-count"><strong>{saved.length}</strong> of {ZONE_KEYS.length} saved</span>
        {dirty && <span className="rp-matrix__pending" data-testid="text-draft-permission-count"><strong>{selected.length}</strong> of {ZONE_KEYS.length} selected, not saved</span>}
      </div>
    </header>
    <div className="rp-matrix__shortcuts" role="group" aria-label="Selection shortcuts">
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || all} onClick={onAll} data-testid="button-permissions-all"><Check size={14} aria-hidden="true" /> All</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || none} onClick={onNone} data-testid="button-permissions-none"><Minus size={14} aria-hidden="true" /> None</button>
    </div>
    <fieldset className="rp-matrix__grid" disabled={locked}>
      <legend className="sr-only">Zone permissions</legend>
      {ZONE_PERMISSIONS.map(({ key, label, hint }) => <label key={key} className={`rp-check${selected.includes(key) ? ' rp-check--on' : ''}`}>
        <input type="checkbox" checked={selected.includes(key)} onChange={() => onToggle(key)} data-testid={`checkbox-permission-${key}`} />
        <span className="rp-check__box" aria-hidden="true"><Check size={13} /></span>
        <span className="rp-check__text"><strong>{label}</strong><small>{hint}</small></span>
        {saved.includes(key) && <em className="rp-check__saved">Saved</em>}
      </label>)}
    </fieldset>
    <p className="rp-matrix__note">Any one grant lets staff view active zones. Import works without Add, and no grant includes trash or restore.</p>
    {children}
    <footer className="rp-matrix__foot">
      <button type="button" className="admin-button admin-button--secondary" disabled={!dirty || busy} onClick={onCancel} data-testid="button-cancel-permissions">Cancel</button>
      <button type="button" className="admin-button" disabled={!dirty || locked} onClick={onSave} data-testid="button-save-permissions">{busy ? 'Saving...' : 'Save permissions'}</button>
    </footer>
  </section>;
}
