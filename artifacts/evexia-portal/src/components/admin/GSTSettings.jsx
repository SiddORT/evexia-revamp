import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { loadGSTSettings, saveGSTSettings, validGSTDate, validGSTRate } from '../../services/serverGSTSettings.js';

const toDraft = (saved) => ({
  cutoff_date: saved.cutoff_date ?? '', before_rate: saved.before_rate ?? '', on_after_rate: saved.on_after_rate ?? '',
});
const same = (a, b) => a && b && ['cutoff_date', 'before_rate', 'on_after_rate'].every((key) => a[key] === b[key]);

export default function GSTSettings({ onGuardChange }) {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const owner = session?.user?.id;
  const confirm = usePlatformConfirm();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const state = useRef({});
  const dirty = Boolean(draft && saved && !same(draft, toDraft(saved)));
  state.current = { busy, dirty };

  async function load(keepDraft = false) {
    if (state.current.busy) return;
    state.current.busy = true;
    const seq = ++sequence.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await loadGSTSettings();
      if (seq !== sequence.current) return;
      setSaved(next);
      if (!keepDraft) { setDraft(toDraft(next)); setFields({}); }
      setBlocked(false);
      if (keepDraft) setNotice('Saved settings loaded below. Your edits are kept. Compare all three saved values before saving, or cancel edits to use the saved values.');
    } catch (cause) {
      if (seq === sequence.current) { setError(cause.message); setBlocked(true); }
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }

  useEffect(() => {
    state.current.busy = false;
    setSaved(null); setDraft(null); setError(''); setNotice(''); setFields({}); setBlocked(false);
    if (allowed) load();
    return () => { sequence.current++; };
  }, [allowed, owner]);
  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy) return false;
      const ok = !state.current.dirty || await confirm('Discard unsaved GST Settings changes?');
      return ok && !state.current.busy;
    });
    return () => onGuardChange?.(null);
  }, [onGuardChange, confirm]);

  async function save(event) {
    event.preventDefault();
    if (state.current.busy || blocked || !saved || !dirty) return;
    const invalid = {};
    if (!validGSTDate(draft.cutoff_date)) invalid.cutoff_date = 'Enter a valid calendar date.';
    for (const key of ['before_rate', 'on_after_rate']) {
      if (!validGSTRate(draft[key])) invalid[key] = 'Enter 0 to 100 with up to two decimal places.';
    }
    setFields(invalid); setError(''); setNotice('');
    if (Object.keys(invalid).length) { setError('Check the highlighted GST fields. Nothing was sent.'); return; }
    state.current.busy = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const next = await saveGSTSettings({ ...draft, expected_version: saved.version });
      if (seq !== sequence.current) return;
      setSaved(next); setDraft(toDraft(next));
      setNotice('GST Settings saved for future order processing. Orders and calculations are unchanged.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      setError(cause.message);
      if (cause.status === 409 || cause.ambiguous || !cause.status || cause.status >= 500) setBlocked(true);
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }

  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>GST Settings</h2><p role="alert">Only the protected Super Admin can manage GST Settings.</p></section>;
  return <section className="admin-panel admin-settings__section gst-settings" aria-busy={busy}>
    <h2>GST Settings</h2>
    <p>Shared across sessions and devices. This configuration is saved for future order processing and does not currently change orders or calculations.</p>
    <p id="gst-boundary-help">Before means dates strictly earlier than the cutoff. The exact cutoff date belongs to the on or after period. Calendar dates do not shift with time zones.</p>
    {busy && <p role="status">Loading or saving shared GST Settings…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {saved && <div className="gst-settings__saved">
      <strong>Last loaded saved settings · Version {saved.version}</strong>
      {saved.configured ? <dl>
        <div><dt>Cutoff date</dt><dd>{saved.cutoff_date}</dd></div>
        <div><dt>GST before cutoff</dt><dd>{saved.before_rate}%</dd></div>
        <div><dt>GST on or after cutoff</dt><dd>{saved.on_after_rate}%</dd></div>
      </dl> : <p>Not configured. No cutoff date or GST rates have been assumed.</p>}
    </div>}
    {!draft && !busy && <p>No saved configuration has been loaded. Load saved settings to enable editing.</p>}
    <form onSubmit={save} noValidate>
      <fieldset disabled={busy || !draft} className="gst-settings__fields" aria-describedby="gst-boundary-help gst-rate-help">
        <legend>GST configuration</legend>
        {[
          ['cutoff_date', 'Cutoff date', 'date'],
          ['before_rate', 'GST before cutoff (%)', 'text'],
          ['on_after_rate', 'GST on or after cutoff (%)', 'text'],
        ].map(([key, label, type]) => <div className="gst-settings__field" key={key}>
          <label htmlFor={`gst-${key}`}>{label}</label>
          <input id={`gst-${key}`} type={type} value={draft?.[key] ?? ''} required
            min={type === 'date' ? '0001-01-01' : undefined} max={type === 'date' ? '9999-12-31' : undefined}
            inputMode={type === 'text' ? 'decimal' : undefined} maxLength={type === 'text' ? 6 : undefined}
            aria-invalid={Boolean(fields[key])} aria-describedby={`${type === 'date' ? 'gst-boundary-help' : 'gst-rate-help'}${fields[key] ? ` gst-${key}-error` : ''}`}
            onChange={(event) => { setDraft((previous) => ({ ...previous, [key]: event.target.value })); setFields((previous) => ({ ...previous, [key]: '' })); setNotice(''); }} />
          {fields[key] && <span id={`gst-${key}-error`} className="admin-feedback--error">{fields[key]}</span>}
        </div>)}
      </fieldset>
      <p id="gst-rate-help">Both rates are required. Use 0 to 100, with up to two decimal places. Zero is valid; blank does not mean zero.</p>
      {blocked && <p role="alert">Load saved settings before saving again. Your edits will be kept for comparison; reloading does not resubmit them.</p>}
      <div className="gst-settings__actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load(Boolean(draft))}>Load saved settings</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || !saved} onClick={() => { setDraft(toDraft(saved)); setFields({}); setError(''); setNotice('Unsaved edits cancelled.'); }}>Cancel edits</button>
        <button type="submit" className="admin-button" disabled={busy || !dirty || blocked}>Save GST settings</button>
      </div>
    </form>
  </section>;
}
