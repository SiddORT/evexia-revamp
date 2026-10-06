import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, ShieldCheck, Square } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { ACTIONS, MODULES, ALL_PERMISSION_KEYS, permissionKeys, selectionSummary, togglePermissions, createDemoRoles, validateRoleName } from '../../services/rolePermissions.js';
import '../../roles-permissions.css';

function Tri({ keys, selected, label, onToggle, testId, disabled }) {
  const ref = useRef(null);
  const s = selectionSummary(selected, keys);
  useEffect(() => { if (ref.current) ref.current.indeterminate = Boolean(s.mixed) && !s.checked; }, [s.mixed, s.checked]);
  return <input ref={ref} type="checkbox" className="rp-check" checked={Boolean(s.checked)} disabled={disabled || !keys.length} aria-label={label} aria-checked={s.mixed && !s.checked ? 'mixed' : undefined} onChange={onToggle} data-testid={testId} />;
}

function AddRoleDialog({ roles, onAdd, onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const problem = validateRoleName(name, roles);
    if (problem) { setError(problem); document.getElementById('rp-role-name')?.focus(); return; }
    onAdd(name.trim(), description.trim());
  }
  return <Dialog title="Add role" eyebrow="Roles & Permissions" description="Preview only. The new role exists in this page's memory and starts with no permissions." onClose={onClose}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-role">Cancel</button><button type="submit" form="rp-add-form" className="admin-button" data-testid="button-create-role">Create role</button></>}>
    <form id="rp-add-form" className="rp-form" onSubmit={submit} noValidate>
      <label htmlFor="rp-role-name">Role name</label>
      <input id="rp-role-name" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} aria-required="true" aria-invalid={Boolean(error)} aria-describedby={error ? 'rp-role-error' : undefined} autoComplete="off" data-testid="input-role-name" />
      {error && <span id="rp-role-error" className="rp-form__error" role="alert" data-testid="text-role-error">{error}</span>}
      <label htmlFor="rp-role-description">Description (optional)</label>
      <textarea id="rp-role-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-role-description" />
    </form>
  </Dialog>;
}

export default function RolesPermissions() {
  useAdminPreferences();
  const [roles, setRoles] = useState(() => createDemoRoles());
  const [roleId, setRoleId] = useState(() => roles[0]?.id);
  const [moduleId, setModuleId] = useState('masters');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState('');
  const role = roles.find((r) => r.id === roleId) || roles[0];
  const mod = MODULES.find((m) => m.id === moduleId) || MODULES[0];
  const selected = role?.permissions || [];
  const total = ALL_PERMISSION_KEYS.length;
  const dirty = role ? [...selected].sort().join('|') !== [...role.savedPermissions].sort().join('|') : false;
  const query = search.trim().toLocaleLowerCase();
  const rows = useMemo(() => {
    if (!query) return mod.rows;
    const modHit = mod.label.toLocaleLowerCase().includes(query);
    return mod.rows.filter((row) => modHit || row.label.toLocaleLowerCase().includes(query) || ACTIONS.some((a) => row.actions.includes(a.id) && a.label.toLocaleLowerCase().includes(query)));
  }, [mod, query]);
  const modKeys = permissionKeys(mod.rows);
  const modSum = selectionSummary(selected, modKeys);
  const pct = total ? (selected.length / total) * 100 : 0;

  function setPerms(next) { setFeedback(''); setRoles((all) => all.map((r) => r.id === role.id ? { ...r, permissions: next } : r)); }
  const toggle = (keys) => setPerms(togglePermissions(selected, keys));
  function save() {
    setRoles((all) => all.map((r) => r.id === role.id ? { ...r, savedPermissions: [...r.permissions] } : r));
    setFeedback(`Saved a snapshot of ${role.name} in page memory only. This is a preview: nothing is stored or enforced, and a reload resets it.`);
  }
  function addRole(name, description) {
    const id = `demo-role-${Date.now()}-${roles.length}`;
    setRoles((all) => [...all, { id, name, description: description || 'UI-only demo role with no initial permissions.', permissions: [], savedPermissions: [] }]);
    setRoleId(id); setFeedback(''); setAdding(false);
  }
  if (!role) return null;

  return <AdminLayout title="Roles & Permissions">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Access preview</p><h1>Roles & Permissions</h1><p className="admin-page-head__description">A UI-only experiment. Changes live in this page's memory, are not saved anywhere, and do not control access.</p></div></div>
    <p className="admin-preview-notice" role="note">These are UI-only demo roles. They do not grant access or change staff accounts. Roles, drafts and saved preview snapshots reset on page reload or when you leave this page.</p>
    <div className="rp">
      <aside className="admin-panel rp-roles" aria-label="Roles">
        <h2 className="rp-roles__title">Roles <span data-testid="text-role-count">{roles.length}</span></h2>
        <ul className="rp-roles__list">
          {roles.map((r) => <li key={r.id}><button type="button" className={`rp-role${r.id === role.id ? ' rp-role--active' : ''}`} aria-pressed={r.id === role.id} onClick={() => { setRoleId(r.id); setFeedback(''); }} data-testid={`button-role-${r.id}`}>
            <strong>{r.name}</strong><span className="rp-role__description">{r.description}</span><small>{r.permissions.length} of {total} permissions</small></button></li>)}
        </ul>
        <button type="button" className="rp-add" onClick={() => setAdding(true)} data-testid="button-add-role"><Plus size={15} aria-hidden="true" /> Add role</button>
      </aside>

      <section className="admin-panel rp-work" aria-label={`Permissions for ${role.name}`}>
        <div className="rp-head">
          <div className="rp-head__main">
            <h2 data-testid="text-active-role">{role.name}</h2>
            <div className="rp-progress" role="progressbar" aria-label={`${role.name} permissions granted`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={selected.length}><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
            <span className="rp-head__count" data-testid="text-permission-count">{selected.length}/{total}</span>
          </div>
          <div className="rp-head__actions">
            <span className={`rp-state${dirty ? ' rp-state--dirty' : ''}`} data-testid="status-dirty">{dirty ? 'Unsaved changes' : 'Saved snapshot'}</span>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => setPerms([])} aria-label={`Clear all permissions for ${role.name}, every module`} data-testid="button-clear-role"><Square size={14} aria-hidden="true" /> Clear all</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => setPerms([...ALL_PERMISSION_KEYS])} aria-label={`Grant all permissions to ${role.name}, every module`} data-testid="button-all-role"><Check size={14} aria-hidden="true" /> Grant all</button>
             <button type="button" className="admin-button" onClick={save} data-testid="button-save-role"><ShieldCheck size={14} aria-hidden="true" /> Save preview</button>
          </div>
        </div>
        {feedback && <div className="admin-feedback rp-feedback" role="status" data-testid="status-save">{feedback}</div>}
        <label className="admin-search rp-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search permissions in {mod.label}</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${mod.label} permissions`} data-testid="input-search-permissions" /></label>
        <div className="rp-body">
          <nav className="rp-rail" aria-label="Permission modules">
            {MODULES.map((m) => {
              const keys = permissionKeys(m.rows);
              const sum = selectionSummary(selected, keys);
              return <div key={m.id} className={`rp-rail__item${m.id === mod.id ? ' rp-rail__item--active' : ''}`}>
                <Tri keys={keys} selected={selected} label={`${m.label} module: all ${keys.length} permissions, entire module`} onToggle={() => toggle(keys)} testId={`checkbox-module-${m.id}`} />
                <button type="button" aria-current={m.id === mod.id ? 'true' : undefined} onClick={() => setModuleId(m.id)} data-testid={`button-module-${m.id}`}><span>{m.label}</span><em>{sum.count}/{sum.total}</em>
                  <i className="rp-mini"><b style={{ transform: `scaleX(${sum.total ? sum.count / sum.total : 0})` }} /></i></button>
              </div>;
            })}
          </nav>
          <div className="rp-main">
            <div className="rp-main__head">
              <Tri keys={modKeys} selected={selected} label={`${mod.label} module: all permissions, entire module (ignores search)`} onToggle={() => toggle(modKeys)} testId="checkbox-module-current" />
              <h3>{mod.label}</h3>
              <span className="rp-pill" data-testid="text-module-count">{modSum.count}/{modSum.total}</span>
            </div>
            {rows.length === 0 ? <div className="admin-empty" role="status" data-testid="status-no-rows"><strong>No matching permissions</strong><p>Nothing in {mod.label} matches "{search.trim()}". Selections are unchanged.</p></div> :
              <div className="admin-table-scroll rp-scroll" tabIndex={0} role="region" aria-label={`${mod.label} permission matrix, scrollable`}>
                <table className="rp-table">
                  <caption className="sr-only">{mod.label} permissions for {role.name}. Row and column checkboxes affect displayed rows only.</caption>
                  <thead><tr><th scope="col">Permission</th>{ACTIONS.map((a) => {
                    const keys = permissionKeys(rows, a.id);
                    return <th scope="col" key={a.id} className={`rp-col rp-col--${a.id}`}>
                      <Tri keys={keys} selected={selected} label={`${a.label} column: ${keys.length} displayed rows in ${mod.label}`} onToggle={() => toggle(keys)} testId={`checkbox-column-${a.id}`} /><span>{a.label}</span></th>;
                  })}</tr></thead>
                  <tbody>{rows.map((row) => {
                    const keys = permissionKeys([row]);
                    return <tr key={row.id}>
                      <th scope="row"><label className="rp-rowlabel"><Tri keys={keys} selected={selected} label={`${row.label} row: all supported actions, displayed row only`} onToggle={() => toggle(keys)} testId={`checkbox-row-${row.id}`} /><span>{row.label}</span></label></th>
                      {ACTIONS.map((a) => {
                        if (!row.actions.includes(a.id)) return <td key={a.id} className="rp-na"><span aria-label={`${a.label} unavailable for ${row.label}`} data-testid={`text-na-${row.id}-${a.id}`}>—</span></td>;
                        const key = `${row.id}:${a.id}`;
                        return <td key={a.id}><input type="checkbox" className="rp-check" checked={selected.includes(key)} onChange={() => toggle([key])} aria-label={`${a.label} ${row.label} in ${mod.label} for ${role.name}`} data-testid={`checkbox-perm-${row.id}-${a.id}`} /></td>;
                      })}
                    </tr>;
                  })}</tbody>
                </table>
              </div>}
            <p className="rp-scope">Module checkbox: whole module. Row and column checkboxes: displayed rows only. Clear all and Grant all: every module.</p>
          </div>
        </div>
      </section>
    </div>
    {adding && <AddRoleDialog roles={roles} onAdd={addRole} onClose={() => setAdding(false)} />}
  </AdminLayout>;
}
