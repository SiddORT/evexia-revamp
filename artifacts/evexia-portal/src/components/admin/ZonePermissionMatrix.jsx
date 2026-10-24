import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Search } from 'lucide-react';
import { PERMISSION_MODULES, ACTION_LABELS, ASSIGNABLE_KEYS as ZONE_KEYS } from '../../auth/capabilities.js';
import InfoDisclosure from './InfoDisclosure.jsx';

export const countLabel = (n) => `${n} permission${n === 1 ? '' : 's'}`;

function GroupCheckbox({ selected, locked, label, onAll, onNone, testId, keys = ZONE_KEYS }) {
  const ref = useRef(null);
  const all = keys.every((key) => selected.includes(key));
  const partial = !all && keys.some((key) => selected.includes(key));
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" className="rp-cell-check" aria-label={label} aria-checked={partial ? 'mixed' : all}
    checked={all} disabled={locked} onChange={all ? onNone : onAll} data-testid={testId} />;
}

// Shortcuts select explicit catalogue keys, never implicit broad authority.
export default function ZonePermissionMatrix({ roleName, selected, saved, disabled, busy, dirty, onToggle, onSelect, onAll, onNone, onSave, onCancel, children }) {
  const [query, setQuery] = useState('');
  const [moduleKey, setModuleKey] = useState('masters');
  const all = ZONE_KEYS.every((key) => selected.includes(key));
  const none = selected.length === 0;
  const locked = disabled || busy;
  const needle = query.trim().toLowerCase();
  const activeModule = PERMISSION_MODULES.find((item) => item.key === moduleKey);
  const columns = [...new Set(activeModule.resources.flatMap((resource) => resource.actions))];
  const groups = activeModule.resources.map((master) => {
    const items = master.actions.map((action) => ({
      key: `${master.key}.${action}`, action, label: master.labels?.[action] || ACTION_LABELS[action],
      hint: `${master.labels?.[action] || ACTION_LABELS[action]} for ${master.label}. This grants no unsupported or Super Admin-only operations.`,
    }));
    return {
      ...master,
      keys: ZONE_KEYS.filter((key) => key.startsWith(`${master.key}.`)),
      items,
      shown: new Set(items.filter((item) => `${activeModule.label} ${master.label} ${item.label} ${item.hint}`.toLowerCase().includes(needle)).map((item) => item.key)),
    };
  });
  const rows = groups.filter((group) => group.shown.size > 0);
  const selectGroup = (keys, enabled) => onSelect(ZONE_KEYS.filter((key) =>
    keys.includes(key) ? enabled : selected.includes(key)));
  return <section className="rp-matrix" aria-labelledby="rp-matrix-title" data-testid="panel-zone-permissions">
    <header className="rp-matrix__head">
      <div className="rp-matrix__title">
        <h2 id="rp-matrix-title" data-testid="text-active-permission-role">{roleName}</h2>
        <div className="rp-matrix__counts" aria-live="polite">
          <span data-testid="text-selected-permission-count"><strong>{selected.length}</strong> of {ZONE_KEYS.length} selected</span>
          <span data-testid="text-saved-permission-count"><strong>{saved.length}</strong> of {ZONE_KEYS.length} saved</span>
          {dirty && <span className="rp-matrix__pending" data-testid="text-draft-permission-count"><strong>{selected.length}</strong> of {ZONE_KEYS.length} selected, not saved</span>}
        </div>
      </div>
      <div className="rp-matrix__shortcuts" role="group" aria-label="Selection shortcuts and save">
        <button type="button" className="admin-button admin-button--secondary" disabled={locked || none} onClick={onNone} data-testid="button-permissions-none"><Minus size={14} aria-hidden="true" /> Clear</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={locked || all} onClick={onAll} data-testid="button-permissions-all"><Check size={14} aria-hidden="true" /> All</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={!dirty || busy} onClick={onCancel} data-testid="button-cancel-permissions">Cancel</button>
        <button type="button" className="admin-button" disabled={!dirty || locked} onClick={onSave} data-testid="button-save-permissions">{busy ? 'Saving...' : 'Save permissions'}</button>
      </div>
    </header>
    <progress className="rp-progress" value={selected.length} max={ZONE_KEYS.length} aria-label="Selected permissions" />
    {children}
    <label className="rp-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search permissions</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search permissions..." data-testid="input-search-permissions" /></label>
    <div className="rp-body">
      <nav className="rp-rail" aria-label="Permission modules">
        {PERMISSION_MODULES.map((module) => {
          const keys = module.resources.flatMap((resource) => resource.actions.map((action) => `${resource.key}.${action}`));
          return <div key={module.key} className={`rp-rail__item${moduleKey === module.key ? ' rp-rail__item--active' : ''}`}>
            <GroupCheckbox selected={selected} keys={keys} locked={locked} label={`Select all ${module.label} permissions`}
              onAll={() => selectGroup(keys, true)} onNone={() => selectGroup(keys, false)} testId={`checkbox-${module.key}-permissions`} />
            <button type="button" aria-current={moduleKey === module.key ? 'true' : undefined} className="rp-rail__label"
              onClick={() => setModuleKey(module.key)}>{module.label} <span>{keys.filter((key) => selected.includes(key)).length}/{keys.length}</span></button>
          </div>;
        })}
      </nav>
      <div className="rp-main">
        {rows.length === 0 && <div className="admin-empty" role="status" data-testid="status-permissions-no-results"><strong>No matching permissions</strong><p>Try another search. Your selections are unchanged.</p></div>}
        {rows.length > 0 && <div className="rp-table-scroll" role="region" aria-label={`${activeModule.label} permission matrix`} tabIndex={0}>
          <table className="rp-table">
            <caption className="sr-only">{activeModule.label} permissions by supported action</caption>
            <thead>
              <tr>
                <th scope="col" className="rp-table__master">Submodule</th>
                {columns.map((action) => <th scope="col" key={action} className="rp-table__action">{ACTION_LABELS[action]}</th>)}
                {activeModule.resources.some((resource) => resource.protected) && <th scope="col">Super Admin only</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((group) => {
                const count = group.keys.filter((key) => selected.includes(key)).length;
                return <tr key={group.key}>
                  <th scope="row" className="rp-table__master">
                    <span className="rp-table__mastercell">
                      <GroupCheckbox selected={selected} keys={group.keys} locked={locked} label={`Select all ${group.label} permissions`}
                        onAll={() => selectGroup(group.keys, true)} onNone={() => selectGroup(group.keys, false)} testId={`checkbox-${group.key}-permissions`} />
                      <span id={`rp-${group.key}-title`}>{group.label}</span>
                      <span className="rp-table__count">{count}/{group.keys.length}</span>
                    </span>
                  </th>
                  {columns.map((action) => {
                    const item = group.items.find((entry) => entry.action === action);
                    if (!item) return <td key={action} className="rp-table__cell rp-table__cell--empty"><span aria-label="Not supported">—</span></td>;
                    const { key, label, hint } = item;
                    return group.shown.has(key)
                    ? <td key={key} className={`rp-table__cell${selected.includes(key) ? ' rp-table__cell--on' : ''}${locked ? ' rp-table__cell--locked' : ''}`}>
                      <div className="rp-cell">
                        <label className="rp-check">
                          <input type="checkbox" aria-label={`${group.label} ${label}`} disabled={locked}
                            aria-describedby={saved.includes(key) ? `rp-saved-${key}` : undefined}
                            checked={selected.includes(key)} onChange={() => onToggle(key)} data-testid={`checkbox-permission-${key}`} />
                          <span className="rp-check__box" aria-hidden="true"><Check size={13} /></span>
                          {saved.includes(key) && <span className="rp-check__saved" title="Saved">
                            <span className="sr-only" id={`rp-saved-${key}`}>Saved permission</span>
                          </span>}
                        </label>
                        <InfoDisclosure id={`rp-help-${key}`} title={`${group.label} ${label}`} text={hint} testId={`button-permission-help-${key}`} />
                      </div>
                    </td>
                    : <td key={key} className="rp-table__cell rp-table__cell--empty" />;
                  })}
                  {activeModule.resources.some((resource) => resource.protected) && <td>{group.protected?.join('; ') || '—'}</td>}
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
    <p className="rp-matrix__note">A dot marks a saved permission. Existing Master action grants retain minimum live list/detail access; View alone grants no mutation or transfer. Unsupported cells are unavailable. Assembly, stock adjustments, trash, restore, password reset and private clinical/payment history are not assignable. Group selection includes hidden actions; All and Clear apply to all {ZONE_KEYS.length} supported permissions. Assign Role, Enable/Disable Login and Change Role Permissions remain Super Admin-only.</p>
  </section>;
}
