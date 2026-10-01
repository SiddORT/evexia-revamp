import { useEffect, useState } from 'react';
import { CHANNELS, configurationFields } from '../../services/communicationSettings.js';

const LABELS = { name: 'Configuration name', provider: 'Provider', host: 'SMTP host', port: 'SMTP port', security: 'TLS / security', username: 'SMTP username', fromName: 'Sender / from name', fromEmail: 'Sender / from email', endpoint: 'API endpoint / base URL', senderId: 'Sender ID', dltEntityId: 'DLT entity ID (optional)', dltTemplateId: 'DLT template ID (optional)', businessAccountId: 'WhatsApp Business Account ID', phoneNumberId: 'Phone-number ID', senderPhone: 'Sender / display phone number', apiVersion: 'API version (optional)' };
const SECURITY = { starttls: 'STARTTLS', tls: 'TLS', none: 'None' };
export const CHANNEL_LABELS = { email: 'Email', sms: 'SMS', waba: 'WABA (WhatsApp Business API)' };
export const TYPE_LABELS = { smtp: 'SMTP', api: 'API', platform: 'Platform' };
const SECRET = { smtp: 'App password', api: 'API key', platform: 'API key', sms: 'API key', waba: 'API key / access token' };

export default function CommunicationForm({ channel, initial, editing, onSubmit, onCancel, onTypeChange, busy, error, recovery, blocked, extra }) {
  const types = channel === 'email' ? ['smtp', 'api', 'platform'] : ['api'];
  const [type, setType] = useState(initial?.type || types[0]);
  const [values, setValues] = useState(() => ({ ...(initial || {}) }));
  const [secret, setSecret] = useState('');
  useEffect(() => () => setSecret(''), []);
  useEffect(() => { setSecret(''); }, [channel, type]);
  useEffect(() => {
    const clear = () => setSecret('');
    const onVis = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', clear);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('blur', clear); };
  }, []);
  const fields = configurationFields(channel, type);
  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));
  const fieldErrors = error?.fields || {};
  const secretLabel = SECRET[channel === 'email' ? type : channel];
  const submit = (e) => {
    e.preventDefault();
    const input = { type };
    fields.forEach((f) => { input[f] = String(values[f] ?? (f === 'security' ? 'starttls' : '')); });
    setSecret('');
    onSubmit(input);
  };
  const changeType = (t) => { setSecret(''); setType(t); onTypeChange?.(); };
  return <form className="comm__form" onSubmit={submit} noValidate autoComplete="off" data-testid="form-communication">
    {error?.message && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="text-communication-error">{error.message}{recovery && <> <button type="button" className="admin-button admin-button--secondary" onClick={() => { setSecret(''); recovery.run(); }} data-testid="button-communication-recover">{recovery.label}</button></>}</div>}
    <p className="comm__warn" data-testid="text-communication-dummy-warning">Use dummy values only. Never enter real credentials or account details.</p>
    {extra}
    {channel === 'email' && <label className="comm__field">Connection type
      <select value={type} disabled={!!editing} onChange={(e) => changeType(e.target.value)} data-testid="select-communication-type">{types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select>
       {type === 'platform' && <span className="comm__hint">Unconnected platform service preview. Enter your own dummy provider name and endpoint metadata; no built-in service is available.</span>}
    </label>}
    <div className="comm__fields">
      {fields.map((f) => {
        const id = `comm-${f}`; const err = fieldErrors[f];
        return <label key={f} className={`comm__field${err ? ' comm__field--error' : ''}`} htmlFor={id}>{LABELS[f] || f}
          {f === 'security'
            ? <select id={id} value={values[f] || 'starttls'} onChange={(e) => set(f, e.target.value)} aria-invalid={!!err} data-testid={`select-communication-${f}`}>{Object.entries(SECURITY).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            : <input id={id} type="text" value={values[f] || ''} onChange={(e) => set(f, e.target.value)} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} autoComplete="off" inputMode={f === 'port' ? 'numeric' : undefined} data-testid={`input-communication-${f}`} />}
          {f === 'dltEntityId' && <span className="comm__hint">India-specific (DLT) IDs. Not every provider requires them.</span>}
          {f === 'dltTemplateId' && <span className="comm__hint">India-specific (DLT) IDs. Not every provider requires them.</span>}
          {channel === 'waba' && f === 'businessAccountId' && <span className="comm__hint">Provider-specific; values vary. Entering them does not register or verify a WhatsApp account.</span>}
           {channel === 'waba' && f === 'apiVersion' && <span className="comm__hint">Optional for Meta-style configurations, for example v23.0. Provider requirements vary.</span>}
          {f === 'endpoint' && !err && <span className="comm__hint" id={`${id}-hint`}>Metadata only. Use an HTTPS address with no query string or fragment. It is never contacted.</span>}
          {err && <span className="comm__err" id={`${id}-err`}>{err}</span>}
        </label>;
      })}
    </div>
    <div className="comm__secret">
      <label className="comm__field" htmlFor="comm-secret">{secretLabel} (dummy only)
         <input id="comm-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} onBlur={() => setSecret('')} autoComplete="new-password" data-testid="input-communication-secret" aria-describedby="comm-secret-help" />
      </label>
      <span className="comm__hint" id="comm-secret-help">Separate from the saved metadata: never saved or sent, and no credentials are kept. It is always empty when you reopen a configuration, and it clears on save, cancel, type switch, hidden tab or lost focus.</span>
    </div>
    <div className="comm__form-actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { setSecret(''); onCancel(); }} data-testid="button-communication-cancel">Cancel</button>
      <button type="submit" className="admin-button" disabled={busy || blocked} data-testid="button-communication-save">{editing ? 'Save changes' : 'Save configuration'}</button>
    </div>
  </form>;
}
export { CHANNELS };
