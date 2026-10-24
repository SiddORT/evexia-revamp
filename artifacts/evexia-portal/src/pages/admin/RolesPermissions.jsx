import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ZonePermissionMatrix, { countLabel } from '../../components/admin/ZonePermissionMatrix.jsx';
import { ASSIGNABLE_KEYS as ZONE_KEYS, canReadResource, hasCapability } from '../../auth/capabilities.js';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { continueNavigation, setNavigationGuard } from '../../auth/navigationGuard.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import { listRoles, getRole, createRole, updateRole, deleteRole, setRolePermissions, samePermissions, validateRoleName, validateRoleDescription, ROLE_NAME_LIMIT, ROLE_DESCRIPTION_LIMIT } from '../../services/rolePermissions.js';
import '../../roles-permissions.css';

const errInfo = (e) => ({ code: e?.code || '', ambiguous: Boolean(e?.ambiguous), message: (e && e.message) || 'The role service could not complete this request.' });
const fmt = (value) => formatAdminTimestamp(value, undefined, true);
// Keep row order, but never replace a known version with an older batch snapshot.
const mergeRoles = (known, incoming) => {
  const rows = new Map(known.map((r) => [r.id, r]));
  incoming.forEach((r) => { if (!rows.has(r.id) || rows.get(r.id).version < r.version) rows.set(r.id, r); });
  return [...rows.values()];
};

function RoleForm({ form, setForm, busy, blocked, error, current, onSubmit, onClose, onReview, onAdopt, onUseCurrent, reviewing, onRefresh, refreshing }) {
  const can = useResourceActions('role');
  useAdminPreferences();
  const edit = form.mode === 'edit';
  const deleted = error?.code === 'role_deleted';
  const stale = error?.code === 'role_stale';
  const fieldError = form.touched ? (validateRoleName(form.name) || validateRoleDescription(form.description)) : '';
  const dup = error?.code === 'role_duplicate';
  const set = (patch) => setForm((f) => ({ ...f, ...patch, touched: false }));
  const locked = busy || reviewing || blocked || deleted || stale || refreshing || !(edit ? can.edit : can.add);
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
  const can = useResourceActions('role');
  const permissionAccess = useResourceActions('permissions');
  const tabs = [...(can.read ? ['roles'] : []), ...(permissionAccess.view ? ['permissions'] : [])];
  const [tab, setTab] = useState(() => can.read ? 'roles' : 'permissions');
  useEffect(() => {
    if (tabs.length && !tabs.includes(tab)) setTab(tabs[0]);
  }, [tab, can.read, permissionAccess.view]);
  const [page, setPage] = useState({ items: [], has_more: false, next_cursor: null });
  const [append, setAppend] = useState({ loading: false, error: '' });
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
  const directory = useRef(page);
  const requestKind = useRef(null);
  const seenCursors = useRef(new Set([null]));
  const appendFailure = useRef('');
  const reconciling = useRef(false);
  const scrollRegion = useRef(null);
  const listElement = useRef(null);
  const state = useRef({}); state.current = { page, pinned, selectedId, draft, status, blocked, permAmbiguous: Boolean(draft?.ambiguous) };

  // Every refresh invalidates the entire cursor chain, then reads only batch one
  // and (if outside it) the selected role. Never scan the whole directory.
  const load = useCallback(async (silent = false, selection) => {
    const mine = ++seq.current;
    ctrl.current?.abort();
    const c = typeof AbortController === 'undefined' ? null : new AbortController();
    ctrl.current = c;
    requestKind.current = 'refresh';
    appendFailure.current = '';
    setAppend({ loading: false, error: '' });
    if (!silent) { setStatus('loading'); setListError(''); }
    try {
      const data = await listRoles(null, c ? { signal: c.signal } : undefined);
      if (mine !== seq.current || !mounted.current) return null;
      const p = selection || state.current.pinned;
      const target = selection || (state.current.selectedId ? { id: state.current.selectedId } : null);
      const stillSelected = () => selection
        ? state.current.selectedId === selection.id || state.current.selectedId === null
        : state.current.selectedId === target?.id;
      if (target && !data.items.some((r) => r.id === target.id)) {
        // Absence from a batch is never evidence of deletion.
        try {
          const fresh = await getRole(target.id, c ? { signal: c.signal } : undefined);
          if (mine === seq.current && mounted.current && stillSelected()) setPinned(p?.id === fresh.id && p.version > fresh.version ? p : fresh);
        }
        catch (e) {
          if (mine === seq.current && mounted.current && stillSelected() && e?.code === 'role_deleted') {
            setPinned(null);
            setDraft((d) => (d && d.roleId === target.id ? { ...d, deleted: true, saving: false, error: { code: 'role_deleted', ambiguous: Boolean(d.ambiguous), message: 'This role was deleted. Your selection is kept for reference only.' } } : d));
          } else if (mine === seq.current && mounted.current && stillSelected()) {
            // A failed detail read is not proof of deletion. Retain the last
            // selected snapshot; a later versioned write still fails closed.
            const known = p || state.current.page.items.find((r) => r.id === target.id) || state.current.draft?.role;
            if (known?.id === target.id) setPinned(known);
          }
        }
      } else if (p && stillSelected()) {
        const listed = data.items.find((r) => r.id === p.id);
        if (listed && listed.version >= p.version) setPinned(null);
      }
      if (mine !== seq.current || !mounted.current) return null;
      // A silent refresh may outlive a selection click. Preserve the newly
      // selected snapshot too, rather than letting batch one select its first row.
      if (target && !stillSelected()) {
        const id = state.current.selectedId;
        const latest = state.current.pinned?.id === id ? state.current.pinned : directory.current.items.find((r) => r.id === id);
        const listed = data.items.find((r) => r.id === id);
        if (latest && (!listed || latest.version > listed.version)) setPinned(latest);
      }
      // Retain newer metadata for IDs still present; absent rows are invalidated.
      const known = new Map(mergeRoles(directory.current.items, p ? [p] : []).map((r) => [r.id, r]));
      const refreshed = { ...data, items: mergeRoles([], data.items.map((r) => known.get(r.id)?.version > r.version ? known.get(r.id) : r)) };
      seenCursors.current = new Set([null]);
      directory.current = refreshed;
      if (scrollRegion.current) scrollRegion.current.scrollTop = 0;
      setPage(refreshed); setStatus('ready'); setListError('');
      return refreshed;
    } catch (e) {
      if (mine !== seq.current || !mounted.current || e?.name === 'AbortError') return null;
      setStatus('unavailable'); setListError(errInfo(e).message);
      return null;
    } finally {
      if (mine === seq.current) requestKind.current = null;
    }
  }, []);

  const loadMore = useCallback(async (retry = false) => {
    const before = directory.current;
    if (!mounted.current || requestKind.current || reconciling.current || busyRef.current || state.current.status !== 'ready'
        || getSession().status !== 'authenticated' || !getSession().user?.permissions.includes('roles.manage')
        || !before.has_more || (appendFailure.current && !retry)) return;
    const cursor = before.next_cursor;
    const mine = ++seq.current;
    const c = typeof AbortController === 'undefined' ? null : new AbortController();
    ctrl.current = c;
    requestKind.current = 'append';
    appendFailure.current = '';
    setAppend({ loading: true, error: '' });
    try {
      if (seenCursors.current.has(cursor)) throw new Error('The role directory repeated a cursor. Refresh roles to continue.');
      const data = await listRoles(cursor, c ? { signal: c.signal } : undefined);
      if (mine !== seq.current || !mounted.current) return;
      if (data.has_more && (data.next_cursor === cursor || seenCursors.current.has(data.next_cursor))) {
        throw new Error('The role directory repeated a cursor. Refresh roles to continue.');
      }
      const rows = mergeRoles(before.items, data.items);
      const p = state.current.pinned;
      const next = { ...data, items: rows.map((r) => p?.id === r.id && p.version > r.version ? p : r) };
      if (data.has_more && next.items.length === before.items.length) {
        throw new Error('The next batch added no roles. Retry or refresh roles to continue.');
      }
      seenCursors.current.add(cursor);
      directory.current = next;
      setPage(next);
      setAppend({ loading: false, error: '' });
    } catch (e) {
      if (mine !== seq.current || !mounted.current || e?.name === 'AbortError') return;
      appendFailure.current = errInfo(e).message;
      setAppend({ loading: false, error: appendFailure.current });
    } finally {
      if (mine === seq.current) requestKind.current = null;
    }
  }, []);

  const nearBottom = useCallback(() => {
    const el = scrollRegion.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) void loadMore();
  }, [loadMore]);
  useEffect(() => {
    // Also fill an underfull container, and re-evaluate after wrapping, text
    // enlargement, viewport changes or a tab changing row heights.
    nearBottom();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(nearBottom);
    if (scrollRegion.current) observer?.observe(scrollRegion.current);
    if (listElement.current) observer?.observe(listElement.current);
    window.addEventListener('resize', nearBottom);
    return () => { observer?.disconnect(); window.removeEventListener('resize', nearBottom); };
  }, [nearBottom, page, status, append.loading, tab, busy]);

  useEffect(() => {
    mounted.current = true;
    load();
    const unsubscribe = subscribeSession(() => {
      const session = getSession();
      if (session.status !== 'authenticated'
          || !(canReadResource(session.user, 'role') || hasCapability(session.user, 'permissions', 'view'))) {
        // Renewal can preserve this mounted editor. Do not leave an aborted
        // explicit reconciliation permanently stuck in its loading state.
        if (requestKind.current === 'refresh') {
          setStatus(directory.current.items.length ? 'ready' : 'unavailable');
          setListError('Role loading was interrupted by a session change. Refresh roles after signing in.');
        }
        ctrl.current?.abort(); seq.current++; requestKind.current = null;
        setAppend({ loading: false, error: '' });
      } else if (!busyRef.current && !state.current.permAmbiguous && !state.current.blocked && !appendFailure.current) {
        void load(true);
      }
    });
    return () => { unsubscribe(); mounted.current = false; ctrl.current?.abort(); seq.current++; };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && !requestKind.current && !reconciling.current && !busyRef.current
          && !state.current.permAmbiguous && !state.current.blocked && !appendFailure.current
          && getSession().status === 'authenticated') void load(true);
    };
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
    if (reconciling.current || busyRef.current) return null;
    reconciling.current = true;
    try {
      const data = await load();
      if (data) {
        const refreshSeq = seq.current;
        setBlocked(false);
        const d = state.current.draft;
        if (d && d.ambiguous && !d.deleted) {
          // Hold automatic appends until explicit reconciliation is finished;
          // an append must not obsolete this authoritative selected-role read.
          let r = data.items.find((x) => x.id === d.roleId);
          let deleted = false;
          if (!r) {
            try { r = await getRole(d.roleId, ctrl.current ? { signal: ctrl.current.signal } : undefined); }
            catch (e) {
              if (e?.code === 'role_deleted') deleted = true;
              else {
                if (mounted.current && refreshSeq === seq.current) setDraft((cur) => (cur && cur.roleId === d.roleId ? { ...cur, error: { ...cur.error, message: 'The role could not be read to confirm the result. Try Refresh roles again.' } } : cur));
                return data;
              }
            }
          }
          if (!mounted.current || refreshSeq !== seq.current) return data;
          if (deleted) setDraft((cur) => (cur && cur.roleId === d.roleId ? { ...cur, ambiguous: false, deleted: true, error: { code: 'role_deleted', message: 'This role was deleted. Your selection is kept for reference only.' } } : cur));
          else {
            setPinned(r);
            if (samePermissions(r.permissions, d.selected)) { setNotice(`The server now shows the permissions you selected for ${r.name}. The earlier result could not be confirmed as yours.`); setDraft(null); }
            else setDraft((cur) => (cur && cur.roleId === d.roleId ? { ...cur, ambiguous: false, error: null } : cur));
          }
        }
      }
      return data;
    } finally {
      reconciling.current = false;
      if (mounted.current) nearBottom();
    }
  };
  const selectRole = (id) => { if (id === selectedId || busyRef.current) return; if (guarded) setLeave({ kind: 'role', id }); else { setDraft(null); setSelectedId(id); setNotice(''); } };
  const mutateRole = (run) => { if (busyRef.current) return; if (guarded) setLeave({ kind: 'run', run }); else { setDraft(null); run(); } };
  const changeTab = (next, focus = false) => { if (!tabs.includes(next)) return; setTab(next); if (focus) document.getElementById(`rp-tab-${next}`)?.focus(); };
  const tabKeys = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const index = tabs.indexOf(tab);
    changeTab(e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1)
      : tabs[(index + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length], true);
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
    if (busyRef.current || !leave) return;
    const l = leave; setLeave(null); setDraft(null);
    if (l.kind === 'role') { setSelectedId(l.id); setNotice(''); }
    else continueNavigation(l, navigate);
  };
  useEffect(() => {
    if (!guarded) return undefined;
    return setNavigationGuard((request) => {
      if (!busyRef.current) setLeave((current) => current || request);
      return true;
    });
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
      await load(false, saved);
    } catch (e) {
      if (!mounted.current) return;
      const info = errInfo(e);
      setDraft((d) => (d ? { ...d, saving: false, error: info, ambiguous: info.ambiguous, deleted: d.deleted || info.code === 'role_deleted' } : d));
      setBusyBoth(false);
      if (info.code === 'role_stale' || info.code === 'role_deleted') await load(true);
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
      await load(false, saved);
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
    if (!can.delete || busyRef.current || blocked || !del) return;
    setBusyBoth(true); setFormError(null);
    try {
      await deleteRole(del.id, del.version);
      if (!mounted.current) return;
      const name = del.name;
      if (selectedId === del.id) setSelectedId(null);
      setPinned((p) => (p && p.id === del.id ? null : p));
      setDel(null); setNotice(`Deleted ${name}.`); setBusyBoth(false);
      await load();
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
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Roles and permissions</p><h1>Roles & Permissions</h1><p className="admin-page-head__description">Manage role metadata and approved workspace permissions. Staff only receive a role's permissions when a Super Admin explicitly assigns it in Staff Management. Permission changes and access management remain Super Admin-only.</p></div></div>
    {blocked && <div className="rp-alert rp-alert--page" role="alert" data-testid="status-roles-blocked">A previous change had an unknown result. Refresh roles to confirm the current state before submitting again.</div>}
    {notice && <div className="admin-feedback rp-feedback" role="status" data-testid="status-roles-notice">{notice}</div>}
    <div className="rp-tabs" role="tablist" aria-label="Roles and permissions">
      {tabs.map((key) => <button key={key} type="button" id={`rp-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`rp-panel-${key}`} tabIndex={tab === key ? 0 : -1} onFocus={revealKeyboardTab} onKeyDown={tabKeys} onClick={() => changeTab(key)} data-testid={`tab-${key}`}>{key === 'roles' ? 'Roles' : 'Permissions'}</button>)}
    </div>
    {guarded && tab === 'roles' && <div className="rp-scope" role="status">A permission draft for {role?.name} is kept. <button type="button" className="admin-button admin-button--secondary" onClick={() => changeTab('permissions')}>Review permission draft</button> Save or discard it before changing roles.</div>}
    <div id={`rp-panel-${tab}`} role="tabpanel" aria-labelledby={`rp-tab-${tab}`} className={`rp rp--${tab === 'roles' ? 'directory' : 'permissions'}`}>
      <aside className="admin-panel rp-roles" aria-label="Roles" aria-busy={loading}>
        <h2 className="rp-roles__title">Roles <span data-testid="text-role-count">{page.items.length} loaded</span></h2>
        <div ref={scrollRegion} className="rp-roles__scroll" role="region" aria-label="Roles directory" tabIndex={0} onScroll={nearBottom} data-testid="region-roles-directory">
        {loading && <div role="status" data-testid="status-roles-loading">Loading roles…</div>}
        {status === 'unavailable' && <div className="rp-alert" role="alert" data-testid="status-roles-unavailable"><strong>Roles could not be refreshed</strong><p>{listError}</p><p>Loaded roles are kept. Use Refresh roles to try again.</p></div>}
        {status === 'ready' && page.items.length === 0 && <div className="admin-empty" role="status" data-testid="status-roles-empty"><strong>No roles yet</strong><p>Create the first business role.</p></div>}
        <ul ref={listElement} className="rp-roles__list">{page.items.map((r) => <li key={r.id} className="rp-role-card"><button type="button" className={`rp-role${role && r.id === role.id ? ' rp-role--active' : ''}`} aria-pressed={Boolean(role && r.id === role.id)} disabled={busy} onClick={() => selectRole(r.id)} data-testid={`button-role-${r.id}`}>
            <strong>{r.name}</strong><small data-testid={`text-role-permissions-${r.id}`}>{permissionAccess.view && r.permissions_visible ? `${countLabel(r.permissions.length)} saved` : 'Permission details restricted'}</small></button>
            {tab === 'roles' && <div className="rp-card-actions">
              <button type="button" className="admin-button admin-button--secondary" aria-label={`Edit ${r.name}`} disabled={!can.edit || loading || status !== 'ready' || busy || blocked} onClick={() => mutateRole(() => openForm('edit', r))} data-testid={r.id === selectedId ? 'button-edit-role' : `button-edit-role-${r.id}`}><Pencil size={14} aria-hidden="true" /> Edit</button>
              <button type="button" className="admin-button admin-button--secondary" aria-label={`Delete ${r.name}`} disabled={!can.delete || loading || status !== 'ready' || busy || blocked} onClick={() => mutateRole(() => { setFormError(null); setDel(r); })} data-testid={r.id === selectedId ? 'button-delete-role' : `button-delete-role-${r.id}`}><Trash2 size={14} aria-hidden="true" /> Delete</button>
            </div>}</li>)}</ul>
        <div className="rp-roles__progress" role="status" aria-live="polite" aria-atomic="true" data-testid="status-roles-append">
          {append.loading ? 'Loading more roles…' : !append.error && status === 'ready' ? `${page.items.length} roles loaded.${page.has_more ? ' Scroll for more.' : ''}` : ''}
        </div>
        {append.error && <div className="rp-alert" role="alert" data-testid="status-roles-append-error">
          <strong>More roles could not be loaded</strong><p>{append.error}</p><p>Your loaded roles and selection are kept.</p>
          <div className="rp-alert__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => loadMore(true)} disabled={busy || loading || status !== 'ready'} data-testid="button-retry-more-roles">Retry loading more roles</button></div>
        </div>}
        </div>
        <div className="rp-roles__footer">
        <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={loading || permBusy} data-testid="button-refresh-roles"><RefreshCw size={14} aria-hidden="true" /> Refresh roles</button>
        {tab === 'roles' && <button type="button" className="rp-add" disabled={!can.add || loading || status !== 'ready' || busy || blocked} onClick={() => mutateRole(() => { setNotice(''); openForm('add'); })} data-testid="button-add-role"><Plus size={15} aria-hidden="true" /> Add role</button>}
        </div>
      </aside>

      <section className="admin-panel rp-work" aria-label="Role details">
        {role ? <>
          <div className="rp-head" hidden={tab === 'permissions'}>
            <div className="rp-head__main"><h2 data-testid="text-active-role">{role.name}</h2></div>
            {tab === 'roles' && !found && <div className="rp-head__actions">
              <button type="button" className="admin-button admin-button--secondary" disabled={!can.edit || loading || status !== 'ready' || busy || blocked || gone} onClick={() => mutateRole(() => openForm('edit', role))} data-testid="button-edit-role"><Pencil size={14} aria-hidden="true" /> Edit</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={!can.delete || loading || status !== 'ready' || busy || blocked || gone} onClick={() => mutateRole(() => { setFormError(null); setDel(role); })} data-testid="button-delete-role"><Trash2 size={14} aria-hidden="true" /> Delete</button>
            </div>}
          </div>
          {tab === 'roles' && <dl className="rp-meta">
            <dt>Description</dt><dd>{role.description || 'No description'}</dd>
            <dt>Permissions</dt><dd><span data-testid="text-permission-count">{permissionAccess.view && role.permissions_visible ? `${countLabel(role.permissions.length)} saved` : 'View Permissions required'}</span></dd>
            <dt>Created</dt><dd>{fmt(role.created_at)}</dd>
            <dt>Updated</dt><dd>{fmt(role.updated_at)} (version {role.version})</dd>
          </dl>}
          <div hidden={tab !== 'permissions' || !permissionAccess.view}>
          {!can.protected && <p role="status">Read-only permissions. Change Role Permissions is Super Admin-only.</p>}
          <ZonePermissionMatrix roleName={role.name} selected={selectedPerms} saved={role.permissions} dirty={dirty} busy={permBusy} disabled={!can.protected || busy || blocked || status !== 'ready' || gone || behind || Boolean(mine?.ambiguous) || mine?.error?.code === 'role_deleted'}
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
        <button type="button" className="admin-button rp-danger" onClick={confirmDelete} disabled={!can.delete || busy || blocked || delGone} data-testid="button-confirm-delete-role">{busy ? 'Deleting...' : 'Delete role'}</button></>}>
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
