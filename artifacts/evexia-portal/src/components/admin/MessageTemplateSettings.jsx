import { useCallback, useEffect, useRef, useState } from 'react';
import './messageTemplates.css';
import MessageTemplateEditor from './MessageTemplateEditor.jsx';
import MessageTemplatePreview from './MessageTemplatePreview.jsx';
import EmailTemplateLibrary from './EmailTemplateLibrary.jsx';
import { MESSAGE_TEMPLATES_KEY, SYSTEM_TEMPLATES, deleteMessageTemplate, loadMessageTemplates } from '../../services/messageTemplates.js';

function loadSms() {
  try { return { snap: loadMessageTemplates(), error: '' }; }
  catch (e) { return { snap: null, error: e?.message || 'Saved SMS templates could not be read.' }; }
}
const CHANNELS = [['email', 'Email'], ['sms', 'SMS']];

export default function MessageTemplateSettings({ onGuardChange }) {
  const [channel, setChannel] = useState('email');
  const dirty = useRef(false);
  const busy = useRef(false);
  const guard = useCallback(() => {
    if (busy.current) return false;
    if (dirty.current && !window.confirm('You have unsaved template changes. Discard them?')) return false;
    return true;
  }, []);
  const parentGuard = useRef(onGuardChange); parentGuard.current = onGuardChange;
  useEffect(() => { parentGuard.current?.(guard); return () => parentGuard.current?.(null); }, [guard]);
  useEffect(() => {
    const unload = (e) => { if (dirty.current || busy.current) { e.preventDefault(); e.returnValue = ''; } };
    const click = (e) => {
      if ((!dirty.current && !busy.current) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.origin !== window.location.origin ||
          (a.pathname === window.location.pathname && a.search === window.location.search)) return;
      if (!guard()) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [guard]);
  const choose = (c) => { if (c !== channel && guard()) { dirty.current = false; busy.current = false; setChannel(c); } };
  const keyboard = (e, i) => {
    const next = ['ArrowRight', 'ArrowLeft'].includes(e.key) ? (i + 1) % 2 : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : null;
    if (next === null) return;
    e.preventDefault(); choose(CHANNELS[next][0]); document.getElementById(`mt-tab-${CHANNELS[next][0]}`)?.focus();
  };
  return <section className="admin-panel admin-settings__section mt" aria-labelledby="mt-heading">
    <h2 id="mt-heading">Email and SMS templates</h2>
    <div className="admin-tabs" role="tablist" aria-label="Template channel">{CHANNELS.map(([c, label], i) =>
      <button key={c} type="button" role="tab" id={`mt-tab-${c}`} aria-selected={channel === c} aria-controls="mt-panel"
        tabIndex={channel === c ? 0 : -1} onClick={() => choose(c)} onKeyDown={(e) => keyboard(e, i)} data-testid={`tab-template-${c}`}>{label}</button>)}</div>
    <div role="tabpanel" id="mt-panel" aria-labelledby={`mt-tab-${channel}`}>
      {channel === 'email' ? <EmailTemplateLibrary guard={guard} onDirtyChange={(d) => { dirty.current = d; }} onBusyChange={(b) => { busy.current = b; }} />
        : <SmsLibrary guard={guard} onDirtyChange={(d) => { dirty.current = d; }} onBusyChange={(b) => { busy.current = b; }} />}
    </div>
  </section>;
}

function SmsLibrary({ guard, onDirtyChange, onBusyChange }) {
  const [lib, setLib] = useState(loadSms);
  const [editor, setEditor] = useState(null), [view, setView] = useState(null), [del, setDel] = useState(null);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''), [source, setSource] = useState('all');
  useEffect(() => {
    const storage = (e) => { if (e.key === null || e.key === MESSAGE_TEMPLATES_KEY) setLib(loadSms()); };
    window.addEventListener('storage', storage); return () => window.removeEventListener('storage', storage);
  }, []);
  const open = (draft) => { if (!guard()) return; const l = loadSms(); onDirtyChange(false); setEditor({ key: Date.now(), draft, baseline: l.snap, loadError: l.error }); setView(null); setDel(null); setStatus(''); };
  const close = () => { onDirtyChange(false); setEditor(null); setLib(loadSms()); };
  const all = [...SYSTEM_TEMPLATES, ...(lib.snap?.record.templates || [])].filter((t) => t.channel === 'sms');
  const items = all.filter((t) => (source === 'all' || source === t.source) && t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const reopen = (id) => { const l = loadSms(); setLib(l); const t = l.snap?.record.templates.find((r) => r.id === id && r.channel === 'sms'); if (t) { onDirtyChange(false); setEditor({ key: Date.now(), draft: t, baseline: l.snap, loadError: l.error }); } else if (!l.error) close(); };
  const remove = async () => {
    if (busy) return;
    setBusy(true); onBusyChange(true);
    try { const snap = await deleteMessageTemplate(del.baseline, del.tpl.id); setLib({ snap, error: '' }); setDel(null); setStatus('SMS template deleted from this browser.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <>
    <div className="mt-head"><p className="mt-note">SMS authoring and preview only. SMS templates remain in this browser; nothing is sent.</p>
      <button type="button" className="admin-button" onClick={() => open({ id: null, channel: 'sms', name: '', description: '', content: { body: '', providerTemplateId: '' } })} data-testid="button-template-new">New SMS template</button></div>
    <p className="mt-note">SMS examples are not connected to backend events. Saving does not register or approve a DLT template. Enter your own provider reference.</p>
    {status && <p role="status">{status}</p>}
    {lib.error && <div role="alert">{lib.error}<button type="button" onClick={() => setLib(loadSms())}>Retry loading</button></div>}
    {editor ? <MessageTemplateEditor key={editor.key} {...editor} latestRevision={lib.snap?.record.revision} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange}
      onClose={close} onReopenLatest={reopen} onSaved={(snap) => { onDirtyChange(false); setLib({ snap, error: '' }); setEditor(null); setStatus('SMS template saved to this browser.'); }} /> : <>
      <div className="mt-filters"><label className="mt-field"><span>Search templates by name</span><input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} data-testid="input-template-search" /></label>
        <label className="mt-field"><span>Source</span><select value={source} onChange={(e) => setSource(e.target.value)} data-testid="select-template-source"><option value="all">All</option><option value="system">System</option><option value="user">User</option></select></label></div>
      <p role="status" className="mt-note">{items.length} of {all.length} templates shown</p>
      {!items.length && <p className="admin-empty">No templates match.</p>}
      <ul className="mt-list">{items.map((t) => <li key={t.id} className="mt-card" data-testid={`card-template-${t.id}`}>
        <div className="mt-tags"><span className="mt-tag">{t.source === 'system' ? 'System example' : 'User template'}</span><span className="mt-tag">SMS</span><span className="mt-tag">Provider/DLT ID: {t.content.providerTemplateId || 'unassigned, unregistered'}</span></div>
        <h3>{t.name}</h3><p>{t.description}</p><div className="mt-row">
          <button type="button" aria-expanded={view?.id === t.id} onClick={() => setView(view?.id === t.id ? null : t)} data-testid={`button-preview-template-${t.id}`}>{view?.id === t.id ? 'Hide preview' : 'Preview'}</button>
          {t.source === 'user' && <><button type="button" onClick={() => open(t)} data-testid={`button-edit-template-${t.id}`}>Edit</button>
            <button type="button" onClick={() => { const l = loadSms(); setDel({ tpl: t, baseline: l.snap }); setError(l.error); }} data-testid={`button-delete-template-${t.id}`}>Delete</button></>}</div>
        {view?.id === t.id && <MessageTemplatePreview channel="sms" content={t.content} idPrefix="mtv" />}</li>)}</ul>
      {del && <div role="alertdialog" aria-labelledby="mt-del-h" className="admin-feedback mt-del"><strong id="mt-del-h">Delete {del.tpl.name}?</strong> This removes it from this browser only.
        {error && <p role="alert">{error}</p>}<div className="mt-row"><button type="button" disabled={busy || !del.baseline} onClick={remove} data-testid="button-confirm-delete-template">Delete</button><button type="button" disabled={busy} onClick={() => setDel(null)}>Cancel</button>
          {error && <button type="button" onClick={() => { setLib(loadSms()); setDel(null); }}>Reload latest</button>}</div></div>}
    </>}
  </>;
}
