import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdminDateFormatters } from './adminPreferences.js';
import { roleUrlRequest } from '../../auth/adminSession.js';

const past = (v) => { const t = v ? new Date(v).getTime() : NaN; return !Number.isNaN(t) && t <= Date.now(); };

function label(d) {
  if (!d) return 'Unverified, inactive';
  const s = d.status || 'unverified';
  if (d.verified_at && past(d.verification_expires_at)) return 'Verification expired, inactive';
  if (d.challenge_name && !d.verified_at && past(d.challenge_expires_at)) return 'Challenge expired, inactive';
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}, ${d.active ? 'active' : 'inactive'}`;
}

export default function PrimaryDomainPanel({ items, domains, bootstrapHosts, listReady, onReload, onDomainUpdate, onSaved, onDirtyChange, parentBusy, onBusyChange }) {
  const { timestamp } = useAdminDateFormatters();
  const fmt = (value) => timestamp(value, true);
  const primary = useMemo(() => domains.find((d) => d.kind === 'primary') || null, [domains]);
  const current = primary?.hostname || '';
  const [draft, setDraft] = useState(null); // null = no draft
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rowMsg, setRowMsg] = useState({});
  const [pendingKey, setPendingKey] = useState('');
  const base = useRef(current);
  const expected = useRef({ hostname: primary?.hostname || null, version: primary?.version || 0 });
  const dirty = draft !== null && draft !== base.current;
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => { onDirtyRef.current?.(dirty); }, [dirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  const options = useMemo(() => {
    const set = new Set(items.map((i) => i.hostname));
    if (current) set.add(current);
    return [...set];
  }, [items, current]);
  const roleOf = (h) => items.find((i) => i.hostname === h);
  const locked = busy || uncertain || stale || parentBusy;
  const value = draft ?? current;

  const rows = useMemo(() => {
    const seen = new Set(); const out = [];
    const add = (h) => { if (h && !seen.has(h)) { seen.add(h); out.push({ hostname: h, domain: domains.find((d) => d.hostname === h) || null }); } };
    add(current); items.forEach((i) => add(i.hostname)); domains.forEach((d) => add(d.hostname));
    return out;
  }, [domains, items, current]);

  const fail = (e, setter) => {
    if (e?.status === 409) { setUncertain(true); setter(`${e.message || 'Domain configuration changed.'} Your draft is kept. Nothing was retried. Reload and review the current state before trying again.`); }
    else if (e?.ambiguous) { setUncertain(true); setter('The result is uncertain and will not be retried automatically. Reload and review the current state to see whether it applied.'); }
    else if (e?.status === 429) setter(e?.message || 'DNS checks are limited to one every 30 seconds. Wait and try again.');
    else setter(e?.message || 'The request failed. Nothing was changed.');
  };

  const savePrimary = async (e) => {
    e.preventDefault();
    if (locked || !dirty || !draft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await roleUrlRequest('/primary', { hostname: draft, previous_hostname: expected.current.hostname, version: expected.current.version });
      onDomainUpdate(saved);
      setDraft(null); setNotice('Primary domain saved. Ownership evidence was reset; verify it again.');
      await onSaved();
    } catch (err) { fail(err, setError); } finally { setBusy(false); }
  };
  const reload = async () => {
    if (await onReload()) { setError(''); setRowMsg({}); setUncertain(false); if (draft !== null) setStale(true); setNotice('Reloaded. Review the current state below.'); }
  };
  const review = () => { base.current = current; expected.current = { hostname: primary?.hostname || null, version: primary?.version || 0 }; setStale(false); setNotice('Current primary reviewed. Your draft is kept; saving will use the reviewed version.'); };
  const startDraft = () => { base.current = current; expected.current = { hostname: primary?.hostname || null, version: primary?.version || 0 }; setDraft(current); setError(''); setNotice(''); };
  const cancel = () => {
    if (dirty && !window.confirm('Discard unsaved Role URL changes?')) return;
    setDraft(null); setStale(false); setError('');
  };

  const act = async (row, action) => {
    if (locked) return;
    const key = `${row.hostname}:${action}`;
    if (action === 'revoke' && !window.confirm(`Revoke ${row.hostname}? Ownership and admission will be removed.`)) return;
    setPendingKey(key); setBusy(true); setRowMsg((m) => ({ ...m, [row.hostname]: '' })); setNotice('');
    try {
      const d = await roleUrlRequest('/domain-action', { hostname: row.hostname, version: row.domain?.version || 0, action });
      if (d) onDomainUpdate(d);
      const ok = { challenge: 'Challenge created. Add the TXT record, then check it.', verify: d?.verified_at ? 'Ownership verified. The domain is not active until you activate it.' : 'DNS check finished. The TXT record was not confirmed yet; DNS can take time to propagate.', activate: 'Domain activated.', revoke: 'Ownership and admission revoked.' }[action];
      setRowMsg((m) => ({ ...m, [row.hostname]: ok }));
    } catch (err) { fail(err, (msg) => setRowMsg((m) => ({ ...m, [row.hostname]: msg }))); }
    finally { setBusy(false); setPendingKey(''); }
  };

  return <div className="role-urls__primary" data-testid="panel-primary-domain">
    <h3>Primary domain</h3>
    <p>The primary domain is the shared main address for the portal chooser and existing role paths, not an Admin role. Enter an exact hostname. Changing it resets ownership evidence. Disable a conflicting role mapping before choosing the same hostname.</p>
    <p data-testid="text-primary-current"><strong>Current:</strong> {current || 'None set'} {primary && <span className="role-urls__badge">{label(primary)}</span>}</p>
    {draft === null ? <button type="button" onClick={startDraft} disabled={locked || !listReady} data-testid="button-primary-edit">{current ? 'Change primary domain' : 'Choose primary domain'}</button>
      : <form className="role-urls__form" onSubmit={savePrimary} aria-label="Edit primary domain" data-testid="form-primary-domain">
        <label>Primary hostname<input value={value} onChange={(e) => setDraft(e.target.value)} disabled={locked} maxLength={270} required autoComplete="off" list="primary-hostname-options" data-testid="input-primary-hostname" /></label>
        <datalist id="primary-hostname-options">{options.map((h) => <option key={h} value={h}>{roleOf(h)?.role || 'Primary'}</option>)}</datalist>
        {error && <p role="alert" className="role-urls__error">{error}</p>}
        {stale && <div role="status"><p>{`Current primary on the server: ${current || 'none'} (version ${primary?.version || 0}). Compare it with your draft before continuing.`}</p>
          <button type="button" onClick={review} data-testid="button-primary-review">I reviewed the current primary; keep my draft</button></div>}
        <div className="role-urls__actions">
          <button type="submit" disabled={locked || !dirty} data-testid="button-primary-save">{busy && !pendingKey ? 'Saving...' : 'Save primary'}</button>
          {uncertain && <button type="button" onClick={reload} disabled={busy} data-testid="button-primary-reload">Reload to review</button>}
          <button type="button" onClick={cancel} disabled={busy} data-testid="button-primary-cancel">Cancel</button>
        </div>
      </form>}
    {draft === null && error && <p role="alert" className="role-urls__error">{error}</p>}
    <div role="status" className="role-urls__notice">{notice}</div>
    {uncertain && draft === null && <div className="role-urls__actions"><p role="alert" className="role-urls__error">Domain state is uncertain. DNS actions are disabled until you reload.</p>
      <button type="button" onClick={reload} disabled={busy} data-testid="button-domain-reload">Reload to review</button></div>}

    <h3>DNS ownership and admission</h3>
    <p>For each hostname: create a challenge, add the TXT record at your DNS provider, check it, then activate. Verification lasts 30 days and does not activate the domain. Challenges expire after 24 hours, and DNS actions are limited to one every 30 seconds. Editing a mapping resets its evidence.</p>
    {rows.length === 0 ? <p className="role-urls__empty">Add a Role URL to manage its domain ownership.</p>
      : <ul className="role-urls__list">{rows.map(({ hostname, domain: d }) => {
        const challengeLive = Boolean(d?.challenge_value && d?.challenge_expires_at && !past(d.challenge_expires_at));
        const verifiedLive = d?.verified_at && !past(d.verification_expires_at);
        const btn = (action, text, enabled) => <button type="button" onClick={() => act({ hostname, domain: d }, action)} disabled={locked || !enabled} aria-label={`${text} ${hostname}`} data-testid={`button-domain-${action}-${hostname}`}>{pendingKey === `${hostname}:${action}` ? 'Working...' : text}</button>;
        return <li key={hostname} data-testid={`row-domain-${hostname}`}>
          <div>
            <strong>{hostname}</strong>{d?.kind === 'primary' && <span className="role-urls__badge">Primary</span>}
            <small>{label(d)}</small>
            {!d && <small>No ownership record yet. Create a challenge to begin.</small>}
            {d && <small>{({
              unverified: 'Create a challenge to begin ownership verification.',
              pending: 'Add the exact TXT value below, then check DNS after propagation.',
              failed: 'No matching TXT value was found. Check the exact name and value, wait for DNS propagation, then retry.',
              unavailable: 'DNS could not be checked. Keep your TXT record and retry after 30 seconds.',
              verified: 'Ownership evidence does not configure DNS binding, TLS, deployment or infrastructure readiness.',
              revoked: 'Admission and ownership are revoked. Create a new challenge before activating again.',
              expired: 'Evidence expired. Create a new challenge and verify again.',
            })[d.status]}</small>}
            <small>Verified: {fmt(d?.verified_at)}{d?.verified_at ? ` (expires ${fmt(d.verification_expires_at)})` : ''}</small>
            <small>Last checked: {fmt(d?.last_checked_at)}</small>
            {challengeLive && <div className="role-urls__txt" data-testid={`text-challenge-${hostname}`}>
              <p>Add this DNS TXT record, then choose Check DNS:</p>
              <dl><dt>Type</dt><dd>TXT</dd><dt>Name</dt><dd><code>{d.challenge_name}</code></dd><dt>Value</dt><dd><code>{d.challenge_value}</code></dd></dl>
              <small>Challenge expires {fmt(d.challenge_expires_at)}</small>
            </div>}
            {d?.challenge_expires_at && !challengeLive && !verifiedLive && <small className="role-urls__error">The challenge expired {fmt(d.challenge_expires_at)}. Create a new challenge.</small>}
            {d?.verified_at && !verifiedLive && <small className="role-urls__error">Verification expired. Create a new challenge and verify again.</small>}
            {rowMsg[hostname] && <p role="status" className="role-urls__rowmsg">{rowMsg[hostname]}</p>}
          </div>
          <div className="role-urls__actions">
            {btn('challenge', challengeLive ? 'New challenge' : 'Create challenge', true)}
            {btn('verify', 'Check DNS', Boolean(challengeLive))}
            {btn('activate', 'Activate', Boolean(verifiedLive) && !d?.active)}
            {btn('revoke', 'Revoke', Boolean(d?.challenge_value || d?.verified_at || d?.active))}
          </div>
        </li>; })}</ul>}

    <h3>Recovery allowlist</h3>
    <p>These hosts stay reachable so you can recover if a domain is misconfigured. Being listed grants no role and no ownership.</p>
    {bootstrapHosts.length ? <ul className="role-urls__hosts" data-testid="list-bootstrap-hosts">{bootstrapHosts.map((h) => <li key={h}><code>{h}</code></li>)}</ul> : <p className="role-urls__empty">No recovery hosts were reported by the server.</p>}
  </div>;
}
