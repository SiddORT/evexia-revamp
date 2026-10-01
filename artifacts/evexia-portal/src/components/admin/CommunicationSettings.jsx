import { useState } from 'react';
import './communicationSettings.css';
import Dialog from './Dialog.jsx';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import CommunicationForm, { CHANNEL_LABELS, TYPE_LABELS } from './CommunicationForm.jsx';
import { CHANNELS, loadCommunicationSnapshot, saveConfiguration, chooseCommunicationDefault, deleteConfiguration, resetCommunication } from '../../services/communicationSettings.js';

function load() {
  try { return { snapshot: loadCommunicationSnapshot(), error: '', raw: null }; }
  catch (e) { return { snapshot: null, error: e?.message || 'Saved communication metadata could not be read.', raw: e?.snapshot || null }; }
}
const safeMsg = (e, d) => ({ message: e?.message || d, fields: e?.fields || {} });
const isStale = (e) => e?.code === 'conflict' || /\b(changed|stale|conflict)\b/i.test(e?.message || '');
const SAVED = 'Saved metadata only. No credentials saved. No connections made.';

export default function CommunicationSettings() {
  const [state, setState] = useState(load);
  const [channel, setChannel] = useState('email');
  const [editor, setEditor] = useState(null);
  const [formError, setFormError] = useState(null);
  const [del, setDel] = useState(null);
  const [replacement, setReplacement] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [delError, setDelError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const { snapshot } = state;
  const data = snapshot?.record.channels[channel];
  const items = data?.configurations || [];

  const onTabKey = (e, i) => {
    let idx = null;
    if (e.key === 'ArrowRight') idx = (i + 1) % CHANNELS.length;
    else if (e.key === 'ArrowLeft') idx = (i - 1 + CHANNELS.length) % CHANNELS.length;
    else if (e.key === 'Home') idx = 0;
    else if (e.key === 'End') idx = CHANNELS.length - 1;
    if (idx === null) return;
    e.preventDefault();
    setChannel(CHANNELS[idx]);
    document.getElementById(`comm-tab-${CHANNELS[idx]}`)?.focus();
  };

  // Explicit reload: refreshes data, clears obsolete errors, closes dialogs that depend on old data.
  // Never saves. An open editor stays open with its non-secret values.
  const reload = () => {
    const next = load();
    setState(next);
    setError(''); setDelError(''); setResetError(''); setStatus('');
    setDel(null); setResetting(false);
    if (editor) {
      if (!next.snapshot) setFormError({ message: `${next.error} Retry loading to continue; saving is blocked until storage is read.`, fields: {}, stale: false, load: true });
      else if (editor.id && !next.snapshot.record.channels[channel].configurations.some((c) => c.id === editor.id)) {
        setEditor({ ...editor, missing: true });
        setFormError({ message: 'The configuration you were editing no longer exists. Your entries are kept. Save as new to add them, or cancel.', fields: {}, stale: false, missing: true });
      } else setFormError({ message: 'Latest settings loaded. Review your entries, then save again.', fields: {}, stale: false, info: true });
    } else setFormError(null);
  };
  const closeEditor = () => { setEditor(null); setFormError(null); };
  const submit = (input) => {
    if (!snapshot) { setFormError({ message: 'Storage has not been read. Retry loading before saving.', fields: {}, load: true }); return; }
    if (editor.missing) { setFormError({ message: 'The edited configuration no longer exists. Choose Save as new or cancel.', fields: {}, missing: true }); return; }
    try {
      const next = saveConfiguration(snapshot, channel, input, editor.id);
      setState({ snapshot: next, error: '', raw: null });
      setEditor(null); setFormError(null); setError('');
      setStatus(SAVED);
    } catch (e) { setFormError({ ...safeMsg(e, 'Could not save configuration.'), stale: isStale(e) }); }
  };
  const makeDefault = (id) => {
    try { setState({ snapshot: chooseCommunicationDefault(snapshot, channel, id), error: '', raw: null }); setStatus('Default updated.'); setError(''); }
    catch (e) { setError(safeMsg(e, 'Could not change default.').message); }
  };
  const startDelete = (c) => { setDel(c); setReplacement(''); setDelConfirm(false); setDelError(''); };
  const runDelete = () => {
    const others = items.filter((c) => c.id !== del.id);
    const needs = data.defaultId === del.id && others.length > 0;
    if (needs && !replacement) { setDelError('Choose a replacement default first.'); return; }
    if (needs && !delConfirm) { setDelError('Confirm the change of default.'); return; }
    try { setState({ snapshot: deleteConfiguration(snapshot, channel, del.id, needs ? replacement : null), error: '', raw: null }); setDel(null); setError(''); setStatus('Configuration deleted.'); }
    catch (e) { setDelError(safeMsg(e, 'Could not delete configuration.').message); }
  };
  const runReset = () => {
    const target = state.snapshot || state.raw;
    if (!target) { setResetError('Storage has not been read. Retry loading first.'); return; }
    try { setState({ snapshot: resetCommunication(target), error: '', raw: null }); setResetting(false); setResetError(''); setError(''); setStatus('Communication settings reset.'); }
    catch (e) { setResetError(safeMsg(e, 'Could not reset.').message); }
  };
  const retryBtn = (label = 'Load latest settings') => <button type="button" className="admin-button admin-button--secondary" onClick={reload} data-testid="button-communication-reload">{label}</button>;

  const editing = editor?.initial || null;
  const recovery = formError && !formError.info && !formError.missing ? { label: formError.load ? 'Retry loading' : formError.stale ? 'Load latest settings' : 'Retry loading', run: reload } : null;
  const extra = formError?.missing ? <button type="button" className="admin-button admin-button--secondary" onClick={() => { setEditor({ id: null, key: editor.key }); setFormError(null); }} data-testid="button-communication-save-as-new">Save as new configuration</button> : null;
  const others = del ? items.filter((c) => c.id !== del.id) : [];
  const needsRepl = !!del && data?.defaultId === del.id && others.length > 0;
  const resetBlocked = !state.snapshot && !state.raw;

  return <section className="admin-panel admin-settings__section comm" aria-labelledby="comm-heading">
    <div className="comm__head">
      <div><h2 id="comm-heading">Communication</h2><p>Preview of sender configuration for Email, SMS and WABA (WhatsApp Business API).</p></div>
      {snapshot && <div className="comm__actions">
         <button type="button" className="admin-button" onClick={() => { setFormError(null); setEditor({ id: null, key: Date.now() }); }} data-testid="button-add-communication">Add configuration</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => { setResetError(''); setResetting(true); }} data-testid="button-communication-reset">Reset</button>
      </div>}
    </div>
    <p className="comm__warn" data-testid="text-communication-page-warning">Use dummy values only. Never enter real credentials or account details.</p>
    <p className="comm__notice">Demo only. Saved cards hold metadata only, are unconnected, and no credentials are saved. Nothing is sent from this browser.</p>
    <div aria-live="polite">{status && <div className="admin-feedback" data-testid="text-communication-status">{status}</div>}</div>
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error} {retryBtn()}</div>}
    {!snapshot ? <div data-testid="panel-communication-error">
      <div className="admin-feedback admin-feedback--error" role="alert">{state.error}</div>
      <div className="comm__actions">
        {retryBtn('Retry loading')}
        <button type="button" className="admin-button admin-button--danger" disabled={resetBlocked} onClick={() => { setResetError(''); setResetting(true); }} data-testid="button-communication-reset-unreadable">Reset Communication settings</button>
      </div>
      {resetBlocked && <p className="comm__hint">Reset is unavailable until storage can be read. Retry first.</p>}
    </div> : <>
      <div className="admin-tabs" role="tablist" aria-label="Communication channels">
        {CHANNELS.map((c, i) => <button key={c} type="button" role="tab" id={`comm-tab-${c}`} aria-selected={channel === c} aria-controls="comm-panel" tabIndex={channel === c ? 0 : -1} onClick={() => setChannel(c)} onKeyDown={(e) => onTabKey(e, i)} data-testid={`tab-communication-${c}`}>{CHANNEL_LABELS[c]}</button>)}
      </div>
      <div role="tabpanel" id="comm-panel" aria-labelledby={`comm-tab-${channel}`}>
        {channel === 'email' && <p className="comm__hint">One default is shared across SMTP, API and Platform types.</p>}
        {items.length === 0 ? <div className="admin-empty" data-testid="empty-communication"><strong>No {CHANNEL_LABELS[channel]} configurations</strong><p>Add one to preview how sender metadata is recorded.</p></div>
        : <ul className="comm__list">{items.map((c) => {
          const isDef = data.defaultId === c.id;
          return <li key={c.id} className={`comm__card${isDef ? ' comm__card--default' : ''}`} data-testid={`card-communication-${c.id}`}>
            <div className="comm__card-body">
              <div className="comm__tags">{isDef && <span className="comm__tag comm__tag--default">Default</span>}<span className="comm__tag">{TYPE_LABELS[c.type] || c.type}</span><span className="comm__tag">Metadata only</span><span className="comm__tag">Unconnected</span></div>
              <h3>{c.name}</h3>
              <dl>
                {c.provider && <div><dt>Provider</dt><dd>{c.provider}</dd></div>}
                {(c.host || c.endpoint) && <div><dt>{c.host ? 'Host' : 'Endpoint'}</dt><dd>{c.host ? `${c.host}${c.port ? `:${c.port}` : ''}` : c.endpoint}</dd></div>}
                {(c.fromEmail || c.senderId || c.senderPhone) && <div><dt>Sender</dt><dd>{c.fromEmail || c.senderId || c.senderPhone}</dd></div>}
              </dl>
              <span className="comm__hint">No credentials saved.</span>
            </div>
            <div className="comm__card-foot">
              <button type="button" onClick={() => { setFormError(null); setEditor({ id: c.id, key: Date.now(), initial: c }); }} data-testid={`button-edit-communication-${c.id}`}>Edit</button>
              <button type="button" disabled={isDef} onClick={() => makeDefault(c.id)} data-testid={`button-default-communication-${c.id}`}>{isDef ? 'Default' : 'Make default'}</button>
              <button type="button" onClick={() => startDelete(c)} data-testid={`button-delete-communication-${c.id}`}>Delete</button>
            </div>
          </li>;
        })}</ul>}
      </div>
    </>}
    {editor && <Dialog className="comm__dialog" title={editor.id ? 'Edit configuration' : 'Add configuration'} eyebrow={CHANNEL_LABELS[channel]} description="Metadata only. Nothing connects or sends." onClose={closeEditor}>
      <CommunicationForm key={`${channel}-${editor.key}`} channel={channel} initial={editing} editing={!!editor.id || !!editor.missing} error={formError} recovery={recovery} extra={extra} blocked={!snapshot || !!editor.missing} onSubmit={submit} onCancel={closeEditor} onTypeChange={() => setFormError(null)} />
    </Dialog>}
    {del && <Dialog title="Delete configuration" eyebrow={CHANNEL_LABELS[channel]} description={`Delete ${del.name}? This only removes browser-local metadata.`} onClose={() => setDel(null)} footer={<>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setDel(null)}>Cancel</button>
      <button type="button" className="admin-button admin-button--danger" onClick={runDelete} data-testid="button-confirm-delete-communication">Delete</button></>}>
      {needsRepl && <div className="comm__form">
        <p className="comm__warn" role="alert">Warning: this is the default {CHANNEL_LABELS[channel]} configuration. Choose a replacement default.</p>
        <fieldset className="comm__radios"><legend>Replacement default</legend>
          {others.map((o) => <label key={o.id}><input type="radio" name="comm-repl" value={o.id} checked={replacement === o.id} onChange={() => setReplacement(o.id)} />{o.name}</label>)}</fieldset>
        <label className="comm__radios"><span style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={delConfirm} onChange={(e) => setDelConfirm(e.target.checked)} />I confirm the default will change.</span></label>
      </div>}
      {delError && <div className="admin-feedback admin-feedback--error" role="alert">{delError} {retryBtn()}</div>}
    </Dialog>}
    {resetting && <ConfirmationDialog title="Reset Communication settings?" description="Only saved Communication metadata is replaced. Other settings are untouched." actionLabel="Reset" destructive error={resetError ? <>{resetError} {retryBtn()}</> : ''} onConfirm={runReset} onClose={() => setResetting(false)} />}
  </section>;
}
