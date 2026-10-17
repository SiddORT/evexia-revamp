import { useEffect, useMemo, useRef, useState } from 'react';
import MessageTemplatePreview from './MessageTemplatePreview.jsx';
import { LIMITS, loadMessageTemplates, saveMessageTemplate, validateMessageTemplate } from '../../services/messageTemplates.js';
import { SUPPORTED_TOKENS, readHtmlFile } from '../../services/messageTemplatePreview.js';
import { EMAIL_VARIABLES, saveEmailTemplate, loadEmailTemplates } from '../../services/emailTemplates.js';
import './messageTemplates.css';

const isStale = (e) => e?.code === 'conflict' || e?.code === 'stale' || /\b(changed|stale|conflict|revision)\b/i.test(e?.message || '');
const FIELDS = {
  email: [['name', 'Template name', 100, 'input'], ['description', 'Purpose', 500, 'area'], ['subject', 'Subject', 200, 'input'], ['html', 'HTML source', 100000, 'code'], ['text', 'Plain text alternative', 20000, 'area']],
  sms: [['name', 'Template name', 100, 'input'], ['description', 'Purpose', 500, 'area'], ['body', 'Message body', 2000, 'area'], ['providerTemplateId', 'Provider/DLT template ID', 160, 'input']],
};
const flat = (d) => ({ name: d.name, description: d.description, ...d.content, ...(d.channel === 'email' ? { eventKey: d.eventKey ?? null } : {}) });
const toInput = (channel, f) => channel === 'email'
  ? { channel, name: f.name, description: f.description, eventKey: f.eventKey, content: { subject: f.subject, html: f.html, text: f.text } }
  : { channel, name: f.name, description: f.description, content: { body: f.body, providerTemplateId: f.providerTemplateId } };

/** Email is API-backed; SMS retains its existing browser snapshot contract. */
export default function MessageTemplateEditor({ draft, baseline, loadError, latestRevision, externalBusy = false, events = [], onClose, onSaved, onReopenLatest, onDirtyChange, onBusyChange }) {
  const channel = draft.channel;
  const initial = useRef(flat(draft)).current;
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState('');
  const [stale, setStale] = useState(false);
  const [saving, setBusy] = useState(false);
  const busy = saving || externalBusy;
  const running = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const working = (b) => { running.current = b; setBusy(b); busyCallback.current?.(b); };
  const [info, setInfo] = useState('');
  const lastFocus = useRef(channel === 'email' ? 'subject' : 'body');
  const refs = useRef({});
  const fileRef = useRef(null);
  const htmlRef = useRef(draft.content.html || '');
  const [pane, setPane] = useState('code');
  const [recovered, setRecovered] = useState(false);
  const dirty = useMemo(() => Object.keys(f).some((k) => f[k] !== initial[k]), [f, initial]);
  const dirtyRef = useRef(onDirtyChange); dirtyRef.current = onDirtyChange;
  useEffect(() => { dirtyRef.current?.(dirty); }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);
  const baseRev = baseline?.record?.revision;
  const isStaleNow = stale || (baseline && latestRevision != null && latestRevision !== baseRev);
  const set = (k, v) => { if (k === 'html') htmlRef.current = v; setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setInfo(''); };
  const insert = (t) => {
    const k = lastFocus.current; const el = refs.current[k];
    const text = `{{${t}}}`; const cur = f[k] || '';
    const s = el?.selectionStart ?? cur.length; const e = el?.selectionEnd ?? cur.length;
    const max = LIMITS[k] || 100000;
    const next = cur.slice(0, s) + text + cur.slice(e);
    if (next.length > max) { setInfo(`Token not inserted: ${k} would exceed ${max} characters.`); return; }
    set(k, next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange?.(s + text.length, s + text.length); });
    setInfo(`Inserted ${text} into ${k}.`);
  };
  const importFile = async (ev) => {
    if (running.current || externalBusy) return;
    const file = ev.target.files?.[0]; ev.target.value = '';
    if (!file) return;
    working(true);
    try {
      const html = await readHtmlFile(file);
      if (htmlRef.current.trim() && !window.confirm('Replace the current HTML draft with the imported file? This is not saved until you save the template.')) return;
      set('html', html); setBanner(''); setInfo(`Imported ${file.name} into the draft. Not saved yet.`);
    } catch (e) { setBanner(e?.message || 'File could not be imported. Your draft is unchanged.'); }
    finally { working(false); }
  };
  const mapErrors = (e) => { const fe = e?.fields || e?.errors || {}; const out = {}; Object.entries(fe).forEach(([k, v]) => { out[k.split('.').pop()] = Array.isArray(v) ? v[0] : String(v); }); return out; };
  const providerMissing = channel === 'sms' && !f.providerTemplateId.trim();
  const save = async (asNew) => {
    if (running.current || externalBusy || (channel === 'email' && uncertain)) return;
    setBanner(''); working(true);
    const input = toInput(channel, f);
    const fe = {};
    FIELDS[channel].forEach(([key, label]) => {
      if (key !== 'description' && !f[key]?.trim()) fe[key] = `${label} is required.`;
    });
    if (providerMissing) fe.providerTemplateId = 'Provider template ID is required to save.';
    try {
      try { validateMessageTemplate(input); } catch (e) { Object.assign(fe, mapErrors(e)); if (!Object.keys(fe).length) fe.name = e?.message; }
      if (Object.keys(fe).length) { setErrors(fe); setBanner('Fix the highlighted fields.'); return; }
      if (channel === 'email') {
        if (stale) { setBanner('Reopen the latest saved version before editing. Your draft is kept.'); return; }
        const snap = await saveEmailTemplate(draft, input);
        onSaved(snap, !draft.id);
        return;
      }
      let base = baseline;
      if (asNew) { if (loadError && !recovered) { setBanner('Retry storage first. It must be readable before saving a new template.'); return; } try { base = loadMessageTemplates(); } catch (e) { setBanner(e?.message || 'Storage could not be read.'); return; } }
      else if (!base || loadError) { setBanner('Saving is blocked because storage could not be read. Use Retry storage, then Save as new template.'); return; }
      else if (isStaleNow) { setStale(true); setBanner('Templates changed in another tab. Save as new or reopen the latest version.'); return; }
      const snap = await saveMessageTemplate(base?.record ? base : base, input, asNew ? null : draft.id);
      onSaved(snap, asNew || !draft.id);
    } catch (e) {
      if (channel === 'email') {
        if (e.ambiguous) setUncertain(true);
        if (isStale(e) && draft.id) setStale(true);
        setErrors((p) => ({ ...p, ...mapErrors(e) })); setBanner(e.message || 'Email save failed. Your draft is kept.');
      }
      else if (isStale(e)) { setStale(true); setBanner('Templates changed in another tab. Your draft is kept. Save as new or reopen the latest version.'); }
      else { setErrors((p) => ({ ...p, ...mapErrors(e) })); setBanner(e?.message || 'Could not save template. Your draft is kept.'); }
    } finally { working(false); }
  };
  const reconcile = async () => {
    if (running.current || externalBusy) return;
    working(true);
    try {
      const latest = await loadEmailTemplates();
      const row = latest.record.templates.find((t) => t.id === (draft.id || draft.creationId));
      const current = toInput(channel, f);
      const same = row && row.name === current.name.trim() && row.description === current.description.trim() &&
        row.eventKey === current.eventKey && Object.keys(current.content).every((k) => row.content[k] === current.content[k]);
      if (same) { onSaved(latest); return; }
      setUncertain(false);
      if (row && draft.id) {
        setStale(row.version !== draft.version);
        setBanner('Latest saved content differs from this draft. Your draft is kept; reopen latest to discard it, or retry only if its version is unchanged.');
      } else if (row) {
        setUncertain(true); setBanner('This creation is already stored with different content. Keep your draft here or cancel and edit that stored template. Do not submit it as another template.');
      } else if (draft.id) {
        setStale(true); setBanner('This template no longer exists. Your draft is kept.');
      } else {
        setBanner('Creation is not present in the latest list. You may retry explicitly with the same creation identity; duplicates cannot be created.');
      }
    } catch (e) { setBanner(e.message || 'Could not reconcile. Your draft is kept.'); }
    finally { working(false); }
  };
  const retryStorage = () => { try { loadMessageTemplates(); setRecovered(true); setBanner(''); setInfo('Storage is readable. You can save this draft as a new template; existing saved templates will not be overwritten.'); } catch (e) { setBanner(e?.message || 'Storage still cannot be read.'); } };
  const close = () => { if (busy || (dirty && !window.confirm('Discard unsaved changes?'))) return; dirtyRef.current?.(false); onClose(); };
  const reopen = () => { if (busy || !window.confirm('Discard your draft and open the latest saved version?')) return; onReopenLatest?.(draft.id); };
  const field = ([k, label, max, kind]) => {
    const common = { id: `mt-${k}`, value: f[k], disabled: busy, maxLength: max, autoFocus: channel === 'email' && k === 'name', 'aria-invalid': !!errors[k], 'aria-describedby': `mt-${k}-h`, 'data-testid': `input-template-${k}`,
      ref: (el) => { refs.current[k] = el; }, onFocus: () => { if (['subject', 'html', 'text', 'body'].includes(k)) lastFocus.current = k; }, onChange: (e) => set(k, e.target.value) };
    return <div key={k} className={`mt-field${errors[k] ? ' mt-field--error' : ''}${k === 'html' ? ' mt-field--wide' : ''}`}>
      <label htmlFor={`mt-${k}`}>{label}{k !== 'description' ? <span className="mt-req"> (required)</span> : null}</label>
      {kind === 'input' ? <input {...common} /> : <textarea {...common} rows={kind === 'code' ? 12 : 4} spellCheck={kind !== 'code'} className={kind === 'code' ? 'mt-code' : ''} />}
      <small id={`mt-${k}-h`}>{f[k].length} / {max}{k === 'providerTemplateId' ? '. Enter your own provider or DLT reference. Saving does not register, verify or approve it anywhere.' : ''}</small>
      {errors[k] && <span className="mt-err" role="alert">{errors[k]}</span>}
    </div>;
  };
  return <section className="mt-editor" aria-labelledby="mt-ed-h">
    <div className="mt-head"><div><h3 id="mt-ed-h" className={channel === 'email' ? 'mt-sr' : ''}>{draft.id ? 'Edit' : 'New'} {channel === 'email' ? 'email' : 'SMS'} template</h3>
      </div>
      {channel === 'sms' && <button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-template-close">Close</button>}</div>
    {channel === 'email' && <div className="mt-seg" role="group" aria-label="Editor view"><button type="button" aria-pressed={pane === 'code'} onClick={() => setPane('code')}>Code</button><button type="button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>Preview</button></div>}
    {loadError && <div className="admin-feedback admin-feedback--error" role="alert">{loadError} Saving over saved templates is blocked; your draft is kept.
      <div className="mt-row"><button type="button" className="admin-button admin-button--secondary" onClick={retryStorage} data-testid="button-template-retry-storage">Retry storage</button>
        {recovered && <button type="button" className="admin-button" onClick={() => save(true)} disabled={busy} data-testid="button-template-save-new-recovered">Save as new template</button>}</div></div>}
    {isStaleNow && !loadError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="text-template-stale">The saved template changed since you opened the editor. Saving over it is blocked; your draft is kept.
      <div className="mt-row">{channel === 'sms' && <button type="button" className="admin-button admin-button--secondary" onClick={() => save(true)} disabled={busy} data-testid="button-template-save-new-stale">Save as new template</button>}
        <button type="button" className="admin-button admin-button--danger" onClick={reopen} data-testid="button-template-reopen">Discard and reopen latest</button></div></div>}
    {banner && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="text-template-error">{banner}</div>}
    {channel === 'email' && <div className="mt-row"><button type="button" disabled={busy} onClick={reconcile}>Load latest to reconcile (keep draft)</button>
      {uncertain && <p role="alert">Save outcome is uncertain. Saving is blocked until you reconcile with the database.</p>}</div>}
    <div aria-live="polite" className="mt-note">{info}</div>
    <div className="mt-grid" data-pane={pane}>
      <form className="mt-form" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
        {channel === 'email' && <div className="mt-field"><label htmlFor="mt-event">Backend event</label>
          <select id="mt-event" value={f.eventKey || ''} disabled={busy || draft.protected} onChange={(e) => set('eventKey', e.target.value || null)}>
            <option value="">Unassigned — not triggered</option>{events.map((event) => <option key={event.key} value={event.key} disabled={!draft.protected}>{event.label} ({event.key}) — required assignment</option>)}
          </select><small className="mt-note">{draft.protected ? 'Required identity/event cannot be disabled, deleted or reassigned.' : 'Only implemented backend events are supported. Password recovery already has its protected assignment.'}</small></div>}
        {FIELDS[channel].map(field)}
        {channel === 'email' && <div className="mt-row"><input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={importFile} data-testid="input-template-file" />
          <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="button-template-import">Import HTML file</button>
          <small className="mt-note">Loads into the draft only. Max {LIMITS.fileBytes} bytes, UTF-8.</small></div>}
        <fieldset className="mt-tokens"><legend>Insert token at cursor</legend>
          <div className="mt-row">{(channel === 'email' ? EMAIL_VARIABLES : SUPPORTED_TOKENS).map((t) => <button type="button" disabled={busy} key={t} className="mt-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t)} data-testid={`button-token-${t}`}>{`{{${t}}}`}</button>)}</div>
          <small className="mt-note">Inserts into the last focused {channel === 'email' ? 'subject, HTML or text' : 'body'} field.</small></fieldset>
        <div className="mt-row">
          <button type="submit" className="admin-button" disabled={busy || !!loadError || isStaleNow || uncertain} data-testid="button-template-save">{busy ? 'Saving' : 'Save template'}</button>
          {channel !== 'sms' || !draft.id || loadError ? null : <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => save(true)} data-testid="button-template-save-as-new">Save as new</button>}
          <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={close}>Cancel</button></div>
      </form>
      <MessageTemplatePreview channel={channel} content={channel === 'email' ? { subject: f.subject, html: f.html, text: f.text } : { body: f.body, providerTemplateId: f.providerTemplateId }} idPrefix="mted" />
    </div>
  </section>;
}
