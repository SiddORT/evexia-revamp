import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { loadGSTSettings, saveGSTSettings, validGSTDate, validGSTRate } from '../../services/serverGSTSettings.js';
import GSTHistory from './GSTHistory.jsx';

const blank = () => ({ rate: '', applicable_from: '' });
export default function GSTSettings({ onGuardChange }) {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const owner = session?.user?.id;
  const confirm = usePlatformConfirm();
  const [saved, setSaved] = useState(null), [draft, setDraft] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState(null), [compared, setCompared] = useState(true);
  const sequence = useRef(0), state = useRef({});
  const dirty = Boolean(draft.rate || draft.applicable_from);
  state.current = { busy, dirty, pending };

  async function load() {
    if (state.current.busy) return;
    state.current.busy = true; setBusy(true); setError('');
    const seq = ++sequence.current;
    try {
      const next = await loadGSTSettings();
      if (seq !== sequence.current) return;
      setSaved(next); setBlocked(false);
      if (state.current.dirty) {
        setCompared(false);
        setNotice('Your draft is kept. Compare it with the loaded schedule, then confirm the comparison before saving.');
      }
    } catch (cause) {
      if (seq === sequence.current) { setError(cause.message); setBlocked(true); }
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }
  useEffect(() => {
    state.current.busy = false;
    setSaved(null); setDraft(blank()); setPending(null); setAdding(false);
    setError(''); setNotice(''); setBlocked(false); setCompared(true);
    if (allowed) load();
    return () => { sequence.current++; };
  }, [allowed, owner]);
  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy || state.current.pending) return false;
      return !state.current.dirty || await confirm('Discard unsaved Applicable GST changes?');
    });
    return () => onGuardChange?.(null);
  }, [onGuardChange, confirm]);

  async function save(action) {
    if (state.current.busy || !saved || (!pending && (blocked || !compared))) return;
    if (!pending && action === 'add' && (!validGSTDate(draft.applicable_from) || !validGSTRate(draft.rate))) {
      setError('Enter a valid Applicable from calendar date and an exact GST percentage from 0 to 100 with up to two decimal places.'); return;
    }
    // Freeze immediately, including while the platform confirmation is open.
    state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      if (!pending && action === 'adopt_approved' && !await confirm('Use 12% through 21 September 2025 and 5% from 22 September 2025? The existing configuration stays as opening provenance. Saved order amounts will not change.')) return;
      const body = pending || {
        action, expected_version: saved.version, request_id: crypto.randomUUID(),
        ...(action === 'add' ? draft : {}),
      };
      setPending(body);
      const next = await saveGSTSettings(body);
      if (seq !== sequence.current) return;
      setSaved(next); setPending(null); setDraft(blank()); setAdding(false);
      setBlocked(false); setCompared(true);
      setNotice('Applicable GST saved with durable history. Saved priced orders are unchanged; future changes apply only from their effective dates.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      setError(cause.message);
      if (cause.ambiguous || !cause.status || cause.status >= 500) {
        setNotice('Keep this editor open. Retry the unchanged save to confirm its outcome; do not record another change.');
      } else {
        setPending(null);
        if (cause.status === 409) { setBlocked(true); setCompared(false); }
      }
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }
  const frozen = busy || Boolean(pending);
  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>Applicable GST</h2><p role="alert">Only the protected Super Admin can manage Applicable GST.</p></section>;
  return <section className="admin-panel admin-settings__section gst-settings" aria-busy={busy}>
    <h2>Applicable GST</h2>
    <p>Approved opening policy: <strong>12% through 21 September 2025; 5% effective 22 September 2025 inclusive.</strong> New changes retain earlier periods. Only first pricing of Kits uses this policy; saved priced orders keep their actual GST and amounts.</p>
    {busy && <p role="status">Loading or saving Applicable GST…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {saved && <>
      <h3>Current rate · {saved.business_date} (Asia/Kolkata)</h3>
      <p>{saved.current.rate}% · Applicable from {saved.current.applicable_from === '0001-01-01' ? 'the opening period' : saved.current.applicable_from} · Policy revision {saved.version}</p>
      {saved.requires_confirmation && <p role="alert">Existing saved configuration conflicts with the approved policy. First pricing is blocked until you intentionally confirm the approved opening policy below.</p>}
      <h3>Effective periods</h3>
      <ol>{saved.periods.filter((p) => p.applicable_from <= saved.business_date).map((p) => {
        const index = saved.periods.indexOf(p), next = saved.periods[index + 1];
        return <li key={p.applicable_from}>{p.rate}% · {p.applicable_from === '0001-01-01' ? 'Opening period' : `From ${p.applicable_from}`} {next ? `until ${next.applicable_from} (exclusive)` : 'onward'}</li>;
      })}</ol>
      <h3>Scheduled GST changes</h3>
      {saved.scheduled.length ? <ol>{saved.scheduled.map((p, i) => <li key={p.applicable_from}>{p.rate}% · Applicable from {p.applicable_from}{saved.scheduled[i + 1] ? ` until ${saved.scheduled[i + 1].applicable_from} (exclusive)` : ' onward'}</li>)}</ol> : <p>No future changes recorded.</p>}
      <h3>Opening baseline · {saved.baseline.source === 'stored_configuration' ? `retained stored configuration (legacy version ${saved.baseline.legacy_version})` : 'approved initial policy'}</h3>
      <p>{saved.baseline.before_rate}% before {saved.baseline.cutoff_date}; {saved.baseline.on_after_rate}% on or after {saved.baseline.cutoff_date}. Original author and recorded timestamp: unavailable. This is provenance, not an invented historical audit event.</p>
      {!saved.configured && <button type="button" className="admin-button" disabled={frozen || blocked} onClick={() => save('adopt_approved')}>Confirm approved opening policy</button>}
      <button type="button" className="admin-button admin-button--secondary" disabled={frozen || saved.requires_confirmation} onClick={() => setAdding(true)}>Add GST change</button>
    </>}
    {adding && <form onSubmit={(e) => { e.preventDefault(); save('add'); }} noValidate>
      <fieldset className="gst-settings__fields" disabled={frozen || !saved}>
        <legend>Add GST change</legend>
        <div className="gst-settings__field"><label htmlFor="gst-rate">GST percentage (%)</label>
          <input id="gst-rate" value={draft.rate} inputMode="decimal" maxLength={6} aria-describedby="gst-help" onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} /></div>
        <div className="gst-settings__field"><label htmlFor="gst-from">Applicable from</label>
          <input id="gst-from" type="date" min="0001-01-01" max="9999-12-31" value={draft.applicable_from} aria-describedby="gst-help" onChange={(e) => setDraft((d) => ({ ...d, applicable_from: e.target.value }))} /></div>
      </fieldset>
      <p id="gst-help">Use 0–100 with up to two decimal places. Calendar dates include future dates. Each effective date must be distinct. A future change does not replace today's rate.</p>
      {!compared && <label><input type="checkbox" disabled={frozen} checked={compared} onChange={(e) => setCompared(e.target.checked)} /> I compared my draft against the loaded saved schedule.</label>}
      <div className="gst-settings__actions">
        <button type="submit" className="admin-button" disabled={frozen || blocked || !compared || !dirty}>Save GST change</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={frozen} onClick={async () => {
          if (dirty && !await confirm('Discard unsaved GST change?')) return;
          setDraft(blank()); setAdding(false); setCompared(true); setError('');
        }}>Cancel edits</button>
      </div>
    </form>}
    {blocked && <p role="alert">Load saved policy and compare before saving again. Your draft is preserved.</p>}
    <div className="gst-settings__actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={frozen} onClick={load}>Load saved policy</button>
      {pending && <button type="button" className="admin-button" disabled={busy} onClick={() => save(pending.action)}>Retry unchanged GST save</button>}
    </div>
    {saved && <GSTHistory refreshKey={saved.version} owner={owner} />}
  </section>;
}
