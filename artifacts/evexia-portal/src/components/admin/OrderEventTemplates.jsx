import { useEffect, useMemo, useRef, useState } from 'react';
import MessageTemplateDrawer from './MessageTemplateDrawer.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { orderNotificationRequest, getSession } from '../../auth/adminSession.js';
import { buildEmailPreview } from '../../services/messageTemplatePreview.js';
import './orderEventTemplates.css';

const CH = [['email', 'Email'], ['sms', 'SMS'], ['waba', 'WhatsApp (WABA)']];
const CH_LABEL = Object.fromEntries(CH);
const EVENT_LABEL = { order_placed: 'Order placed', order_confirmed: 'Order confirmed',
  order_rejected: 'Order rejected', order_resubmitted: 'Order resubmitted',
  order_shipped: 'Order shipped', order_delivered: 'Order delivered',
  order_returned: 'Order returned', order_transaction: 'MR transaction recorded' };
const PLACEHOLDERS = ['order_number', 'order_type', 'event_name', 'status', 'mr_name', 'timestamp', 'transaction_amount', 'company_name'];
const SAMPLE = { order_number: 'IMM-2025-00417', order_type: 'Immunotherapy', event_name: 'Order shipped', status: 'Shipped', mr_name: 'Fictional MR Kavya Rao', timestamp: '14 Mar 2025, 4:12 PM', transaction_amount: 'INR 18,450.00', company_name: 'EVEXIA Life Sciences' };
const READINESS = {
  ready: 'Ready to send', not_assigned: 'Not assigned to an event', template_required: 'No template for this event', template_disabled: 'Template disabled',
  dlt_template_required: 'DLT template ID required', template_approval_metadata_required: 'Approved provider template name and language required',
  configuration_required: 'Channel provider not configured', configuration_invalid: 'Channel configuration invalid', configuration_unreadable: 'Channel configuration unreadable',
  unsupported_provider: 'Provider not supported for this channel', provider_metadata_required: 'Provider metadata required',
  saved_smtp_missing: 'Saved Email SMTP missing', saved_smtp_unsupported: 'Saved Email SMTP unsupported', saved_smtp_insecure: 'Saved Email SMTP insecure',
  saved_smtp_unavailable: 'Saved Email SMTP unavailable', saved_smtp_invalid: 'Saved Email SMTP invalid',
};
const readiness = (r) => READINESS[r] || (r ? `Unrecognised status (${r})` : 'Readiness unknown');
const DRAFT_PREFIX = 'evexia.orderEventTemplate.draft.';
const draftKey = (id) => `${DRAFT_PREFIX}${getSession().user?.id || 'anon'}.${id || 'new'}`;
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sub = (t, html = false) => String(t || '').replace(/\{\{([a-z_]+)\}\}/g, (m, k) => (PLACEHOLDERS.includes(k) ? (html ? esc(SAMPLE[k]) : SAMPLE[k]) : m));
const unknownTokens = (texts) => [...new Set(texts.join('\n').match(/\{\{[^}]*\}\}/g) || [])].filter((t) => !PLACEHOLDERS.includes(t.slice(2, -2)));
const blank = (channel) => ({ id: null, channel, eventKey: null, name: '', enabled: false, subject: '', html: '', text: '', dltId: '', providerTemplate: '', language: '', parameters: [] });
const bodyOf = (d) => ({ channel: d.channel, eventKey: d.eventKey || null, name: d.name.trim(), enabled: !!d.enabled, subject: d.channel === 'email' ? d.subject || '' : '', html: d.channel === 'email' ? d.html || '' : '', text: d.text || '', dltId: d.dltId || '', providerTemplate: d.providerTemplate || '', language: d.language || '', parameters: (d.parameters || []).filter(Boolean) });
const readDraft = (id) => { try { const v = JSON.parse(sessionStorage.getItem(draftKey(id)) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const writeDraft = (id, d) => { try { sessionStorage.setItem(draftKey(id), JSON.stringify(d)); } catch { /* storage unavailable */ } };
const dropDraft = (id) => { try { sessionStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ } };

function missing(t) {
  const m = [];
  if (!t.name?.trim()) m.push('name');
  if (t.channel === 'email' && !t.subject?.trim()) m.push('subject');
  if (t.channel === 'email' && !t.html?.trim() && !t.text?.trim()) m.push('HTML or text body');
  if (t.channel === 'sms' && !t.text?.trim()) m.push('message text');
  if (t.channel === 'sms' && !t.dltId?.trim()) m.push('DLT template ID');
  if (t.channel === 'waba' && !t.providerTemplate?.trim()) m.push('approved provider template name');
  if (t.channel === 'waba' && !t.language?.trim()) m.push('language');
  return m;
}

export default function OrderEventTemplates({ guard, onDirtyChange, onBusyChange }) {
  const confirm = usePlatformConfirm();
  const [snap, setSnap] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [channel, setChannel] = useState('email'), [editor, setEditor] = useState(null), [view, setView] = useState(null);
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), req = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; req.current += 1; }; }, []);
  const load = async () => {
    const n = ++req.current; setLoading(true); setError('');
    try {
      const d = await orderNotificationRequest('/admin/order-event-templates');
      if (!alive.current || n !== req.current) return null;
      if (!Array.isArray(d?.items) || !Array.isArray(d?.events)) throw new Error('Templates returned an invalid response.');
      setSnap(d); return d;
    } catch (e) { if (alive.current && n === req.current) setError(e.message); }
    finally { if (alive.current && n === req.current) setLoading(false); }
    return null;
  };
  useEffect(() => { void load(); }, []);
  const events = snap?.events || [];
  const evLabel = (k) => events.find((e) => e.key === k)?.label || (k ? k : 'Unassigned (not triggered)');
  const items = (snap?.items || []).filter((t) => t.channel === channel);
  const total = snap?.items?.length || 0;
  const matrix = useMemo(() => events.map((e) => ({ ...e, byCh: Object.fromEntries(CH.map(([c]) => [c, (snap?.items || []).find((t) => t.channel === c && t.eventKey === e.key)])) })), [snap, events]);

  const startEdit = async (t) => {
    if (busy || !await guard()) return;
    const recovered = readDraft(t?.id);
    const base = t ? { ...blank(t.channel), ...t, parameters: [...(t.parameters || [])] } : blank(channel);
    onDirtyChange(!!recovered); setView(null); setStatus('');
    setEditor({ key: Date.now(), base, draft: recovered ? { ...base, ...recovered.draft, id: base.id, channel: base.channel } : base, recovered: !!recovered, recoveredVersion: recovered?.version ?? null, error: '', conflict: false });
  };
  const close = async () => { if (busy || !await guard()) return; onDirtyChange(false); setEditor(null); setView(null); };
  const edit = (patch) => setEditor((e) => {
    const draft = { ...e.draft, ...patch };
    writeDraft(e.base.id, { draft, version: e.base.version ?? null });
    onDirtyChange(true);
    return { ...e, draft };
  });
  const discardDraft = () => { dropDraft(editor.base.id); onDirtyChange(false); setEditor((e) => ({ ...e, draft: e.base, recovered: false, recoveredVersion: null, error: '', conflict: false })); };
  const save = async () => {
    if (busy) return;
    const d = editor.draft;
    if (!d.name.trim()) { setEditor((e) => ({ ...e, error: 'Enter a template name.' })); return; }
    const bad = unknownTokens(d.channel === 'email' ? [d.subject, d.html, d.text] : [d.text]);
    if (bad.length) { setEditor((e) => ({ ...e, error: `Remove unsupported placeholders: ${bad.join(', ')}.` })); return; }
    setBusy(true); onBusyChange(true);
    try {
      const path = d.id ? `/admin/order-event-templates/${d.id}/edit` : '/admin/order-event-templates';
      await orderNotificationRequest(path, d.id ? { ...bodyOf(d), version: editor.base.version } : bodyOf(d));
      if (!alive.current) return;
      dropDraft(d.id); onDirtyChange(false); setEditor(null);
      setStatus('Template saved to the shared database. Nothing was sent.');
      await load();
    } catch (e) {
      if (alive.current) setEditor((x) => ({ ...x, error: `${e.message}${e.ambiguous ? '' : ' Your draft is kept in this tab.'}`, conflict: e.status === 409 || !!e.ambiguous }));
    } finally { if (alive.current) { setBusy(false); onBusyChange(false); } }
  };
  const reloadBase = async () => {
    const d = await load(); if (!d || !alive.current) return;
    const fresh = d.items.find((t) => t.id === editor.base.id);
    setEditor((e) => ({ ...e, base: fresh ? { ...blank(fresh.channel), ...fresh } : e.base, error: fresh || !e.base.id ? 'Latest saved list loaded. Your draft is unchanged; review the event assignment and save again.' : 'This template no longer exists. Your draft is kept; copy what you need.', conflict: false }));
  };
  const remove = async (item) => {
    if (busy) return;
    if (!await guard()) return;
    if (!await confirm(`Delete shared ${CH_LABEL[item.channel]} template "${item.name}" (version ${item.version})? This removes its event assignment for all browsers. Nothing will be sent.`)) return;
    setBusy(true); onBusyChange(true);
    try {
      const r = await orderNotificationRequest(`/admin/order-event-templates/${item.id}/delete`, { version: item.version });
      if (!alive.current) return;
      if (r?.deleted !== true) throw new Error('Delete outcome could not be confirmed. Load latest.');
      dropDraft(item.id); setStatus('Template deleted from the shared database.'); await load();
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) { setBusy(false); onBusyChange(false); } }
  };

  return <div className="oet">
    <div className="mt-head"><p className="mt-note"><strong>Shared order event templates.</strong> Stored in the shared database for all browsers. Saving or enabling a template never sends a message; messages go out only when an order event occurs and the channel provider configuration is ready.</p>
      <div className="mt-row"><button type="button" className="admin-button" disabled={!snap || busy || loading || total >= 100} onClick={() => startEdit(null)} data-testid="button-oet-new">New {CH_LABEL[channel]} template</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={loading || busy} onClick={load} data-testid="button-oet-reload">Load latest</button></div></div>
    {total >= 100 && <p className="mt-note">The 100-template limit is reached. Delete an unused template to add another.</p>}
    {loading && !snap && <div className="oet-skel" aria-busy="true" aria-label="Loading templates"><span /><span /><span /></div>}
    {error && <div role="alert" className="admin-feedback admin-feedback--error">{error} <button type="button" onClick={load} disabled={loading}>Retry loading</button></div>}
    {status && <p role="status" data-testid="text-oet-status">{status}</p>}
    {snap && <>
      <div className="oet-matrix-wrap"><table className="oet-matrix" data-testid="table-oet-readiness"><caption>Event coverage and readiness</caption>
        <thead><tr><th scope="col">Order event</th>{CH.map(([c, l]) => <th key={c} scope="col">{l}</th>)}</tr></thead>
        <tbody>{matrix.map((e) => <tr key={e.key}><th scope="row">{e.label}</th>{CH.map(([c]) => { const t = e.byCh[c]; return <td key={c}>{t ? <span className={`oet-pill${t.enabled ? ' oet-pill--on' : ''}`}>{t.enabled ? 'Enabled' : 'Disabled'} · {readiness(t.readiness)}</span> : <span className="oet-pill oet-pill--none">No template</span>}</td>; })}</tr>)}</tbody></table></div>
      <div className="admin-tabs" role="group" aria-label="Order event channel">{CH.map(([c, l]) => <button key={c} type="button" aria-pressed={channel === c} className={channel === c ? 'is-on' : ''} onClick={() => setChannel(c)} data-testid={`button-oet-channel-${c}`}>{l}</button>)}</div>
      <p role="status" className="mt-note">{items.length} {CH_LABEL[channel]} templates · {total} of 100 total</p>
      {!items.length && <p className="admin-empty">No {CH_LABEL[channel]} order event templates. Create one and assign it to an event.</p>}
      <ul className="mt-list">{items.map((t) => { const gaps = missing(t); return <li key={t.id} className="mt-card" data-testid={`card-oet-${t.id}`}>
        <div className="mt-tags"><span className="mt-tag">Shared</span><span className="mt-tag">{CH_LABEL[t.channel]} · Version {t.version}</span><span className="mt-tag">Event: {evLabel(t.eventKey)}</span><span className={`mt-tag${t.enabled ? ' oet-tag--on' : ''}`}>{t.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <h3>{t.name}</h3>
        <p>Readiness: {readiness(t.readiness)}{t.enabled && t.readiness !== 'ready' ? ' (enabled for future eligible events only)' : ''}{gaps.length ? ` · Missing: ${gaps.join(', ')}` : ''}</p>
        <div className="mt-row"><button type="button" disabled={busy} onClick={async () => { if (await guard()) { onDirtyChange(false); setEditor(null); setView(t); } }} data-testid={`button-oet-preview-${t.id}`}>Preview</button>
          <button type="button" disabled={busy} onClick={() => startEdit(t)} data-testid={`button-oet-edit-${t.id}`}>Edit</button>
          <button type="button" disabled={busy} onClick={() => void remove(t)} data-testid={`button-oet-delete-${t.id}`}>Delete</button></div></li>; })}</ul>
    </>}
    {(editor || view) && <MessageTemplateDrawer onRequestClose={close} title={editor ? `${editor.base.id ? 'Edit' : 'New'} ${CH_LABEL[editor.draft.channel]} order event template` : view.name}
      subtitle={editor ? 'Saves to the shared database. Saving does not send any message.' : `Shared · Version ${view.version} · ${evLabel(view.eventKey)}`}>
      {editor ? <Editor ed={editor} events={events} busy={busy} edit={edit} save={save} discard={discardDraft} reload={reloadBase} close={close} variables={snap?.variables} />
        : <Preview t={view} />}
    </MessageTemplateDrawer>}
    <DeliveryAttempts />
  </div>;
}

function Editor({ ed, events, busy, edit, save, discard, reload, close, variables }) {
  const d = ed.draft, c = d.channel;
  const vars = Array.isArray(variables) && variables.length ? variables.filter((v) => PLACEHOLDERS.includes(v)) : PLACEHOLDERS;
  const params = d.parameters || [];
  return <form className="oet-form" onSubmit={(e) => { e.preventDefault(); void save(); }}><fieldset className="oet-edit-fields" disabled={busy}>
    {ed.recovered ? <div className="admin-feedback" role="status">Recovered an unsaved draft from this tab{ed.recoveredVersion != null && ed.base.version != null && ed.recoveredVersion !== ed.base.version ? ` (based on version ${ed.recoveredVersion}; latest is ${ed.base.version} — review before saving)` : ''}. <button type="button" onClick={discard}>Discard draft</button></div> : null}
    {ed.error && <div role="alert" className="admin-feedback admin-feedback--error">{ed.error}{ed.conflict && <> <button type="button" disabled={busy} onClick={reload} data-testid="button-oet-load-latest">Load latest (keep draft)</button></>}</div>}
    <div className="oet-grid">
      <label className="mt-field"><span>Template name</span><input value={d.name} maxLength={100} required onChange={(e) => edit({ name: e.target.value })} data-testid="input-oet-name" /></label>
      <label className="mt-field"><span>Assigned event</span><select value={d.eventKey || ''} onChange={(e) => edit({ eventKey: e.target.value || null })} data-testid="select-oet-event"><option value="">Unassigned (not triggered)</option>{events.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}</select></label>
      <label className="oet-check"><input type="checkbox" checked={!!d.enabled} onChange={(e) => edit({ enabled: e.target.checked })} data-testid="checkbox-oet-enabled" /> Enabled (sends only once the channel provider is configured and ready)</label>
    </div>
    <p className="mt-note">Allowed placeholders: {vars.map((v) => <code key={v}>{`{{${v}}}`}</code>).reduce((a, x, i) => (i ? [...a, ' ', x] : [x]), [])}. Each event has one template per channel; assigning an event already in use returns a conflict and keeps your draft.</p>
    {c === 'email' && <>
      <label className="mt-field"><span>Subject</span><input value={d.subject} maxLength={200} onChange={(e) => edit({ subject: e.target.value })} data-testid="input-oet-subject" /></label>
      <label className="mt-field"><span>HTML body</span><textarea rows={10} value={d.html} onChange={(e) => edit({ html: e.target.value })} data-testid="input-oet-html" /></label>
      <label className="mt-field"><span>Plain text body</span><textarea rows={5} value={d.text} onChange={(e) => edit({ text: e.target.value })} data-testid="input-oet-text" /></label></>}
    {c === 'sms' && <>
      <label className="mt-field"><span>DLT template ID (required to send; from your DLT registration, not generated here)</span><input value={d.dltId} maxLength={64} onChange={(e) => edit({ dltId: e.target.value })} data-testid="input-oet-dlt" /></label>
      <label className="mt-field"><span>Message text (must match the registered DLT text)</span><textarea rows={5} value={d.text} onChange={(e) => edit({ text: e.target.value })} data-testid="input-oet-sms-text" /></label>
      <p className="mt-note">{d.text.length} characters</p></>}
    {c === 'waba' && <>
      <label className="mt-field"><span>Approved provider template name (exact, from your WhatsApp Business Manager)</span><input value={d.providerTemplate} maxLength={512} onChange={(e) => edit({ providerTemplate: e.target.value })} data-testid="input-oet-provider-template" /></label>
      <label className="mt-field"><span>Language code (as approved, e.g. en_US)</span><input value={d.language} maxLength={15} onChange={(e) => edit({ language: e.target.value })} data-testid="input-oet-language" /></label>
      <fieldset className="oet-params"><legend>BODY parameter mapping (in order {'{{1}}'}, {'{{2}}'} ...)</legend>
        {params.map((p, i) => <div key={i} className="mt-row"><span className="oet-pnum">{`{{${i + 1}}}`}</span>
          <select aria-label={`Parameter ${i + 1}`} value={p} onChange={(e) => edit({ parameters: params.map((x, j) => (j === i ? e.target.value : x)) })} data-testid={`select-oet-param-${i}`}><option value="">Choose variable</option>{vars.map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <button type="button" aria-label={`Move parameter ${i + 1} up`} disabled={!i} onClick={() => { const n = [...params]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; edit({ parameters: n }); }}>Up</button>
          <button type="button" aria-label={`Remove parameter ${i + 1}`} onClick={() => edit({ parameters: params.filter((_, j) => j !== i) })}>Remove</button></div>)}
        <button type="button" disabled={params.length >= 20} onClick={() => edit({ parameters: [...params, ''] })} data-testid="button-oet-add-param">Add parameter</button></fieldset>
      <label className="mt-field"><span>Reference body text (for preview only; the approved provider template is what is sent)</span><textarea rows={4} value={d.text} onChange={(e) => edit({ text: e.target.value })} data-testid="input-oet-waba-text" /></label></>}
    {missing(d).length > 0 && <p className="mt-note" data-testid="text-oet-missing">Not send-ready yet: {missing(d).join(', ')}. You can still save.</p>}
    <div className="mt-row"><button type="submit" className="admin-button" disabled={busy} data-testid="button-oet-save">{busy ? 'Saving...' : 'Save template'}</button><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={close}>Close</button></div>
    <Preview t={d} />
  </fieldset></form>;
}

function Preview({ t }) {
  const [sample, setSample] = useState(true);
  const s = (v, h) => (sample ? sub(v, h) : (v || ''));
  const doc = useMemo(() => (t.channel === 'email' ? buildEmailPreview(s(t.html, true), null) : ''), [t.channel, t.html, sample]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="mt-prev" aria-label="Offline preview">
    <div className="mt-prev__bar"><div className="admin-tabs" role="group" aria-label="Preview mode"><button type="button" aria-pressed={!sample} className={!sample ? 'is-on' : ''} onClick={() => setSample(false)}>Tokens</button><button type="button" aria-pressed={sample} className={sample ? 'is-on' : ''} onClick={() => setSample(true)}>Fictional sample</button></div></div>
    <p className="mt-note">Offline, inert preview. Links and remote content are disabled; sample values are fictional.</p>
    {t.channel === 'email' && <><p><strong>Subject:</strong> {s(t.subject)}</p>{t.html ? <iframe title="Email HTML preview" className="oet-frame" sandbox="" srcDoc={doc} /> : null}{t.text && <pre className="oet-pre">{s(t.text)}</pre>}</>}
    {t.channel === 'sms' && <><p className="mt-note">DLT ID: {t.dltId || 'not set'}</p><pre className="oet-pre">{s(t.text)}</pre></>}
    {t.channel === 'waba' && <><p className="mt-note">Template {t.providerTemplate || 'not set'} · {t.language || 'no language'}</p>
      <ol className="oet-plist">{(t.parameters || []).map((p, i) => <li key={i}>{`{{${i + 1}}}`} = {p ? (sample ? SAMPLE[p] ?? p : `{{${p}}}`) : 'unmapped'}</li>)}</ol>
      {t.text && <pre className="oet-pre">{s(t.text)}</pre>}</>}
  </section>;
}

function DeliveryAttempts() {
  const [page, setPage] = useState({ offset: 0, items: null, hasMore: false }), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async (offset) => {
    setLoading(true); setError('');
    try {
      const d = await orderNotificationRequest(`/admin/order-notification-deliveries?offset=${offset}&limit=25`);
      if (!Array.isArray(d?.items)) throw new Error('Delivery attempts returned an invalid response.');
      if (alive.current) setPage({ offset, items: d.items.slice(0, 25), hasMore: d.hasMore === true });
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { void load(0); }, []);
  const word = (s) => ({ pending: 'Pending', leased: 'Pending', sending: 'Pending handoff', accepted: 'Provider accepted (delivery not confirmed)', failed: 'Failed', blocked: 'Blocked (not sent)', unknown: 'Outcome unknown' })[s] || 'Outcome unknown';
  const when = (v) => { const x = new Date(v); return Number.isNaN(x.getTime()) ? '' : x.toLocaleString(); };
  return <section className="oet-deliv" aria-labelledby="oet-deliv-h">
    <div className="mt-head"><h3 id="oet-deliv-h">Channel attempts</h3><button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={() => load(page.offset)} data-testid="button-oet-deliveries-reload">Refresh</button></div>
    <p className="mt-note">"Provider accepted" means the provider took the request; it does not confirm the recipient received it. Recipient details and message bodies are not shown.</p>
    {error && <div role="alert" className="admin-feedback admin-feedback--error">{error} <button type="button" onClick={() => load(page.offset)}>Retry</button></div>}
    {loading && !page.items && <div className="oet-skel" aria-busy="true"><span /><span /></div>}
    {page.items && !page.items.length && <p className="admin-empty">No channel attempts recorded yet.</p>}
    {page.items?.length > 0 && <div className="oet-matrix-wrap"><table className="oet-matrix" data-testid="table-oet-deliveries"><thead><tr><th scope="col">Order</th><th scope="col">Event</th><th scope="col">Recipient</th><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Category</th><th scope="col">Created</th><th scope="col">Updated</th></tr></thead>
      <tbody>{page.items.map((r) => <tr key={r.id}><td>{r.number}</td><td>{EVENT_LABEL[r.event] || 'Order event'}</td><td>{r.recipient}</td><td>{CH_LABEL[r.channel] || r.channel}</td><td>{word(r.status)}</td><td>{r.category || '-'}</td><td>{when(r.createdAt)}</td><td>{when(r.updatedAt)}</td></tr>)}</tbody></table></div>}
    <div className="mt-row"><button type="button" disabled={loading || page.offset === 0} onClick={() => load(Math.max(0, page.offset - 25))}>Newer</button><button type="button" disabled={loading || !page.hasMore} onClick={() => load(page.offset + 25)}>Older</button></div>
  </section>;
}
