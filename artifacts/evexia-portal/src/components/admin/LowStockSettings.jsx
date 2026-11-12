import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { loadLowStockSettings, saveLowStockSettings, reconcileLowStockSettings } from '../../services/serverLowStock.js';
import { configuration, sameConfiguration, validConfiguration, WEEKDAYS, nextRunLabel, formatRun } from '../../services/lowStockSchedule.js';

export default function LowStockSettings({ onGuardChange }) {
  const { user } = useAdminSession();
  const allowed = user?.identity_kind === 'super_admin';
  const confirm = usePlatformConfirm();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(null);
  const state = useRef({});
  const sequence = useRef(0);
  const dirty = Boolean(saved && draft) && JSON.stringify(draft) !== JSON.stringify(configuration(saved));
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 60000); return () => clearInterval(timer); }, []);
  const edit = (values) => { setDraft((value) => ({ ...value, ...values })); setNotice(''); };
  state.current = { busy, dirty, phase };
  async function load(keep = false) {
    if (state.current.busy || pending.current) return;
    state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const result = await loadLowStockSettings();
      if (seq !== sequence.current) return;
      setSaved(result);
      if (!keep) setDraft(configuration(result));
      setPhase(keep ? 'compare' : 'idle');
      if (keep) setNotice('Current saved configuration loaded below. Your edits are kept. Compare before saving again.');
    } catch (cause) {
      if (seq === sequence.current) setError(cause.message || 'Shared low-stock settings could not be loaded.');
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }
  useEffect(() => {
    pending.current = null; state.current.busy = false;
    setSaved(null); setDraft(null); setPhase('idle'); setError(''); setNotice('');
    if (allowed) load();
    return () => { sequence.current++; };
  }, [allowed, user?.id]);
  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy) return false;
      if (pending.current) { setError('Check the unconfirmed save outcome before leaving.'); return false; }
      const ok = !state.current.dirty || await confirm('Discard unsaved Cron Jobs changes?');
      return ok && !state.current.busy && !pending.current;
    });
    return () => onGuardChange?.(null);
  }, [confirm, onGuardChange]);
  function uncertain(cause) {
    return cause?.ambiguous || !cause?.status || cause.status >= 500 || cause.status === 408;
  }
  async function save(event) {
    event.preventDefault();
    if (state.current.busy || pending.current || !saved || !dirty || phase === 'stale') return;
    const config = configuration(draft);
    if (!validConfiguration(config) || draft.additional_emails.some((email) => !email.trim())) {
      setError('Complete the schedule and enter a valid email in each row, or remove empty rows. Use at most 20 additional addresses.'); return;
    }
    if (!await confirm('Save this recurring Low Stock Alert schedule and additional recipients? This does not send a test email.')
        || state.current.busy || pending.current) return;
    const body = Object.freeze({ request_id: crypto.randomUUID(), expected_version: saved.version, ...config });
    pending.current = body; state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const result = await saveLowStockSettings(body);
      if (seq !== sequence.current) return;
      pending.current = null; setSaved(result.saved); setDraft(configuration(result.saved)); setPhase('idle');
      setNotice('Shared recurring configuration saved. The mandatory recipient is unchanged. No email was sent.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      if (uncertain(cause)) {
        setPhase('uncertain'); setError('The save outcome is unknown. Your edit is kept. Check its outcome; nothing will be resent automatically.');
      } else {
        pending.current = null;
        if (cause.status === 409) setPhase('stale');
        setError(cause.status === 422 ? 'The schedule or email list was not accepted. Correct it and save again; your edits are kept.'
          : cause.message || 'The configuration could not be saved. Your edits are kept.');
      }
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }
  async function reconcile() {
    if (!pending.current || state.current.busy) return;
    state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    const request = pending.current;
    try {
      const result = await reconcileLowStockSettings(request.request_id);
      if (seq !== sequence.current) return;
      pending.current = null; setSaved(result.saved);
      // A later version must not silently discard this tab's edits.
      if (result.outcome === 'committed' && result.committed_version === result.saved.version
          && sameConfiguration(request, result.saved)) {
        setDraft(configuration(result.saved)); setPhase('idle'); setNotice('The earlier save was confirmed.');
      } else {
        setPhase('compare');
        setNotice(result.outcome === 'committed' ? 'The earlier save committed, but newer settings exist. Your edit is kept; compare before saving again.'
          : 'The earlier save was cancelled without applying it. Your edit is kept; compare before saving again.');
      }
    } catch (cause) {
      if (seq === sequence.current) setError(cause.message || 'The outcome could not be checked. Your edit is kept.');
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }
  if (!allowed) return <p role="alert">Only the protected Super Admin may manage low-stock email recipients.</p>;
  return <section className="admin-panel admin-settings__section" aria-busy={busy}>
    <h2>Cron Jobs</h2>
    <p>Configure recurring Low Stock Alert emails in Asia/Kolkata (India time), independent of an open browser. This is not an operating-system crontab editor.</p>
    <p><strong>Mandatory protected recipient:</strong> the active protected Super Admin account’s saved email, resolved at delivery time. It cannot be removed here.</p>
    <p>Up to 20 additional addresses receive private separate emails. Duplicate addresses, including the mandatory address, receive only one email per occurrence.</p>
    <p>Uses only the selected Communication Email SMTP. No empty digest, missed-run backlog, test message or automatic resend. Saving schedules only future occurrences.</p>
    {!saved && <p role="status">Configuration and runtime activation are not confirmed. If loading fails, retry or ask an operator to review approved schema activation. No empty configuration is assumed.</p>}
    {busy && <p role="status">Loading, saving or checking shared settings…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {saved && <div>
      <p role="status"><strong>{saved.runtime_status === 'blocked' ? 'Activation blocked. ' : 'Schema eligible; delivery not verified. '}</strong>{saved.runtime_message}</p>
      <p>Saved version {saved.version}: {saved.frequency} at {saved.local_time} Asia/Kolkata
        {saved.frequency === 'weekly' ? ` · ${WEEKDAYS[saved.weekday]}` : saved.frequency === 'monthly' ? ` · day ${saved.month_day}` : ''}
        {' · '}Start: {saved.start_date}. Additional addresses: {saved.additional_emails.join(', ') || 'None'}.</p>
      <p>Next saved scheduled run: <strong>{formatRun(saved.next_run_at)}</strong>. This is a scheduled time, not a delivery promise. Reload to refresh runtime status.</p>
    </div>}
    <form noValidate onSubmit={save}>
      {draft && <fieldset disabled={busy || phase === 'uncertain' || phase === 'stale'}>
        <legend>Recurring event configuration</legend>
        <div className="admin-filter"><label htmlFor="cron-event">Event</label>
          <select id="cron-event" className="admin-input" value="low_stock_alert" onChange={() => {}}><option value="low_stock_alert">Low Stock Alert</option></select></div>
        <div className="admin-filter"><label htmlFor="cron-frequency">Frequency</label>
          <select id="cron-frequency" className="admin-input" value={draft.frequency} onChange={(e) => edit({
            frequency: e.target.value, weekday: e.target.value === 'weekly' ? 0 : null, month_day: e.target.value === 'monthly' ? 1 : null,
          })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        {draft.frequency === 'weekly' && <div className="admin-filter"><label htmlFor="cron-weekday">Weekday</label>
          <select id="cron-weekday" className="admin-input" value={draft.weekday} onChange={(e) => edit({ weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></div>}
        {draft.frequency === 'monthly' && <div className="admin-filter"><label htmlFor="cron-month-day">Day of month</label>
          <input id="cron-month-day" className="admin-input" type="number" min="1" max="31" value={draft.month_day} onChange={(e) => edit({ month_day: e.target.value === '' ? '' : Number(e.target.value) })} />
          <p>Months without this date are skipped, not moved to their last day.</p></div>}
        <div className="admin-filter"><label htmlFor="cron-start">Start date</label>
          <input id="cron-start" className="admin-input" type="date" max="9998-12-31" value={draft.start_date} onChange={(e) => edit({ start_date: e.target.value })} />
          <p>Earliest eligible date, not an extra send. Missed dates are skipped.</p></div>
        <div className="admin-filter"><label htmlFor="cron-time">Local send time · Asia/Kolkata</label>
          <input id="cron-time" className="admin-input" type="time" step="60" value={draft.local_time} onChange={(e) => edit({ local_time: e.target.value })} /></div>
        <p aria-live="polite">Next calendar run for this edit: <strong>{nextRunLabel(configuration(draft), clock)}</strong> (not saved until confirmed; retained legacy claims can suppress the transition week).</p>
        <h3>Additional email addresses</h3>
        <p>Shared encrypted storage. Remove a row to remove that additional address; the mandatory recipient stays.</p>
        {draft.additional_emails.map((email, index) => <div className="admin-filter" key={index}>
          <label htmlFor={`cron-email-${index}`}>Additional email {index + 1}</label>
          <input id={`cron-email-${index}`} className="admin-input" type="email" autoComplete="off" maxLength={254} value={email}
            onChange={(e) => edit({ additional_emails: draft.additional_emails.map((v, i) => i === index ? e.target.value : v) })} />
          <button type="button" className="admin-button admin-button--secondary" aria-label={`Remove additional email ${index + 1}`}
            onClick={() => edit({ additional_emails: draft.additional_emails.filter((_, i) => i !== index) })}>Remove</button>
        </div>)}
        <button type="button" className="admin-button admin-button--secondary" disabled={draft.additional_emails.length >= 20}
          onClick={() => edit({ additional_emails: [...draft.additional_emails, ''] })}>Add email address</button>
      </fieldset>}
      <div className="po-actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || Boolean(pending.current)} onClick={() => load(dirty)}>{dirty ? 'Load saved configuration to compare' : 'Reload saved configuration'}</button>
        <button type="submit" className="admin-button" disabled={busy || !dirty || Boolean(pending.current) || phase === 'stale'}>{phase === 'compare' ? 'Save my compared edit' : 'Save Cron Job'}</button>
        {phase === 'uncertain' && <button type="button" className="admin-button" disabled={busy} onClick={reconcile}>Check save outcome</button>}
        {dirty && <button type="button" className="admin-button admin-button--secondary" disabled={busy || Boolean(pending.current)} onClick={async () => {
          if (await confirm('Discard unsaved Cron Jobs changes?') && !state.current.busy && !pending.current) {
            setDraft(configuration(saved)); setPhase('idle'); setError(''); setNotice('');
          }
        }}>Cancel edits</button>}
      </div>
    </form>
  </section>;
}
