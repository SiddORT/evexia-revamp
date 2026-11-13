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
  if (!allowed) return <section className="admin-panel admin-settings__section gst-settings"><h2>Applicable GST</h2><p className="gst-settings__notice gst-settings__notice--error" role="alert">Only the protected Super Admin can manage Applicable GST.</p></section>;
  return <section className="admin-panel admin-settings__section gst-settings" aria-busy={busy}>
    <header className="gst-settings__header">
      <h2>Applicable GST</h2>
      <p>Only first pricing of Kits uses this policy; saved priced orders keep their actual GST and amounts. New changes retain earlier periods.</p>
      <p className="gst-settings__approved">Approved opening policy: <strong>12% through 21 September 2025; 5% effective 22 September 2025 inclusive.</strong></p>
    </header>
    {busy && <p className="gst-settings__notice" role="status">Loading or saving Applicable GST…</p>}
    {error && <p className="gst-settings__notice gst-settings__notice--error" role="alert">{error}</p>}
    {notice && <p className={`gst-settings__notice${pending ? ' gst-settings__notice--warning' : ''}`} role="status">{notice}</p>}
    {saved && <>
      <section className={`gst-settings__current${saved.requires_confirmation ? ' gst-settings__current--unconfirmed' : ''}`} aria-labelledby="gst-current">
        <div>
          <h3 id="gst-current">Current rate</h3>
          <p className="gst-settings__rate">{saved.current.rate}<span>%</span></p>
          {saved.requires_confirmation && <p className="gst-settings__unconfirmed">Unconfirmed · First pricing blocked</p>}
        </div>
        <dl className="gst-settings__metadata">
          <div><dt>Applicable from</dt><dd>{saved.current.applicable_from === '0001-01-01' ? 'The opening period' : saved.current.applicable_from}</dd></div>
          <div><dt>Business date</dt><dd>{saved.business_date}<span className="gst-settings__secondary">Asia/Kolkata</span></dd></div>
          <div><dt>Policy revision</dt><dd>{saved.version}</dd></div>
        </dl>
      </section>
      {saved.requires_confirmation && <section className="gst-settings__notice gst-settings__notice--warning" aria-labelledby="gst-conflict">
        <div role="alert">
          <h3 id="gst-conflict">Opening policy needs confirmation</h3>
          <p>Existing saved configuration conflicts with the approved policy. First pricing is blocked until you intentionally confirm the approved opening policy below.</p>
        </div>
        {!saved.configured && <div className="gst-settings__actions"><button type="button" className="admin-button" disabled={frozen || blocked} onClick={() => save('adopt_approved')}>Confirm approved opening policy</button></div>}
      </section>}
      <div className="gst-settings__columns">
        <section className="gst-settings__card" aria-labelledby="gst-periods">
          <h3 id="gst-periods">Effective periods</h3>
          <ol className="gst-settings__periods">{saved.periods.filter((p) => p.applicable_from <= saved.business_date).map((p) => {
            const index = saved.periods.indexOf(p), next = saved.periods[index + 1];
            return <li key={p.applicable_from}><strong>{p.rate}%</strong><span>{p.applicable_from === '0001-01-01' ? 'Opening period' : `From ${p.applicable_from}`}<span className="gst-settings__secondary">{next ? `until ${next.applicable_from} (exclusive)` : 'onward'}</span></span></li>;
          })}</ol>
        </section>
        <section className="gst-settings__card" aria-labelledby="gst-scheduled">
          <h3 id="gst-scheduled">Scheduled GST changes</h3>
          {saved.scheduled.length ? <ol className="gst-settings__periods">{saved.scheduled.map((p, i) => <li key={p.applicable_from}><strong>{p.rate}%</strong><span>Applicable from {p.applicable_from}<span className="gst-settings__secondary">{saved.scheduled[i + 1] ? `until ${saved.scheduled[i + 1].applicable_from} (exclusive)` : 'onward'}</span></span></li>)}</ol> : <p className="gst-settings__empty">No future changes recorded.</p>}
        </section>
      </div>
      <section className="gst-settings__card gst-settings__baseline" aria-labelledby="gst-baseline">
        <h3 id="gst-baseline">Retained opening baseline</h3>
        <p className="gst-settings__secondary">{saved.baseline.source === 'stored_configuration' ? `Retained stored configuration (legacy version ${saved.baseline.legacy_version})` : 'Approved initial policy'}</p>
        <p className="gst-settings__figures"><strong>{saved.baseline.before_rate}%</strong> before {saved.baseline.cutoff_date}; <strong>{saved.baseline.on_after_rate}%</strong> on or after {saved.baseline.cutoff_date}.</p>
        <p className="gst-settings__secondary">Original author and recorded timestamp: unavailable. This is provenance, not an invented historical audit event.</p>
      </section>
      <div className="gst-settings__actions">
        {!saved.configured && !saved.requires_confirmation && <button type="button" className="admin-button" disabled={frozen || blocked} onClick={() => save('adopt_approved')}>Confirm approved opening policy</button>}
        <button type="button" className="admin-button admin-button--secondary" disabled={frozen || saved.requires_confirmation} onClick={() => setAdding(true)}>Add GST change</button>
      </div>
    </>}
    {adding && <form className="gst-settings__editor" onSubmit={(e) => { e.preventDefault(); save('add'); }} noValidate>
      <fieldset className="gst-settings__fields" disabled={frozen || !saved}>
        <legend>Add GST change</legend>
        <div className="gst-settings__field"><label htmlFor="gst-rate">GST percentage (%)</label>
          <input id="gst-rate" value={draft.rate} inputMode="decimal" maxLength={6} aria-describedby="gst-help" onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} /></div>
        <div className="gst-settings__field"><label htmlFor="gst-from">Applicable from</label>
          <input id="gst-from" type="date" min="0001-01-01" max="9999-12-31" value={draft.applicable_from} aria-describedby="gst-help" onChange={(e) => setDraft((d) => ({ ...d, applicable_from: e.target.value }))} /></div>
      </fieldset>
      <p id="gst-help" className="gst-settings__secondary">Use 0–100 with up to two decimal places. Calendar dates include future dates. Each effective date must be distinct. A future change does not replace today's rate.</p>
      {!compared && <label className="gst-settings__comparison"><input type="checkbox" disabled={frozen} checked={compared} onChange={(e) => setCompared(e.target.checked)} /> <span>I compared my draft against the loaded saved schedule.</span></label>}
      <div className="gst-settings__actions">
        <button type="submit" className="admin-button" disabled={frozen || blocked || !compared || !dirty}>Save GST change</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={frozen} onClick={async () => {
          if (dirty && !await confirm('Discard unsaved GST change?')) return;
          setDraft(blank()); setAdding(false); setCompared(true); setError('');
        }}>Cancel edits</button>
      </div>
    </form>}
    {blocked && <p className="gst-settings__notice gst-settings__notice--warning" role="alert">Load saved policy and compare before saving again. Your draft is preserved.</p>}
    <div className="gst-settings__actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={frozen} onClick={load}>Load saved policy</button>
      {pending && <button type="button" className="admin-button" disabled={busy} onClick={() => save(pending.action)}>Retry unchanged GST save</button>}
    </div>
    {saved && <GSTHistory refreshKey={saved.version} owner={owner} />}
  </section>;
}
