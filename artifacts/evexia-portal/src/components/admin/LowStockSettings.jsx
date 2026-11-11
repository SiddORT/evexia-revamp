import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { loadLowStockSettings, saveLowStockSettings, reconcileLowStockSettings } from '../../services/serverLowStock.js';

export default function LowStockSettings({ onGuardChange }) {
  const { user } = useAdminSession();
  const allowed = user?.identity_kind === 'super_admin';
  const confirm = usePlatformConfirm();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(null);
  const state = useRef({});
  const sequence = useRef(0);
  const dirty = Boolean(saved) && draft !== (saved.additional_email || '');
  state.current = { busy, dirty, phase };
  async function load(keep = false) {
    if (state.current.busy || pending.current) return;
    state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const result = await loadLowStockSettings();
      if (seq !== sequence.current) return;
      setSaved(result);
      if (!keep) setDraft(result.additional_email || '');
      setPhase(keep ? 'compare' : 'idle');
      if (keep) setNotice('Current saved recipient loaded below. Your edit is kept. Compare it before saving again.');
    } catch (cause) {
      if (seq === sequence.current) setError(cause.message || 'Shared low-stock settings could not be loaded.');
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }
  useEffect(() => {
    pending.current = null; state.current.busy = false;
    setSaved(null); setDraft(''); setPhase('idle'); setError(''); setNotice('');
    if (allowed) load();
    return () => { sequence.current++; };
  }, [allowed, user?.id]);
  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy) return false;
      if (pending.current) { setError('Check the unconfirmed save outcome before leaving.'); return false; }
      const ok = !state.current.dirty || await confirm('Discard unsaved low-stock recipient changes?');
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
    const email = draft.trim();
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError('Enter a valid email address, or leave blank to remove only the additional recipient.'); return;
    }
    const body = Object.freeze({ request_id: crypto.randomUUID(), expected_version: saved.version, additional_email: email || null });
    pending.current = body; state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const result = await saveLowStockSettings(body);
      if (seq !== sequence.current) return;
      pending.current = null; setSaved(result.saved); setDraft(result.saved.additional_email || ''); setPhase('idle');
      setNotice('Shared recipient saved. The mandatory Super Admin recipient is unchanged. No email was sent by this action.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      if (uncertain(cause)) {
        setPhase('uncertain'); setError('The save outcome is unknown. Your edit is kept. Check its outcome; nothing will be resent automatically.');
      } else {
        pending.current = null;
        if (cause.status === 409) setPhase('stale');
        setError(cause.status === 422 ? 'Email was not accepted. Correct it and save again; your edit is kept.'
          : cause.message || 'The recipient could not be saved. Your edit is kept.');
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
          && (request.additional_email || '').toLowerCase() === (result.saved.additional_email || '').toLowerCase()) {
        setDraft(result.saved.additional_email || ''); setPhase('idle'); setNotice('The earlier save was confirmed.');
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
    <h2>Low Stock Alerts</h2>
    <p>Weekly email digest: Monday at 10:00 AM Asia/Kolkata (India time), independent of an open browser.</p>
    <p>The protected active Super Admin account’s saved email is mandatory. One optional additional recipient receives a separate email; equal addresses are deduplicated. Blank removes only the additional recipient.</p>
    <p>Uses only the selected Email SMTP configuration in Communication. No empty digest, historical catch-up or automatic resend of an accepted or uncertain delivery.</p>
    {busy && <p role="status">Loading, saving or checking shared settings…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {saved && <p>Last loaded saved version {saved.version} · Additional recipient: <strong>{saved.additional_email || 'Not set'}</strong></p>}
    <form noValidate onSubmit={save}>
      <div className="admin-filter"><label htmlFor="low-stock-email">Additional low-stock email</label>
        <input id="low-stock-email" className="admin-input" type="email" autoComplete="off" maxLength={254} value={draft}
          disabled={busy || !saved || phase === 'uncertain' || phase === 'stale'} onChange={(e) => { setDraft(e.target.value); setNotice(''); }}
          aria-describedby="low-stock-email-help" />
        <p id="low-stock-email-help">Shared encrypted storage. Saving does not send a test message or replay this week’s consumed digest.</p></div>
      <div className="po-actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || Boolean(pending.current)} onClick={() => load(dirty)}>{dirty ? 'Load saved recipient to compare' : 'Reload saved recipient'}</button>
        <button type="submit" className="admin-button" disabled={busy || !dirty || Boolean(pending.current) || phase === 'stale'}>{phase === 'compare' ? 'Save my compared edit' : 'Save recipient'}</button>
        {phase === 'uncertain' && <button type="button" className="admin-button" disabled={busy} onClick={reconcile}>Check save outcome</button>}
        {dirty && <button type="button" className="admin-button admin-button--secondary" disabled={busy || Boolean(pending.current)} onClick={async () => {
          if (await confirm('Discard unsaved low-stock recipient changes?') && !state.current.busy && !pending.current) {
            setDraft(saved.additional_email || ''); setPhase('idle'); setError(''); setNotice('');
          }
        }}>Cancel edits</button>}
      </div>
    </form>
  </section>;
}
