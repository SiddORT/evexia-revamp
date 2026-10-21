import { useEffect, useRef, useState } from 'react';
import MessageTemplateEditor from './MessageTemplateEditor.jsx';
import MessageTemplateDrawer from './MessageTemplateDrawer.jsx';
import MessageTemplatePreview from './MessageTemplatePreview.jsx';
import { loadEmailTemplates, getEmailTemplate, deleteEmailTemplate } from '../../services/emailTemplates.js';

export default function EmailTemplateLibrary({ guard, onDirtyChange, onBusyChange }) {
  const [snap, setSnap] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [editor, setEditor] = useState(null), [view, setView] = useState(null), [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [delError, setDelError] = useState('');
  const [uncertainDelete, setUncertainDelete] = useState(false);
  const [q, setQ] = useState(''), [source, setSource] = useState('all'), [pane, setPane] = useState('preview');
  const alive = useRef(true), request = useRef(0), selection = useRef(0), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1; selection.current += 1; }; }, []);
  const load = async () => {
    const n = ++request.current; setLoading(true); setError('');
    try { const latest = await loadEmailTemplates(); if (alive.current && n === request.current) { setSnap(latest); return latest; } }
    catch (e) { if (alive.current && n === request.current) setError(e.message); }
    finally { if (alive.current && n === request.current) setLoading(false); }
    return null;
  };
  useEffect(() => { void load(); }, []);
  const refresh = async () => {
    if (locked.current) return;
    const latest = await load();
    if (latest && del) {
      const row = latest.record.templates.find((t) => t.id === del.id);
      if (!row) { setDel(null); setStatus('Template is absent in the latest database list.'); }
      else { setDel(row); setDelError('Latest saved version loaded. Review before explicitly deleting again.'); setUncertainDelete(false); }
    }
  };
  const select = async (row, editing, discardConfirmed = false) => {
    if (locked.current || (!discardConfirmed && !await guard()) || !alive.current || locked.current) return;
    const n = ++selection.current; setError('');
    locked.current = true; setBusy(true); onBusyChange(true);
    // Keep the existing editor mounted until a complete detail read succeeds.
    try {
      const fresh = await getEmailTemplate(row.id);
      if (!alive.current || n !== selection.current) return;
      onDirtyChange(false); setDel(null);
      if (editing) { setView(null); setEditor({ key: crypto.randomUUID(), draft: fresh }); }
      else { setEditor(null); setView(fresh); setPane('preview'); }
    } catch (e) { if (alive.current && n === selection.current) setError(e.message); }
    finally { if (alive.current && n === selection.current) { locked.current = false; setBusy(false); onBusyChange(false); } }
  };
  const blank = async () => {
    if (locked.current || !await guard() || !alive.current || locked.current) return;
    selection.current += 1; setView(null); setDel(null); setStatus('');
    onDirtyChange(false);
    setEditor({ key: crypto.randomUUID(), draft: { id: null, creationId: crypto.randomUUID(), channel: 'email', eventKey: null, name: '', description: '', content: { subject: '', html: '', text: '' } } });
  };
  const close = async () => { if (locked.current || !await guard() || !alive.current || locked.current) return; selection.current += 1; onDirtyChange(false); setEditor(null); setView(null); };
  const saved = (latest) => { request.current += 1; setLoading(false); onDirtyChange(false); setSnap(latest); setEditor(null); setView(null); setStatus('Email template saved to the shared database.'); };
  const remove = async () => {
    if (locked.current || uncertainDelete) return;
    locked.current = true; setBusy(true); onBusyChange(true); setDelError('');
    try { const latest = await deleteEmailTemplate(del); if (alive.current) { request.current += 1; setLoading(false); setSnap(latest); setDel(null); setStatus('Email template deleted from the shared database.'); } }
    catch (e) { if (alive.current) { setDelError(e.message); setUncertainDelete(true); } }
    finally { locked.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  };
  const all = snap?.record.templates || [];
  const items = all.filter((t) => (source === 'all' || t.source === source) && t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return <>
    <div className="mt-head"><p className="mt-note">Email templates are shared database records. Staff/MR invitations use account_invitation; recovery requests use password_recovery through the approved SMTP server.</p>
      <div className="mt-row"><button type="button" className="admin-button" onClick={blank} disabled={!snap || loading || busy} data-testid="button-template-new">New email template</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} disabled={loading || busy}>Load latest</button></div></div>
    <p className="mt-note">Unassigned templates are not triggered. Required invitation and recovery templates cannot be removed or reassigned. Saved edits apply to subsequent sends. Browser-local email records are not imported or erased.</p>
    <p className="mt-note">Delivery accepts only supported literal variables and safe formatting. Use {'{{reset_url}}'} for every recovery link and {'{{expiry_minutes}}'} in HTML and text. Previews remain offline and links are inert; preview samples are fictional.</p>
    {loading && <p role="status">Loading email templates…</p>}
    {error && <div role="alert" className="admin-feedback admin-feedback--error">{error}<button type="button" onClick={refresh} disabled={loading}>Retry loading</button></div>}
    {status && <p role="status" data-testid="text-template-status">{status}</p>}
    {snap && <><div className="mt-filters"><label className="mt-field"><span>Search templates by name</span><input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} data-testid="input-template-search" /></label>
      <label className="mt-field"><span>Source</span><select value={source} onChange={(e) => setSource(e.target.value)} data-testid="select-template-source"><option value="all">All</option><option value="system">Required</option><option value="user">User</option></select></label></div>
      <p role="status" className="mt-note">{items.length} of {all.length} templates shown{error ? ' (last loaded list; reload before editing)' : ''}</p>
      {!items.length && <p className="admin-empty">No templates match.</p>}
      <ul className="mt-list">{items.map((t) => <li className="mt-card" key={t.id} data-testid={`card-template-${t.id}`}>
        <div className="mt-tags"><span className="mt-tag">{t.protected ? 'Required template' : 'User template'}</span><span className="mt-tag">Email</span><span className="mt-tag">Event: {t.eventKey || 'Unassigned — not triggered'}</span></div>
        <h3>{t.name}</h3><p>{t.description}</p><div className="mt-row">
          <button type="button" disabled={busy || loading} onClick={() => select(t, false)} data-testid={`button-preview-template-${t.id}`}>Preview</button>
          <button type="button" disabled={busy || loading} onClick={() => select(t, true)} data-testid={`button-edit-template-${t.id}`}>Edit</button>
          {!t.protected && <button type="button" disabled={busy || loading} onClick={async () => { if (await guard() && alive.current && !locked.current) { selection.current += 1; onDirtyChange(false); setEditor(null); setView(null); setDel(t); setDelError(''); setUncertainDelete(false); } }} data-testid={`button-delete-template-${t.id}`}>Delete</button>}</div></li>)}</ul></>}
    {del && <div role="alertdialog" aria-labelledby="mt-del-h" className="admin-feedback mt-del"><strong id="mt-del-h">Delete {del.name}?</strong> This removes the shared database template for all browsers.
      {delError && <p role="alert">{delError}</p>}<div className="mt-row"><button type="button" disabled={busy || uncertainDelete} onClick={remove} data-testid="button-confirm-delete-template">Delete</button>
        <button type="button" disabled={busy} onClick={() => setDel(null)}>Cancel</button>{delError && <button type="button" disabled={busy || loading} onClick={refresh}>Load latest before retrying</button>}</div></div>}
    {(editor || view) && <MessageTemplateDrawer onRequestClose={close} title={editor ? `${editor.draft.id ? 'Edit' : 'New'} email template` : view.name}
      subtitle={editor ? 'Changes are saved to the shared database. No email is sent by this editor.' : `Read-only preview · Event: ${view.eventKey || 'Unassigned — not triggered'}`}>
      {error && <div role="alert" className="admin-feedback admin-feedback--error">{error} Your open draft or preview is unchanged.</div>}
      {editor ? <MessageTemplateEditor key={editor.key} draft={editor.draft} externalBusy={busy} events={snap?.record.events || []} onClose={close} onSaved={saved}
        onDirtyChange={onDirtyChange} onBusyChange={(b) => { locked.current = b; onBusyChange(b); }}
        onReopenLatest={(id) => select({ id }, true, true)} />
        : <><div className="mt-row"><button type="button" className="admin-button" onClick={() => select(view, true)} data-testid="button-drawer-edit-template">Edit</button></div>
          <div className="mt-seg" role="group" aria-label="View"><button type="button" aria-pressed={pane === 'code'} onClick={() => setPane('code')}>Code</button><button type="button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>Preview</button></div>
          <div className="mt-split" data-pane={pane}><div className="mt-pane mt-pane--code mt-field"><label htmlFor="mt-ro-html">HTML source (read-only)</label>
            <textarea id="mt-ro-html" className="mt-ro" readOnly value={view.content.html} data-testid="text-template-source" /></div>
            <div className="mt-pane mt-pane--view"><MessageTemplatePreview channel="email" content={view.content} eventKey={view.eventKey} idPrefix="mtv" /></div></div></>}
    </MessageTemplateDrawer>}
  </>;
}
