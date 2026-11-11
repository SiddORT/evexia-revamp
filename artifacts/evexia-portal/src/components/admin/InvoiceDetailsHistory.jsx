import { useEffect, useRef, useState } from 'react';
import { FIELD_LABELS, loadInvoiceHistory } from '../../services/serverInvoiceSettings.js';
import InvoiceQRInspectDialog from './InvoiceQRInspectDialog.jsx';

function Text({ value }) {
  return value === '' ? <span className="invd-blank">(blank)</span> : <span>{value}</span>;
}

function formatWhen(iso) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

// Read-only, paginated history. refreshKey changes after each confirmed save.
export default function InvoiceDetailsHistory({ refreshKey, owner }) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [cursors, setCursors] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inspect, setInspect] = useState(null);
  const sequence = useRef(0);

  async function load(before = null, targetPage = 0) {
    const seq = ++sequence.current;
    setBusy(true); setError('');
    try {
      const page = await loadInvoiceHistory(before);
      if (seq !== sequence.current) return;
      setItems(page.items);
      setNext(page.next_before_version);
      setPageIndex(targetPage);
      setCursors((previous) => [...previous.slice(0, targetPage), before]);
      setLoaded(true);
    } catch (cause) {
      if (seq === sequence.current) setError(cause?.message || 'Change history could not be loaded.');
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }

  useEffect(() => { setItems([]); setNext(null); setCursors([null]); setPageIndex(0); setLoaded(false); setInspect(null); load(); return () => { sequence.current++; }; }, [refreshKey, owner]);

  return <section className="admin-panel admin-settings__section invd-history" aria-labelledby="invd-history-heading" aria-busy={busy}>
    <h3 id="invd-history-heading">Change history</h3>
    <p>Read-only. Each saved version records who changed which fields, with before and after values. Restricted to the protected Super Admin.</p>
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}
      <button type="button" className="admin-button admin-button--secondary" disabled={busy} data-testid="button-retry-history" onClick={() => load(cursors[pageIndex], pageIndex)}>Retry history</button></div>}
    {!busy && !error && loaded && items.length === 0 && <p data-testid="text-history-empty">No saved versions yet. The first save will appear here with every field, including blanks.</p>}
    <ol>{items.map((item) => <li key={item.version} className="invd-rev" data-testid={`row-history-${item.version}`}>
      <div className="invd-rev__head"><strong>Version {item.version}</strong><time dateTime={item.changed_at}>{formatWhen(item.changed_at)}</time><span>by {item.actor.label}</span><small>Authenticated account: {item.actor.id}</small></div>
      {item.changes.length === 0 && <p className="invd-blank">No field values changed.</p>}
      {item.changes.length > 0 && <div className="invd-scroll" tabIndex={0} role="region" aria-label={`Changed fields for version ${item.version}`}><table className="invd-compare">
        <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>{item.changes.map((change, index) => <tr key={`${change.field}-${index}`}>
          <th scope="row">{FIELD_LABELS[change.field] || change.field}</th><td><Text value={change.before} /></td><td><Text value={change.after} /></td>
        </tr>)}</tbody>
      </table></div>}
      {(item.qr_before || item.qr_after) && <div className="invd-actions">
        {item.qr_before && <button type="button" className="admin-button admin-button--secondary" data-testid={`button-inspect-qr-before-${item.version}`}
          onClick={() => setInspect({ version: item.qr_before.version, label: `QR before version ${item.version}` })}>Inspect QR before (v{item.qr_before.version})</button>}
        {item.qr_after && <button type="button" className="admin-button admin-button--secondary" data-testid={`button-inspect-qr-after-${item.version}`}
          onClick={() => setInspect({ version: item.qr_after.version, label: `QR after version ${item.version}` })}>Inspect QR after (v{item.qr_after.version})</button>}
      </div>}
    </li>)}</ol>
    {busy && <div className="invd-skeleton" aria-label="Loading history" />}
    <div className="invd-actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={busy} data-testid="button-refresh-history" onClick={() => load()}>Refresh history</button>
      {pageIndex > 0 && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load(cursors[pageIndex - 1], pageIndex - 1)}>Newer versions</button>}
      {next && <button type="button" className="admin-button admin-button--secondary" disabled={busy} data-testid="button-older-history" onClick={() => load(next, pageIndex + 1)}>Older versions</button>}
      {loaded && <span role="status">History page {pageIndex + 1}</span>}
    </div>
    {inspect && <InvoiceQRInspectDialog version={inspect.version} label={inspect.label} onClose={() => setInspect(null)} />}
  </section>;
}
