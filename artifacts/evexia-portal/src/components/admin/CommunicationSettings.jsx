import { useEffect, useRef, useState } from 'react';
import './communicationSettings.css';
import Dialog from './Dialog.jsx';
import CommunicationForm, { CHANNEL_LABELS, TYPE_LABELS } from './CommunicationForm.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { CHANNELS, loadCommunicationSnapshot, saveConfiguration, chooseCommunicationDefault, deleteConfiguration } from '../../services/communicationSettings.js';

export default function CommunicationSettings() {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const [snapshot, setSnapshot] = useState(null);
  const [channel, setChannel] = useState('email');
  const [editor, setEditor] = useState(null);
  const [formError, setFormError] = useState(null);
  const [del, setDel] = useState(null);
  const [replacement, setReplacement] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const mounted = useRef(true);
  const serial = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    if (allowed) loadCommunicationSnapshot({ signal: controller.signal })
      .then((next) => { if (mounted.current) { setSnapshot(next); setLoading(false); } })
      .catch((e) => { if (mounted.current) { setError(e.message); setLoading(false); } });
    else { setSnapshot(null); setLoading(false); }
    return () => { mounted.current = false; controller.abort(); };
  }, [allowed, session?.user?.id]);

  const data = snapshot?.record.channels[channel];
  const items = data?.configurations || [];
  const reload = async () => {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError(''); setStatus('');
    try {
      const next = await loadCommunicationSnapshot();
      if (!mounted.current) return;
      setSnapshot(next); setDel(null);
      if (editor) {
        setEditor((old) => ({ ...old, review: true }));
        setBlocked(true);
        setFormError({ message: 'Latest settings loaded. Compare the current saved details below with your draft before continuing.' });
      } else setBlocked(false);
    } catch (e) {
      if (mounted.current) { setError(e.message); setBlocked(true); }
    } finally { pending.current = false; if (mounted.current) setLoading(false); }
  };
  const fail = (e, form = false) => {
    const mustReview = e.ambiguous || e.status === 409;
    if (mustReview) setBlocked(true);
    (form ? setFormError : setError)(form ? { message: e.message } : e.message);
  };
  const mutate = async (run, form = false) => {
    if (pending.current || blocked || loading) return;
    pending.current = true; setBusy(true); setError(''); setStatus('');
    try {
      const next = await run();
      if (!mounted.current) return;
      setSnapshot(next); setEditor(null); setDel(null); setFormError(null);
      setStatus('Shared encrypted Communication settings updated. No provider connection or delivery was tested.');
    } catch (e) { if (mounted.current) fail(e, form); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const current = editor?.id ? items.find((c) => c.id === editor.id) : null;
  const review = () => {
    setEditor((old) => ({ ...old, version: current?.version, review: false }));
    setBlocked(false); setFormError(null);
  };
  const closeEditor = () => { if (!pending.current) { setEditor(null); setFormError(null); } };
  const others = del ? items.filter((c) => c.id !== del.id) : [];
  const needsRepl = del && data?.defaultId === del.id && others.length > 0;
  const open = (c = null) => {
    setFormError(null); setStatus('');
    setEditor({ id: c?.id || null, version: c?.version, initial: c, key: ++serial.current });
  };
  const retryBtn = <button type="button" disabled={busy || loading} className="admin-button admin-button--secondary" onClick={reload} data-testid="button-communication-reload">Load latest settings</button>;
  const onTabKey = (e, i) => {
    const index = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : null;
    if (index === null || busy || editor || del) return;
    e.preventDefault(); setChannel(CHANNELS[index]);
    document.getElementById(`comm-tab-${CHANNELS[index]}`)?.focus();
  };
  if (!allowed) return <section className="admin-panel"><h2>Communication</h2><p role="alert">Only Super Admin can view or change Communication settings.</p></section>;
  return <section className="admin-panel admin-settings__section comm" aria-labelledby="comm-heading" aria-busy={loading || busy}>
    <div className="comm__head">
      <div><h2 id="comm-heading">Communication</h2><p>Shared encrypted sender configurations for Email, SMS and WABA.</p></div>
      <div className="comm__actions">{retryBtn}<button type="button" className="admin-button" disabled={!snapshot || busy || loading || blocked || !!editor || !!del} onClick={() => open()} data-testid="button-add-communication">Add configuration</button></div>
    </div>
    <p className="comm__notice">Configuration details and credentials are encrypted in shared storage. Saved credentials are write-only. Saving or selecting a default does not verify connectivity or send messages. Explicit template test emails use the saved default Email SMTP configuration, including its credential and sender, with STARTTLS or TLS only. Missing, unreadable or invalid settings, API/Platform defaults and security set to none prevent test sending without environment fallback. Password recovery and invitations remain separately environment-configured. API/Platform, SMS and WhatsApp delivery are not activated.</p>
    {loading && <p role="status">Loading Communication settings…</p>}
    <div aria-live="polite">{status && <div className="admin-feedback" data-testid="text-communication-status">{status}</div>}</div>
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error} {retryBtn}</div>}
    {snapshot && <>
      <div className="admin-tabs" role="tablist" aria-label="Communication channels">
        {CHANNELS.map((c, i) => <button key={c} type="button" role="tab" id={`comm-tab-${c}`} aria-selected={channel === c} aria-controls="comm-panel" tabIndex={channel === c ? 0 : -1} disabled={busy || !!editor || !!del} onClick={() => setChannel(c)} onKeyDown={(e) => onTabKey(e, i)} data-testid={`tab-communication-${c}`}>{CHANNEL_LABELS[c]}</button>)}
      </div>
      <div role="tabpanel" id="comm-panel" aria-labelledby={`comm-tab-${channel}`}>
        {channel === 'email' && <p className="comm__hint">One default is shared across SMTP, API and Platform types.</p>}
        {items.length === 0 ? <div className="admin-empty" data-testid="empty-communication"><strong>No {CHANNEL_LABELS[channel]} configurations</strong><p>Add a shared encrypted configuration.</p></div>
          : <ul className="comm__list">{items.map((c) => {
            const isDefault = data.defaultId === c.id;
            return <li key={c.id} className={`comm__card${isDefault ? ' comm__card--default' : ''}`} data-testid={`card-communication-${c.id}`}>
              <div className="comm__card-body">
                <div className="comm__tags">{isDefault && <span className="comm__tag comm__tag--default">Default</span>}<span className="comm__tag">{TYPE_LABELS[c.type]}</span><span className="comm__tag">Encrypted storage</span></div>
                <h3>{c.name}</h3><dl>
                  {c.provider && <div><dt>Provider</dt><dd>{c.provider}</dd></div>}
                  {(c.host || c.endpoint) && <div><dt>{c.host ? 'Host' : 'Endpoint'}</dt><dd>{c.host ? `${c.host}:${c.port}` : c.endpoint}</dd></div>}
                  <div><dt>Sender</dt><dd>{c.fromEmail || c.senderId || c.senderPhone}</dd></div>
                </dl><span className="comm__hint">Credential saved. Connection status not checked.</span>
              </div>
              <div className="comm__card-foot">
                <button type="button" disabled={busy || loading || blocked || !!editor || !!del} onClick={() => open(c)} data-testid={`button-edit-communication-${c.id}`}>View / edit</button>
                <button type="button" disabled={isDefault || busy || loading || blocked || !!editor || !!del} onClick={() => mutate(() => chooseCommunicationDefault(snapshot, channel, c.id))} data-testid={`button-default-communication-${c.id}`}>{isDefault ? 'Default' : 'Make default'}</button>
                <button type="button" disabled={busy || loading || blocked || !!editor || !!del} onClick={() => { setDel(c); setReplacement(''); setDelConfirm(false); setError(''); }} data-testid={`button-delete-communication-${c.id}`}>Delete</button>
              </div>
            </li>;
          })}</ul>}
      </div>
    </>}
    {editor && <Dialog className="comm__dialog" title={editor.id ? 'View / edit configuration' : 'Add configuration'} eyebrow={CHANNEL_LABELS[channel]} description="Shared encrypted settings. Saving does not connect or send." onClose={closeEditor}>
      <CommunicationForm key={editor.key} channel={channel} initial={editor.initial} editing={!!editor.id} busy={busy}
        blocked={blocked || loading || !snapshot} error={formError}
        recovery={blocked ? { label: 'Load latest settings', run: reload } : null}
        extra={editor.review && <div role="status">
          {current ? <><p>Current saved configuration (version {current.version}):</p><dl>{configurationEntries(current).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></>
            : <p>{editor.id ? 'This configuration was deleted. Cancel and create a new configuration if needed.' : 'Compare your draft with the saved cards. If this create already succeeded, cancel and edit that record.'}</p>}
          {(!editor.id || current) && <button type="button" onClick={review}>I reviewed the saved settings; keep my draft</button>}
        </div>}
        onSubmit={(input) => mutate(() => saveConfiguration(snapshot, channel, input, editor.id, editor.version), true)}
        onCancel={closeEditor} onTypeChange={() => setFormError(null)} />
    </Dialog>}
    {del && <Dialog title="Delete configuration" eyebrow={CHANNEL_LABELS[channel]} description={`Delete ${del.name} from shared storage for all browsers?`} onClose={() => { if (!pending.current) setDel(null); }} footer={<>
      <button type="button" disabled={busy} className="admin-button admin-button--secondary" onClick={() => setDel(null)}>Cancel</button>
      <button type="button" disabled={busy || loading || blocked} className="admin-button admin-button--danger" onClick={() => {
        if (needsRepl && (!replacement || !delConfirm)) { setError('Choose a replacement default and confirm the change.'); return; }
        return mutate(() => deleteConfiguration(snapshot, channel, del.id, needsRepl ? replacement : null));
      }} data-testid="button-confirm-delete-communication">Delete</button></>}>
      {needsRepl && <div className="comm__form">
        <p className="comm__warn">This is the default configuration. Choose its replacement.</p>
        <fieldset className="comm__radios" disabled={busy}><legend>Replacement default</legend>{others.map((o) => <label key={o.id}><input type="radio" name="comm-repl" checked={replacement === o.id} onChange={() => setReplacement(o.id)} />{o.name}</label>)}</fieldset>
        <label><input type="checkbox" disabled={busy} checked={delConfirm} onChange={(e) => setDelConfirm(e.target.checked)} />I confirm the default will change.</label>
      </div>}
      {error && <p role="alert">{error} {retryBtn}</p>}
    </Dialog>}
  </section>;
}

function configurationEntries(record) {
  return Object.entries(record).filter(([key]) => !['id', 'version', 'credentialPresent'].includes(key));
}
