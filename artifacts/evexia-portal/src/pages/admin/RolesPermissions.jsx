import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Pencil, Plus, RefreshCw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ZonePermissionMatrix, { countLabel } from '../../components/admin/ZonePermissionMatrix.jsx';
import { MASTER_KEYS as ZONE_KEYS } from '../../auth/capabilities.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { listRoles, getRole, createRole, updateRole, deleteRole, setRolePermissions, samePermissions, validateRoleName, validateRoleDescription, ROLE_NAME_LIMIT, ROLE_DESCRIPTION_LIMIT } from '../../services/rolePermissions.js';
import '../../roles-permissions.css';

const fmt = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(); };
const errInfo = (e) => ({ code: e?.code || '', ambiguous: Boolean(e?.ambiguous), message: (e && e.message) || 'The role service could not complete this request.' });

function RoleForm({ form, setForm, busy, blocked, error, current, onSubmit, onClose, onReview, onAdopt, onUseCurrent, reviewing, onRefresh, refreshing }) {
  const edit = form.mode === 'edit';
  const deleted = error?.code === 'role_deleted';
  const stale = error?.code === 'role_stale';
  const fieldError = form.touched ? (validateRoleName(form.name) || validateRoleDescription(form.description)) : '';
  const dup = error?.code === 'role_duplicate';
  const set = (patch) => setForm((f) => ({ ...f, ...patch, touched: false }));
  const locked = busy || reviewing || blocked || deleted || stale || refreshing;
  return <Dialog title={edit ? 'Edit role' : 'Add role'} eyebrow="Roles & Permissions" onClose={onClose}
    description="Name and description only. Saving this form never changes the role's permissions."
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={busy} data-testid="button-cancel-role">Cancel</button>
      <button type="submit" form="rp-role-form" className="admin-button" disabled={locked} data-testid={edit ? 'button-save-role' : 'button-create-role'}>{busy ? 'Saving...' : edit ? 'Save role' : 'Create role'}</button></>}>
    <form id="rp-role-form" className="rp-form" onSubmit={onSubmit} noValidate aria-busy={busy}>
      <label htmlFor="rp-role-name">Role name</label>
      <input id="rp-role-name" value={form.name} maxLength={ROLE_NAME_LIMIT * 2} readOnly={busy} onChange={(e) => set({ name: e.target.value })} aria-required="true" aria-invalid={Boolean(fieldError || dup)} aria-describedby="rp-role-error" autoComplete="off" data-testid="input-role-name" />
      <label htmlFor="rp-role-description">Description (optional)</label>
      <textarea id="rp-role-description" rows={3} value={form.description} maxLength={ROLE_DESCRIPTION_LIMIT * 2} readOnly={busy} onChange={(e) => set({ description: e.target.value })} data-testid="input-role-description" />
      <div id="rp-role-error" aria-live="polite">
        {fieldError && <span className="rp-form__error" role="alert" data-testid="text-role-error">{fieldError}</span>}
        {error && <div className="rp-alert" role="alert" data-testid="status-role-save-error">
          <strong>{deleted ? 'This role was deleted' : stale ? 'This role changed elsewhere' : dup ? 'Duplicate role name' : error.ambiguous ? 'Result unknown' : 'Not saved'}</strong>
          <p>{error.message}</p>
          {deleted && <p>It will not be recreated. Close this form and refresh roles. Your draft is shown above for reference only.</p>}
          {error.ambiguous && <p>Submitting is blocked until you refresh roles and check the current list. Your draft is kept.</p>}
          {error.ambiguous && <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} disabled={busy || refreshing} data-testid="button-refresh-draft-roles">{refreshing ? 'Refreshing...' : 'Refresh roles'}</button>}
          {!deleted && !error.ambiguous && !stale && <p>Your draft is kept. Fix the problem and try again.</p>}
          {stale && <div className="rp-alert__actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={onReview} disabled={busy || reviewing} data-testid="button-review-current">{reviewing ? 'Loading...' : 'Review current details'}</button>
          </div>}
          {stale && current && <div className="rp-current" data-testid="text-current-role">
            <dl><dt>Current name</dt><dd>{current.name}</dd><dt>Current description</dt><dd>{current.description || 'None'}</dd><dt>Updated</dt><dd>{fmt(current.updated_at)} (version {current.version})</dd></dl>
            <div className="rp-alert__actions">
              <button type="button" className="admin-button" onClick={onAdopt} disabled={busy} data-testid="button-adopt-current">Keep my draft on current version</button>
              <button type="button" className="admin-button admin-button--secondary" onClick={onUseCurrent} disabled={busy} data-testid="button-use-current">Discard draft, use current</button>
            </div></div>}
        </div>}
      </div>
    </form>
  </Dialog>;
}

export default function RolesPermissions() {
  useAdminPreferences();
  const [tab, setTab] = useState('roles');
  const [cursors, setCursors] = useState([null]);
  const [idx, setIdx] = useState(0);
  const [page, setPage] = useState({ items: [], has_more: false, next_cursor: null });
  const [status, setStatus] = useState('loading');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [del, setDel] = useState(null);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const [leave, setLeave] = useState(null);
  const [, navigate] = useLocation();
  const seq = useRef(0);
  const ctrl = useRef(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const state = useRef({}); state.current = { cursors, idx, page, pinned, selectedId, draft, permAmbiguous: Boolean(draft?.ambiguous) };

  const load = useCallback(async (stack, at, silent = false) => {
    const mine = ++seq.current;
    ctrl.current?.abort();
    const c = typeof AbortController === 'undefined' ? null : new AbortController();
    ctrl.current = c;
    if (!silent) { setStatus('loading'); setListError(''); }
    try {
      const data = await listRoles(stack[at], c ? { signal: c.signal } : undefined);
      if (mine !== seq.current || !mounted.current) return null;
      if (!data.items.length && at > 0) return load(stack.slice(0, at), at - 1, silent);
      const next = data.has_more ? [...stack.slice(0, at + 1), data.next_cursor] : stack.slice(0, at + 1);
      const p = state.current.pinned;
      const target = p || (state.current.selectedId ? { id: state.current.selectedId } : null);
      if (target && !data.items.some((r) => r.id === target.id)) {
        // Authoritative read for an off-page role; absence from a page never means deletion.
        try { const fresh = await getRole(target.id, c ? { signal: c.signal } : undefined); if (mine === seq.current && mounted.current) setPinned(fresh); }
        catch (e) {
          if (mine === seq.current && mounted.current && e?.code === 'role_deleted') {
            setPinned(null);
            setDraft((d) => (d && d.roleId === target.id ? { ...d, deleted: true, saving: false, error: { code: 'role_deleted', ambiguous: Boolean(d.ambiguous), message: 'This role was deleted. Your selection is kept for reference only.' } } : d));
          } else if (mine === seq.current && mounted.current) {
            // A failed detail read is not proof of deletion. Retain the last
            // selected snapshot; a later versioned write still fails closed.
            const known = p || state.current.page.items.find((r) => r.id === target.id) || state.current.draft?.role;
            if (known?.id === target.id) setPinned(known);
          }
        }
      } else if (p) setPinned(null);
      if (mine !== seq.current || !mounted.current) return null;
      // Publish the page only after its off-page selection has been resolved.
      // Otherwise the default-selection effect can select the new first row.
      setCursors(next); setIdx(at); setPage(data); setStatus('ready'); setListError('');
      return data;
    } catch (e) {
      if (mine !== seq.current || !mounted.current || e?.name === 'AbortError') return null;
      setStatus('unavailable'); setListError(errInfo(e).message);
      return null;
    }
  }, []);

  useEffect(() => { mounted.current = true; load([null], 0); return () => { mounted.current = false; ctrl.current?.abort(); seq.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden' && !busyRef.current && !state.current.permAmbiguous) load(state.current.cursors, state.current.idx, true); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  const found = page.items.find((r) => r.id === selectedId) || null;
  const liveRole = pinned && pinned.id === selectedId && (!found || pinned.version > found.version) ? pinned : found;
  // Only an explicitly confirmed deletion marks the role gone. Until then a
  // draft keeps its last known role visible, even if a page omits it.
  const here = draft && draft.roleId === selectedId;
  const gone = Boolean(here && draft.deleted);
  const role = gone ? { ...draft.role } : liveRole || (here ? { ...draft.role } : null);
  const mine = draft && role && draft.roleId === role.id ? draft : null;
  const selectedPerms = mine ? mine.selected : role?.permissions || [];
  // Dirty is measured against the snapshot the draft started from, never the
  // refreshed server role, so an external match cannot silently clear it.
  const dirty = Boolean(mine && !samePermissions(mine.selected, mine.role.permissions));
  const behind = Boolean(dirty && !gone && mine.base !== role.version);
  const permBusy = Boolean(mine?.saving);
  const guarded = dirty || permBusy || Boolean(mine?.ambiguous || mine?.deleted || mine?.error);
  useEffect(() => {
    if (status !== 'ready') return;
    if (!role) setSelectedId(page.items[0]?.id ?? null);
  }, [status, role, page.items]);

  const refreshAll = async () => {
    const data = await load(state.current.cursors, state.current.idx);
    if (data) {
      setBlocked(false);
      const d = state.current.draft;
      if (d && d.ambiguous && !d.deleted) {
        // Explicit, authoritative reconciliation of an unknown save outcome.
        let r = data.items.find((x) => x.id === d.roleId);
        let deleted = false;
        if (!r) {
          try { r = await getRole(d.roleId); }
          catch (e) {
            if (e?.code === 'role_deleted') deleted = true;
            else { setDraft((cur) => (cur && cur.roleId === d.roleId ? { ...cur, error: { ...cur.error, message: 'The role could not be read to confirm the result. Try Refresh roles again.' } } : cur)); return data; }
          }
        }
        if (!mounted.current) return data;
        if (deleted) setDraft((cur) => (cur && cur.roleId === d.roleId ? { ...cur, ambiguous: false, deleted: true, error: { code: 'role_deleted', message: 'This role was deleted. Your selection is kept for reference only.' } } : cur));
        else {
          setPinned(r);
          if (samePermissions(r.permissions, d.selected)) { setNotice(`The server now shows the permissions you selected for ${r.name}. The earlier result could not be confirmed as yours.`); setDraft(null); }
          else setDraft((cur) => (cur && cur.roleId === d.roleId ? { ...cur, ambiguous: false, error: null } : cur));
        }
      }
    }
    return data;
  };
  const go = (to) => { if (to < 0 || to >= cursors.length || busyRef.current) return; if (guarded) setLeave({ kind: 'page', to }); else load(cursors, to); };
  const selectRole = (id) => { if (id === selectedId || busyRef.current) return; if (guarded) setLeave({ kind: 'role', id }); else { setDraft(null); setSelectedId(id); setNotice(''); } };
  const mutateRole = (run) => { if (busyRef.current) return; if (guarded) setLeave({ kind: 'run', run }); else { setDraft(null); run(); } };
  const changeTab = (next, focus = false) => { setTab(next); if (focus) document.getElementById(`rp-tab-${next}`)?.focus(); };
  const tabKeys = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    changeTab(e.key === 'Home' ? 'roles' : e.key === 'End' ? 'permissions' : tab === 'roles' ? 'permissions' : 'roles', true);
  };
  const revealKeyboardTab = (e) => {
    const target = e.currentTarget;
    // Firefox's native focus scroll can leave a tab partly above the viewport.
    // Run after native focus scrolling and preserve pointer-click positioning.
    requestAnimationFrame(() => {
      if (document.activeElement === target && target.matches(':focus-visible')) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  };
  const proceed = () => {
    const l = leave; setLeave(null); setDraft(null);
    if (l.kind === 'role') { setSelectedId(l.id); setNotice(''); }
    else if (l.kind === 'page') load(cursors, l.to);
    else if (l.kind === 'run') l.run();
    else if (l.kind === 'raw') window.history.pushState(null, '', l.href);
    else navigate(l.href);
  };
  useEffect(() => {
    if (!guarded) return undefined;
    const release = setNavigationGuard((request) => { setLeave(request); return true; });
    const onClick = (e) => {
      const a = e.target?.closest?.('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      e.preventDefault(); e.stopPropagation(); setLeave({ kind: 'href', href });
    };
    const unload = (e) => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('click', onClick, true); window.addEventListener('beforeunload', unload);
    return () => { release(); document.removeEventListener('click', onClick, true); window.removeEventListener('beforeunload', unload); };
  }, [guarded]);
  const edit = (selected) => setDraft((d) => {
    const snapshot = d && d.roleId === role.id ? d : { roleId: role.id, role, base: role.version, error: null };
    // Returning to the unchanged snapshot ends an ordinary draft. Recovery
    // evidence is kept until the user explicitly reconciles it.
    if (!snapshot.error && !snapshot.ambiguous && !snapshot.deleted && samePermissions(selected, snapshot.role.permissions)) return null;
    return { ...snapshot, selected };
  });
  const toggle = (key) => edit(ZONE_KEYS.filter((k) => (k === key ? !selectedPerms.includes(k) : selectedPerms.includes(k))));
  async function savePermissions() {
    if (!mine || !dirty || busyRef.current || blocked || status !== 'ready' || mine.ambiguous || behind || gone || mine.error?.code === 'role_deleted') return;
    setBusyBoth(true); setDraft((d) => ({ ...d, saving: true, error: null }));
    try {
      const saved = await setRolePermissions(role.id, mine.selected, mine.base);
      if (!mounted.current) return;
      setPinned(saved); setDraft(null);
      setNotice(`Saved permissions for ${saved.name}. ${countLabel(saved.permissions.length)} granted under Masters.`);
      setBusyBoth(false);
      await load(state.current.cursors, state.current.idx);
    } catch (e) {
      if (!mounted.current) return;
      const info = errInfo(e);
      setDraft((d) => (d ? { ...d, saving: false, error: info, ambiguous: info.ambiguous, deleted: d.deleted || info.code === 'role_deleted' } : d));
      setBusyBoth(false);
      if (info.code === 'role_stale' || info.code === 'role_deleted') await load(state.current.cursors, state.current.idx, true);
    }
  }
  const adoptDraft = () => setDraft((d) => ({ ...d, base: role.version, role, error: null }));
  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v); };

  function openForm(mode, r) {
    setFormError(null); setCurrent(null);
    setForm(mode === 'edit' ? { mode, id: r.id, version: r.version, name: r.name, description: r.description } : { mode, name: '', description: '' });
  }
  const closeForm = () => { if (!busyRef.current && !reviewing) { setForm(null); setFormError(null); setCurrent(null); } };

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current || blocked || reviewing || ['role_deleted', 'role_stale'].includes(formError?.code)) return;
    const problem = validateRoleName(form.name) || validateRoleDescription(form.description);
    if (problem) { setForm((f) => ({ ...f, touched: true })); return; }
    const fields = { name: form.name.trim(), description: form.description.trim() };
    setBusyBoth(true); setFormError(null);
    try {
      const saved = form.mode === 'edit' ? await updateRole(form.id, fields, form.version) : await createRole(fields);
      if (!mounted.current) return;
      setPinned(saved); setSelectedId(saved.id); setForm(null); setCurrent(null);
      setNotice(form.mode === 'edit' ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
      setBusyBoth(false);
      await load(state.current.cursors, state.current.idx);
    } catch (e) {
      if (!mounted.current) return;
      const info = errInfo(e);
      setFormError(info); if (info.ambiguous) setBlocked(true);
      setBusyBoth(false);
    }
  }
  async function review() {
    setReviewing(true);
    try { const r = await getRole(form.id); if (mounted.current) setCurrent(r); }
    catch (e) { if (mounted.current) setFormError({ ...errInfo(e), code: e?.code === 'role_deleted' ? 'role_deleted' : 'role_stale' }); }
    finally { if (mounted.current) setReviewing(false); }
  }
  const adopt = () => { setForm((f) => ({ ...f, version: current.version })); setFormError(null); setCurrent(null); };
  const useCurrent = () => { setForm((f) => ({ ...f, version: current.version, name: current.name, description: current.description })); setFormError(null); setCurrent(null); };

  async function confirmDelete() {
    if (busyRef.current || blocked || !del) return;
    setBusyBoth(true); setFormError(null);
    try {
      await deleteRole(del.id, del.version);
      if (!mounted.current) return;
      const name = del.name;
      if (selectedId === del.id) setSelectedId(null);
      setPinned((p) => (p && p.id === del.id ? null : p));
      setDel(null); setNotice(`Deleted ${name}.`); setBusyBoth(false);
      await load(state.current.cursors, state.current.idx);
    } catch (e) {
      if (!mounted.current) return;
      const info = errInfo(e);
      setFormError(info); if (info.ambiguous) setBlocked(true);
      setBusyBoth(false);
    }
  }
  const closeDelete = () => { if (!busyRef.current) { setDel(null); setFormError(null); } };
  const delGone = formError?.code === 'role_deleted' || formError?.code === 'role_stale';

  const loading = status === 'loading';
  return <AdminLayout title="Roles & Permissions">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Roles and permissions</p><h1>Roles & Permissions</h1><p className="admin-page-head__description">Manage role names, descriptions and master permissions. Staff only receive a role's permissions when a Super Admin explicitly assigns it in Staff Management. The server records an audit entry for every change.</p></div></div>
    {blocked && <div className="rp-alert rp-alert--page" role="alert" data-testid="status-roles-blocked">A previous change had an unknown result. Refresh roles to confirm the current state before submitting again.</div>}
    {notice && <div className="admin-feedback rp-feedback" role="status" data-testid="status-roles-notice">{notice}</div>}
    <div className="rp-tabs" role="tablist" aria-label="Roles and permissions">
      {['roles', 'permissions'].map((key) => <button key={key} type="button" id={`rp-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`rp-panel-${key}`} tabIndex={tab === key ? 0 : -1} onFocus={revealKeyboardTab} onKeyDown={tabKeys} onClick={() => changeTab(key)} data-testid={`tab-${key}`}>{key === 'roles' ? 'Roles' : 'Permissions'}</button>)}
    </div>
    {guarded && tab === 'roles' && <div className="rp-scope" role="status">A permission draft for {role?.name} is kept. <button type="button" className="admin-button admin-button--secondary" onClick={() => changeTab('permissions')}>Review permission draft</button> Save or discard it before changing roles.</div>}
    <div id={`rp-panel-${tab}`} role="tabpanel" aria-labelledby={`rp-tab-${tab}`} className={`rp rp--${tab === 'roles' ? 'directory' : 'permissions'}`}>
      <aside className="admin-panel rp-roles" aria-label="Roles" aria-busy={loading}>
        <h2 className="rp-roles__title">Roles <span data-testid="text-role-count">{page.items.length}</span></h2>
        <p className="rp-pageinfo">Page {idx + 1}{page.has_more ? '' : ' (last)'}</p>
        {loading && !page.items.length ? <div className="rp-skel" role="status" data-testid="status-roles-loading"><span className="sr-only">Loading roles</span><i /><i /><i /></div> :
          status === 'unavailable' ? <div className="rp-alert" role="alert" data-testid="status-roles-unavailable"><strong>Roles unavailable</strong><p>{listError}</p></div> :
          page.items.length === 0 ? <div className="admin-empty" role="status" data-testid="status-roles-empty"><strong>No roles yet</strong><p>Create the first business role.</p></div> :
          <ul className="rp-roles__list">{page.items.map((r) => <li key={r.id} className="rp-role-card"><button type="button" className={`rp-role${role && r.id === role.id ? ' rp-role--active' : ''}`} aria-pressed={Boolean(role && r.id === role.id)} disabled={busy} onClick={() => selectRole(r.id)} data-testid={`button-role-${r.id}`}>
            <strong>{r.name}</strong><small data-testid={`text-role-permissions-${r.id}`}>{countLabel(r.permissions.length)} saved</small></button>
            {tab === 'roles' && <div className="rp-card-actions">
              <button type="button" className="admin-button admin-button--secondary" aria-label={`Edit ${r.name}`} disabled={loading || status !== 'ready' || busy || blocked} onClick={() => mutateRole(() => openForm('edit', r))} data-testid={r.id === selectedId ? 'button-edit-role' : `button-edit-role-${r.id}`}><Pencil size={14} aria-hidden="true" /> Edit</button>
              <button type="button" className="admin-button admin-button--secondary" aria-label={`Delete ${r.name}`} disabled={loading || status !== 'ready' || busy || blocked} onClick={() => mutateRole(() => { setFormError(null); setDel(r); })} data-testid={r.id === selectedId ? 'button-delete-role' : `button-delete-role-${r.id}`}><Trash2 size={14} aria-hidden="true" /> Delete</button>
            </div>}</li>)}</ul>}
        <div className="rp-pager">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => go(idx - 1)} disabled={idx === 0 || loading || permBusy} data-testid="button-previous-roles"><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => go(idx + 1)} disabled={!page.has_more || loading || permBusy || status !== 'ready'} data-testid="button-next-roles">Next <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
        <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={loading || permBusy} data-testid="button-refresh-roles"><RefreshCw size={14} aria-hidden="true" /> Refresh roles</button>
        {tab === 'roles' && <button type="button" className="rp-add" disabled={loading || status !== 'ready' || busy || blocked} onClick={() => mutateRole(() => { setNotice(''); openForm('add'); })} data-testid="button-add-role"><Plus size={15} aria-hidden="true" /> Add role</button>}
      </aside>

      <section className="admin-panel rp-work" aria-label="Role details">
        {role ? <>
          <div className="rp-head">
            <div className="rp-head__main"><h2 data-testid="text-active-role">{role.name}</h2></div>
            {tab === 'roles' && !found && <div className="rp-head__actions">
              <button type="button" className="admin-button admin-button--secondary" disabled={loading || status !== 'ready' || busy || blocked || gone} onClick={() => mutateRole(() => openForm('edit', role))} data-testid="button-edit-role"><Pencil size={14} aria-hidden="true" /> Edit</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={loading || status !== 'ready' || busy || blocked || gone} onClick={() => mutateRole(() => { setFormError(null); setDel(role); })} data-testid="button-delete-role"><Trash2 size={14} aria-hidden="true" /> Delete</button>
            </div>}
          </div>
          {tab === 'roles' && <dl className="rp-meta">
            <dt>Description</dt><dd>{role.description || 'No description'}</dd>
            <dt>Permissions</dt><dd><span data-testid="text-permission-count">{countLabel(role.permissions.length)}</span> saved</dd>
            <dt>Created</dt><dd>{fmt(role.created_at)}</dd>
            <dt>Updated</dt><dd>{fmt(role.updated_at)} (version {role.version})</dd>
          </dl>}
          <div hidden={tab !== 'permissions'}>
          <ZonePermissionMatrix selected={selectedPerms} saved={role.permissions} dirty={dirty} busy={permBusy} disabled={busy || blocked || status !== 'ready' || gone || behind || Boolean(mine?.ambiguous) || mine?.error?.code === 'role_deleted'}
            onToggle={toggle} onSelect={edit} onAll={() => edit([...ZONE_KEYS])} onNone={() => edit([])} onSave={savePermissions} onCancel={() => setDraft(null)}>
            <div aria-live="polite">
              {gone && <div className="rp-alert" role="alert" data-testid="status-permissions-deleted"><strong>This role was deleted</strong><p>Nothing was saved. Your unsaved selection is shown for reference only. Discard it to continue.</p><div className="rp-alert__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setDraft(null)} data-testid="button-discard-permission-draft">Discard draft</button></div></div>}
              {behind && <div className="rp-alert" role="alert" data-testid="status-permissions-stale"><strong>This role changed elsewhere</strong><p>Now at version {role.version}; your draft started from version {mine.base}. Saved: {countLabel(role.permissions.length)}. Choose how to continue.</p><div className="rp-alert__actions"><button type="button" className="admin-button" onClick={adoptDraft} data-testid="button-adopt-permissions">Keep my selection on current version</button><button type="button" className="admin-button admin-button--secondary" onClick={() => setDraft(null)} data-testid="button-use-current-permissions">Discard draft, use current</button></div></div>}
              {mine && !dirty && !gone && mine.error && !mine.ambiguous && <div className="rp-alert" role="alert" data-testid="status-permissions-reconcile"><strong>Nothing was saved by this attempt</strong><p>{mine.error.message} The server now shows {countLabel(role.permissions.length)}, which happens to equal your selection. Clear the draft to continue.</p><div className="rp-alert__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setDraft(null)} data-testid="button-reconcile-permissions">Clear draft</button></div></div>}
              {mine?.error && dirty && !gone && !behind && <div className="rp-alert" role="alert" data-testid="status-permissions-error"><strong>{mine.ambiguous ? 'Result unknown' : 'Permissions not saved'}</strong><p>{mine.error.message}</p>{mine.ambiguous ? <><p>Saving is blocked until you refresh roles. Your selection is kept.</p><div className="rp-alert__actions"><button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={loading} data-testid="button-refresh-permission-roles">Refresh roles</button></div></> : <p>Your selection is kept. Try Save permissions again.</p>}</div>}
            </div>
          </ZonePermissionMatrix>
          </div>
        </> : <div className="admin-empty" role="status">
          <strong>{loading ? 'Loading roles' : status === 'unavailable' ? 'Roles could not be loaded' : 'No role selected'}</strong>
          <p>{status === 'unavailable' ? 'Use Refresh roles to try again.' : 'Select or add a role to configure its master permissions.'}</p>
          <span className="sr-only" data-testid="text-permission-count">0 permissions</span>
        </div>}
      </section>
    </div>
    <div id={`rp-panel-${tab === 'roles' ? 'permissions' : 'roles'}`} role="tabpanel" aria-labelledby={`rp-tab-${tab === 'roles' ? 'permissions' : 'roles'}`} hidden />
    {form && <RoleForm form={form} setForm={setForm} busy={busy} blocked={blocked} error={formError} current={current} reviewing={reviewing} onSubmit={submit} onClose={closeForm} onReview={review} onAdopt={adopt} onUseCurrent={useCurrent} onRefresh={refreshAll} refreshing={loading} />}
    {leave && <Dialog title="Unsaved permission changes" eyebrow="Roles & Permissions" onClose={() => setLeave(null)} description={`${role?.name || 'This role'} has permission changes that are not saved. Continuing discards them.`}
      footer={<><button type="button" className="admin-button admin-button--secondary" onClick={() => setLeave(null)} data-testid="button-keep-editing-permissions">Keep editing</button>
        <button type="button" className="admin-button rp-danger" onClick={proceed} disabled={permBusy} data-testid="button-discard-permissions-continue">Discard and continue</button></>}><p>Use Save permissions on the role to keep them.</p></Dialog>}
    {del && <Dialog title="Delete role" eyebrow="Roles & Permissions" onClose={closeDelete} description={`Delete "${del.name}"? The role record and saved permissions are retained, but the role becomes unavailable and grants no access. Any staff assignment blocks deletion, including inactive, login-disabled and deleted staff. Explicitly unassign or reassign editable staff in Staff Management; retained deleted-staff links require operator resolution.`}
      footer={<><button type="button" className="admin-button admin-button--secondary" onClick={closeDelete} disabled={busy} data-testid="button-cancel-role">Cancel</button>
        <button type="button" className="admin-button rp-danger" onClick={confirmDelete} disabled={busy || blocked || delGone} data-testid="button-confirm-delete-role">{busy ? 'Deleting...' : 'Delete role'}</button></>}>
      <div aria-live="polite">{formError && <div className="rp-alert" role="alert" data-testid="text-role-error">
        <strong>{formError.code === 'role_deleted' ? 'Already deleted' : formError.code === 'role_stale' ? 'Role changed elsewhere' : formError.ambiguous ? 'Result unknown' : 'Not deleted'}</strong>
        <p>{formError.message}</p>
        {formError.ambiguous && <p>Deleting is blocked until you refresh roles.</p>}
        {formError.ambiguous && <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={loading} data-testid="button-refresh-draft-roles">Refresh roles</button>}
        {delGone && <p>Close this dialog and refresh roles to see the current state.</p>}
      </div>}</div>
    </Dialog>}
  </AdminLayout>;
}
