import { useEffect, useRef, useState } from 'react';
import { loadGSTHistory } from '../../services/serverGSTSettings.js';

const schedule = (periods) => periods.map((p) => `${p.rate}% from ${p.applicable_from === '0001-01-01' ? 'opening period' : p.applicable_from}`).join('; ');
export default function GSTHistory({ refreshKey, owner }) {
  const [page, setPage] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [cursors, setCursors] = useState([null]), [index, setIndex] = useState(0);
  const sequence = useRef(0);
  async function load(before = null, target = 0) {
    const seq = ++sequence.current; setBusy(true); setError('');
    try {
      const next = await loadGSTHistory(before);
      if (seq !== sequence.current) return;
      setPage(next); setIndex(target); setCursors((old) => [...old.slice(0, target), before]);
    } catch (cause) { if (seq === sequence.current) setError(cause.message); }
    finally { if (seq === sequence.current) setBusy(false); }
  }
  useEffect(() => { setPage(null); setIndex(0); setCursors([null]); load(); return () => { sequence.current++; }; }, [refreshKey, owner]);
  return <section className="gst-settings__history" aria-labelledby="gst-history" aria-busy={busy}>
    <h3 id="gst-history">GST change history</h3>
    <p className="gst-settings__secondary">Effective date is the business date a rate starts. Recorded timestamp identifies when the authenticated change was recorded. Opening provenance does not identify an original historical author.</p>
    {busy && <p className="gst-settings__notice" role="status">Loading GST history…</p>}
    {error && <div className="gst-settings__notice gst-settings__notice--error"><p role="alert">{error}</p><div className="gst-settings__actions"><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load(cursors[index], index)}>Retry history</button></div></div>}
    {!error && page && <><ol className="gst-settings__revisions">{page.items.map((r) => <li className="gst-settings__card" key={r.version}>
      <h4>Policy revision {r.version} <span className="gst-settings__revision-action">{r.action === 'add' ? 'GST change' : 'Opening policy confirmed'}</span></h4>
      <dl className="gst-settings__history-details"><div><dt>Effective date</dt><dd>{r.effective_date}</dd></div>
        {r.action === 'add' && <div><dt>Prior schedule</dt><dd>{schedule(r.prior)}</dd></div>}
        <div><dt>New schedule</dt><dd>{schedule(r.new)}</dd></div>
        <div><dt>Recorded timestamp</dt><dd><time dateTime={r.recorded_at}>{r.recorded_at}</time></dd></div>
        <div><dt>Verified actor</dt><dd>{r.actor_label} · Authenticated account {r.actor_id}</dd></div></dl>
    </li>)}</ol>{!page.items.length && <p className="gst-settings__empty">No recorded changes. Opening baseline authors and timestamps have not been inferred.</p>}</>}
    <div className="gst-settings__actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load()}>Refresh history</button>
      {index > 0 && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load(cursors[index - 1], index - 1)}>Newer changes</button>}
      {page?.next_before_version && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load(page.next_before_version, index + 1)}>Older changes</button>}
      {page && <span className="gst-settings__secondary" role="status">History page {index + 1}</span>}
    </div>
  </section>;
}
