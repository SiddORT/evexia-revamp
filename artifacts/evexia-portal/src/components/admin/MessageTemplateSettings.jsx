import { useCallback, useEffect, useRef, useState } from 'react';
import './messageTemplates.css';
import MessageTemplateEditor from './MessageTemplateEditor.jsx';
import MessageTemplatePreview from './MessageTemplatePreview.jsx';
import { MESSAGE_TEMPLATES_KEY, SYSTEM_TEMPLATES, deleteMessageTemplate, loadMessageTemplates } from '../../services/messageTemplates.js';

function load() {
  try { return { snap: loadMessageTemplates(), error: '' }; }
  catch (e) { return { snap: null, error: e?.message || 'Saved templates could not be read.' }; }
}
const CH = [['email', 'Email'], ['sms', 'SMS']];
const cloneDraft = (t) => ({ copySource: t.source, id: null, channel: t.channel, name: `${t.name} (copy)`, description: t.description, content: { ...t.content }, copyOf: t.id });

export default function MessageTemplateSettings({ onGuardChange }) {
  const [lib, setLib] = useState(load);
  const [channel, setChannel] = useState('email');
  const [editor, setEditor] = useState(null); // {key, draft, baseline, loadError}
  const [view, setView] = useState(null);
  const [del, setDel] = useState(null); // {tpl, baseline}
  const [delErr, setDelErr] = useState('');
  const [status, setStatus] = useState('');
  const dirtyRef = useRef(false);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('all');
  const [delBusy, setDelBusy] = useState(false);

  const guard = useCallback(() => {
    if (!dirtyRef.current) return true;
    if (!window.confirm('You have unsaved template changes. Discard them?')) return false;
    dirtyRef.current = false; return true;
  }, []);
  const guardRef = useRef(onGuardChange); guardRef.current = onGuardChange;
  useEffect(() => { guardRef.current?.(guard); return () => guardRef.current?.(null); }, [guard]);
  useEffect(() => {
    const beforeUnload = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    const click = (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      if (a.origin !== window.location.origin) return;
      if (a.pathname === window.location.pathname && a.search === window.location.search) return;
      if (!guard()) { e.preventDefault(); e.stopPropagation(); }
    };
    const onStorage = (e) => { if (e.key === null || e.key === MESSAGE_TEMPLATES_KEY) setLib(load()); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); window.removeEventListener('storage', onStorage); };
  }, [guard]);

  const users = lib.snap?.record.templates || [];
  const all = [...SYSTEM_TEMPLATES, ...users].filter((t) => t.channel === channel);
  const items = all.filter((t) => (src === 'all' || t.source === src) && t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const open = (draft) => { if (!guard()) return; const l = load(); setStatus(''); setEditor({ key: Date.now(), draft, baseline: l.snap, loadError: l.error }); setView(null); setDel(null); };
  const blank = () => open({ id: null, channel, name: '', description: '', content: channel === 'email' ? { subject: '', html: '', text: '' } : { body: '', providerTemplateId: '' } });
  const closeEditor = () => { dirtyRef.current = false; setEditor(null); setLib(load()); };
  const onTab = (e, i) => {
    let n = null; if (e.key === 'ArrowRight') n = (i + 1) % 2; else if (e.key === 'ArrowLeft') n = (i + 1) % 2; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = 1;
    if (n === null) return; e.preventDefault(); pick(CH[n][0]); document.getElementById(`mt-tab-${CH[n][0]}`)?.focus();
  };
  const pick = (c) => { if (c === channel) return; if (!guard()) return; setEditor(null); setView(null); setDel(null); setChannel(c); };
  const startDel = (t) => { if (!guard()) return; setEditor(null); const l = load(); setDel({ tpl: t, baseline: l.snap, error: l.error }); setDelErr(''); };
  const runDel = async () => {
    if (delBusy) return;
    if (!del.baseline) { setDelErr(del.error || 'Storage could not be read.'); return; }
    setDelBusy(true);
    try { const snap = await deleteMessageTemplate(del.baseline, del.tpl.id); setLib({ snap, error: '' }); setDel(null); setStatus('Template deleted.'); }
    catch (e) { setDelErr(`${e?.message || 'Could not delete.'} Reload the latest list and try again.`); }
    finally { setDelBusy(false); }
  };
  const latestRevision = lib.snap?.record.revision;
  const reopenLatest = (id) => {
    const l = load(); setLib(l); dirtyRef.current = false;
    const t = l.snap?.record.templates.find((x) => x.id === id);
    if (!t) { setEditor(null); setStatus('The template no longer exists.'); return; }
    setEditor({ key: Date.now(), draft: t, baseline: l.snap, loadError: l.error });
  };

  return <section className="admin-panel admin-settings__section mt" aria-labelledby="mt-heading">
    <div className="mt-head"><div><h2 id="mt-heading">Email and SMS templates</h2><p className="mt-note">Authoring and preview only. Templates are stored in this browser and nothing is sent.</p></div>
      <button type="button" className="admin-button" onClick={blank} data-testid="button-template-new">New {channel === 'email' ? 'email' : 'SMS'} template</button></div>
    <div aria-live="polite">{status && <div className="admin-feedback" data-testid="text-template-status">{status}</div>}</div>
    {lib.error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="text-template-load-error">{lib.error} System examples can still be previewed and copied; saving is blocked.
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setLib(load())}>Retry loading</button></div>}
    <div className="admin-tabs" role="tablist" aria-label="Template channel">
      {CH.map(([c, l], i) => <button key={c} type="button" role="tab" id={`mt-tab-${c}`} aria-selected={channel === c} aria-controls="mt-panel" tabIndex={channel === c ? 0 : -1} onClick={() => pick(c)} onKeyDown={(e) => onTab(e, i)} data-testid={`tab-template-${c}`}>{l}</button>)}
    </div>
    <div role="tabpanel" id="mt-panel" aria-labelledby={`mt-tab-${channel}`}>
      {editor && <MessageTemplateEditor key={editor.key} draft={editor.draft} baseline={editor.baseline} loadError={editor.loadError} latestRevision={latestRevision}
        onDirtyChange={(d) => { dirtyRef.current = d; }} onClose={closeEditor} onReopenLatest={reopenLatest}
        onSaved={(snap) => { dirtyRef.current = false; setLib({ snap, error: '' }); setEditor(null); setStatus('Template saved to this browser.'); }} />}
      {!editor && <>
        <div className="mt-notes" data-testid="text-template-notices">
          <p><strong>Token syntax.</strong> Write {'{{token_name}}'} using only supported tokens: recipient_name, order_number, amount, company_name. Unknown or malformed tokens are left as typed and flagged.</p>
          <p><strong>Not wired.</strong> System examples are samples only. They are not connected to any events, triggers or sends.</p>
          <p><strong>Future providers.</strong> Mapping these tokens to provider-specific placeholders (for example numbered or named variables) is not done yet and will be added later.</p>
          <p><strong>SMS and DLT.</strong> Saving a template does not register, submit or approve it with any DLT registry or provider. The ID is a reference you type.</p>
          <p><strong>Email.</strong> There is no guarantee of email-client compatibility. External assets, styles, fonts and images are always blocked in previews.</p>
        </div>
        <div className="mt-filters">
          <label className="mt-field"><span>Search templates by name</span><input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} data-testid="input-template-search" /></label>
          <label className="mt-field"><span>Source</span><select value={src} onChange={(e) => setSrc(e.target.value)} data-testid="select-template-source"><option value="all">All</option><option value="system">System</option><option value="user">User</option></select></label>
        </div>
        <p className="mt-note" aria-live="polite" data-testid="text-template-count">{items.length} of {all.length} templates shown</p>
        {items.length === 0 ? <div className="admin-empty" data-testid="empty-template-list"><strong>{all.length === 0 ? 'No templates' : 'No templates match'}</strong>{all.length > 0 && <p>Change the search or source filter. <button type="button" className="admin-button admin-button--secondary" onClick={() => { setQ(''); setSrc('all'); }}>Clear filters</button></p>}{src === 'user' && all.length === 0 && <p>Create one with the New template button.</p>}</div> :
          <ul className="mt-list">{items.map((t) => <li key={t.id} className="mt-card" data-testid={`card-template-${t.id}`}>
            <div className="mt-tags"><span className="mt-tag">{t.source === 'system' ? 'System example' : 'User template'}</span><span className="mt-tag">{t.channel === 'email' ? 'Email' : 'SMS'}</span>
              {t.channel === 'sms' && <span className="mt-tag">{t.content.providerTemplateId ? `Provider/DLT ID: ${t.content.providerTemplateId}` : 'Provider/DLT ID: unassigned, unregistered'}</span>}</div>
            <h3>{t.name}</h3><p>{t.description}</p>
            <div className="mt-row">
              <button type="button" onClick={() => setView(view?.id === t.id ? null : t)} aria-expanded={view?.id === t.id} data-testid={`button-preview-template-${t.id}`}>{view?.id === t.id ? 'Hide preview' : 'Preview'}</button>
              {t.source === 'user' ? <button type="button" onClick={() => open(t)} data-testid={`button-edit-template-${t.id}`}>Edit</button> : null}
              <button type="button" onClick={() => open(cloneDraft(t))} data-testid={`button-copy-template-${t.id}`}>Copy to draft</button>
              {t.source === 'user' && <button type="button" onClick={() => startDel(t)} data-testid={`button-delete-template-${t.id}`}>Delete</button>}
            </div>
            {view?.id === t.id && <MessageTemplatePreview channel={t.channel} content={t.content} idPrefix="mtv" />}
          </li>)}</ul>}
        {del && <div className="admin-feedback admin-feedback--error mt-del" role="alertdialog" aria-labelledby="mt-del-h">
          <strong id="mt-del-h">Delete {del.tpl.name}?</strong> This removes it from this browser only.
          {delErr && <span role="alert"> {delErr}</span>}
          <div className="mt-row"><button type="button" className="admin-button admin-button--danger" onClick={runDel} disabled={delBusy} data-testid="button-confirm-delete-template">Delete</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => setDel(null)}>Cancel</button>
            {delErr && <button type="button" className="admin-button admin-button--secondary" onClick={() => { setLib(load()); setDel(null); }}>Reload latest</button>}</div></div>}
      </>}
    </div>
  </section>;
}
