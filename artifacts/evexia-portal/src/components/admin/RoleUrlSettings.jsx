import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../roleUrlSettings.css';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { roleUrlRequest } from '../../auth/adminSession.js';

const EMPTY = { hostname: '', role: 'admin', enabled: true };
const same = (a, b) => a.hostname === b.hostname && a.role === b.role && a.enabled === b.enabled;

export default function RoleUrlSettings({ onGuardChange }) {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // {id|null, version, base}
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false); // conflict / uncertain: reload required
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState('');
  const headRef = useRef(null);
  const dialogRef = useRef(null);
  const removeTrigger = useRef(null);
  const dirty = Boolean(editing) && !same(draft, editing.base);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await roleUrlRequest();
      setItems(Array.isArray(res?.items) ? res.items : []);
      setStatus('ready');
      return true;
    } catch (e) { setStatus('error'); setError(e?.message || 'Role URLs could not be loaded.'); return false; }
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  useEffect(() => {
    onGuardChange?.(() => !dirtyRef.current || window.confirm('Discard unsaved Role URL changes?'));
    return () => onGuardChange?.(null);
  }, [onGuardChange]);
  useEffect(() => {
    const h = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
  useEffect(() => setNavigationGuard(() => dirtyRef.current && !window.confirm('Discard unsaved Role URL changes?')), []);
  useEffect(() => {
    if (removing) dialogRef.current?.showModal();
  }, [removing]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((i) => `${i.hostname} ${i.role} ${i.enabled ? 'enabled' : 'disabled'}`.toLowerCase().includes(t)) : items;
  }, [items, q]);

  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>Role URLs</h2><p role="alert">Only Super Admins can view or change Role URLs.</p></section>;

  const open = (item) => {
    if (dirty && !window.confirm('Discard unsaved Role URL changes?')) return;
    const base = item ? { hostname: item.hostname, role: item.role, enabled: item.enabled } : EMPTY;
    setEditing({ id: item?.id || null, version: item?.version, base }); setDraft(base); setError(''); setBlocked(false); setNotice('');
  };
  const cancel = () => { if (dirty && !window.confirm('Discard unsaved Role URL changes?')) return; setEditing(null); setError(''); setBlocked(false); };
  const fail = (e) => {
    if (e?.status === 409) { setBlocked(true); setError('Another change was saved first. Your draft is kept. Reload and review the current list before saving again.'); }
    else if (e?.ambiguous) { setBlocked(true); setError('The result of this save is uncertain. It will not be retried automatically. Reload to check whether it was saved.'); }
    else setError(e?.message || 'Save failed. Your draft is kept.');
  };
  const save = async (e) => {
    e.preventDefault();
    if (busy || blocked) return;
    const body = { hostname: draft.hostname.trim().toLowerCase(), role: draft.role.trim(), enabled: draft.enabled };
    if (!body.hostname || !body.role) { setError('Hostname and role are required.'); return; }
    setBusy(true); setError('');
    try {
      await roleUrlRequest(editing.id ? `/${editing.id}/edit` : '', editing.id ? { ...body, version: editing.version } : body);
      setEditing(null); setNotice('Role URL saved.');
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const reload = async () => {
    if (await load()) {
      setError('');
      if (editing) {
        setEditing((c) => ({ ...c, stale: true }));
        setBlocked(true);
      } else setBlocked(false);
    }
  };
  const current = editing?.id ? items.find((item) => item.id === editing.id) : null;
  const review = () => {
    if (editing.id && !current) return;
    setEditing({ ...editing, version: current?.version, base: current ? { hostname: current.hostname, role: current.role, enabled: current.enabled } : EMPTY, stale: false });
    setBlocked(false);
    setNotice('Current mapping reviewed. Your draft is kept; saving will use the reviewed version.');
  };
  const closeRemoval = () => {
    setRemoving(null);
    requestAnimationFrame(() => removeTrigger.current?.focus());
  };
  const toggle = async (item) => {
    setBusy(true); setNotice(''); setError('');
    try { await roleUrlRequest(`/${item.id}/edit`, { hostname: item.hostname, role: item.role, enabled: !item.enabled, version: item.version }); setNotice(`${item.hostname} ${item.enabled ? 'disabled' : 'enabled'}.`); await load(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await roleUrlRequest(`/${removing.id}/delete`, { version: removing.version }); setNotice(`${removing.hostname} removed.`); closeRemoval(); await load(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  return <section className="admin-panel admin-settings__section role-urls" aria-labelledby="role-urls-heading" aria-busy={status === 'loading'}>
    <h2 id="role-urls-heading" ref={headRef}>Role URLs <span className="role-urls__tag">Shared setting</span></h2>
    <p>These mappings are stored centrally and apply to every user, not just this browser. A hostname here is only a label for choosing a role. It does not register a domain, configure DNS or HTTPS, or mean a deployment is ready. Doctor remains a mock preview.</p>
    <div className="role-urls__bar">
      <label className="role-urls__search"><span className="role-urls__sr">Search role URLs</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hostname or role" data-testid="input-role-url-search" /></label>
      <button type="button" onClick={() => open(null)} disabled={busy || blocked || status !== 'ready'} data-testid="button-role-url-add">Add Role URL</button>
      <button type="button" onClick={reload} disabled={busy || status === 'loading'} data-testid="button-role-url-reload">Reload</button>
    </div>
    <div role="status" className="role-urls__notice">{notice}</div>
    {error && !editing && <p role="alert" className="role-urls__error">{error} {status === 'error' && <button type="button" onClick={load} data-testid="button-role-url-retry">Retry</button>}</p>}
    {editing && <form className="role-urls__form" onSubmit={save} aria-label={editing.id ? 'Edit Role URL' : 'Add Role URL'} data-testid="form-role-url">
      <label>Hostname<input value={draft.hostname} onChange={(e) => setDraft({ ...draft, hostname: e.target.value })} required maxLength={270} autoComplete="off" placeholder="mr.allergyevexia.com" data-testid="input-role-url-hostname" /></label>
      <label>Role<select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} required data-testid="input-role-url-role">
        <option value="admin">Admin</option><option value="mr">MR</option><option value="doctor">Doctor (mock preview)</option>
      </select></label>
      <label className="role-urls__check"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} data-testid="checkbox-role-url-enabled" />Enabled</label>
      {error && <p role="alert" className="role-urls__error">{error}</p>}
      {editing.stale && <div role="status">
        <p>{editing.id ? current ? `Current server mapping: ${current.hostname}, ${current.role}, ${current.enabled ? 'enabled' : 'disabled'} (version ${current.version}). Compare with your draft before continuing.` : 'This mapping was removed. Cancel this draft and add a new mapping if needed.' : 'Compare your draft with the reloaded list. If this hostname was already saved, cancel and edit that mapping instead.'}</p>
        {(!editing.id || current) && <button type="button" onClick={review}>I reviewed the current mappings; keep my draft</button>}
      </div>}
      <div className="role-urls__actions">
        <button type="submit" disabled={busy || blocked || status !== 'ready' || (editing.id && !dirty)} data-testid="button-role-url-save">{busy ? 'Saving...' : 'Save'}</button>
        {blocked && <button type="button" onClick={reload} disabled={busy} data-testid="button-role-url-review">Reload to review</button>}
        <button type="button" onClick={cancel} disabled={busy} data-testid="button-role-url-cancel">Cancel</button>
      </div>
    </form>}
    {status === 'loading' ? <p className="role-urls__skeleton" data-testid="status-role-urls-loading">Loading Role URLs...</p>
      : status === 'error' ? null
      : shown.length === 0 ? <p className="role-urls__empty">{items.length ? 'No Role URLs match your search.' : 'No Role URLs yet. Add one to map a hostname to a role.'}</p>
      : <ul className="role-urls__list">{shown.map((i) => <li key={i.id} data-testid={`row-role-url-${i.id}`}>
        <div><strong>{i.hostname}</strong><small>Role: {i.role} - {i.enabled ? 'Enabled' : 'Disabled'}</small></div>
        <div className="role-urls__actions">
          <button type="button" onClick={() => open(i)} disabled={busy || blocked} aria-label={`Edit ${i.hostname}`}>Edit</button>
          <button type="button" onClick={() => toggle(i)} disabled={busy || blocked || Boolean(editing)} aria-label={`${i.enabled ? 'Disable' : 'Enable'} ${i.hostname}`}>{i.enabled ? 'Disable' : 'Enable'}</button>
          <button type="button" onClick={(event) => { removeTrigger.current = event.currentTarget; setRemoving(i); }} disabled={busy || blocked || Boolean(editing)} aria-label={`Remove ${i.hostname}`}>Remove</button>
        </div></li>)}</ul>}
    {removing && <dialog ref={dialogRef} onCancel={(e) => { e.preventDefault(); if (!busy) closeRemoval(); }} role="alertdialog" aria-labelledby="role-url-rm" className="role-urls__confirm" data-testid="dialog-role-url-remove">
      <p id="role-url-rm">Remove {removing.hostname}? This changes the shared mapping for every user.</p>
      <div className="role-urls__actions">
        {error && <p role="alert">{error}</p>}
        <button type="button" autoFocus onClick={closeRemoval} disabled={busy}>Keep</button>
        <button type="button" onClick={remove} disabled={busy || blocked} data-testid="button-role-url-confirm-remove">{busy ? 'Removing...' : 'Remove'}</button>
      </div></dialog>}
    <h3>Connect each hostname separately</h3>
    <p>Your deployment operator must bind the domain, configure DNS, enable HTTPS, serve portal deep links with an SPA fallback, and reverse-proxy <code>/api</code> on the same origin. Saving here performs none of those steps. Keep an unchanged, unmapped main-domain Admin URL available for recovery. There is no cross-domain sign-in.</p>
  </section>;
}
