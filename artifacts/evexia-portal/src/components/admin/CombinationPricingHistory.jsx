import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import { combinationHistory, combinationStatusHistory } from '../../services/serverCombinationPricing.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';

export default function CombinationPricingHistory({ categoryId, dosage, memberKey = '', ruleId, onClose, returnFocusRef }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const prefs = useAdminPreferences();
  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true); setPage(null); setError('');
    combinationHistory(categoryId, dosage, memberKey, offset, ctl.signal)
      .then((value) => { if (!ctl.signal.aborted) setPage(value); })
      .catch((cause) => { if (!ctl.signal.aborted) setError(cause.message); })
      .finally(() => { if (!ctl.signal.aborted) setBusy(false); });
    return () => ctl.abort();
  }, [categoryId, dosage, memberKey, offset, retry]);
  const columns = [
    { key: 'members', label: 'Saved membership', render: (r) => <><strong>{r.categoryName} · {r.dosage}</strong>
      <ul>{r.members.map((m) => <li key={m.id}>{m.name} · {m.mix ? 'Mix' : 'No Mix'} <small>{m.id}</small></li>)}</ul></> },
    { key: 'rate', label: 'Total Suborder MRP (INR)', render: (r) => `₹${r.totalMrp}` },
    { key: 'date', label: 'Effective From', render: (r) => <time dateTime={r.effectiveFrom}>{formatAdminDate(r.effectiveFrom, prefs) || r.effectiveFrom}</time> },
    { key: 'audit', label: 'Saved evidence', render: (r) => <>Version {r.version}<small>Actor {r.actorId}</small>
      <small>Recorded {r.recordedAt}</small><small>Revision {r.id}</small></> },
  ];
  return <Dialog title="Saved combination revisions" eyebrow="Pricing / Read-only evidence"
    description={`Dosage ${dosage}. Saved member identities and names are retained even after master eligibility changes. Each starting day is included; a later effective date for the same key ends the preceding interval. Latest recorded is not necessarily effective today.`}
    className="pricing-history-dialog" onClose={onClose} returnFocusRef={returnFocusRef}>
    <div className="pricing-combination-history">
      {ruleId && <StatusHistory key={ruleId} ruleId={ruleId} />}
      {error ? <div role="alert"><p>{error}</p><button className="admin-button" onClick={() => setRetry((n) => n + 1)}>Retry history</button></div>
        : <DataTable columns={columns} rows={page?.items || []} rowKey={(r) => r.id} loading={busy}
          label="Saved combination pricing revisions" testIdPrefix="combination-history"
          empty={<p>No saved revisions for this category and dosage.</p>} />}
      <div className="admin-pagination"><button className="admin-button admin-button--secondary" disabled={busy || !offset}
        onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
        <span>Page {Math.floor(offset / 25) + 1}</span>
        <button className="admin-button admin-button--secondary" disabled={busy || page?.nextOffset == null}
          onClick={() => setOffset(page.nextOffset)}>Next</button></div>
    </div>
  </Dialog>;
}

function StatusHistory({ ruleId }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const ctl = new AbortController(); setBusy(true); setError(''); setPage(null);
    combinationStatusHistory(ruleId, offset, ctl.signal)
      .then((value) => { if (!ctl.signal.aborted) setPage(value); })
      .catch((cause) => { if (!ctl.signal.aborted) setError(cause.message); })
      .finally(() => { if (!ctl.signal.aborted) setBusy(false); });
    return () => ctl.abort();
  }, [ruleId, offset, retry]);
  return <section aria-label="Configuration status history"><h2>Status history · read-only</h2>
    <p>Version 1 is the Initial Active configuration baseline, not a historical activation. Its actor identifies the source rate owner and its time records baseline initialization. Later events identify the status-change actor and time. No event activates order pricing; rate saves never reset status.</p>
    {busy ? <p role="status">Loading status history…</p> : error ? <div role="alert"><p>{error}</p>
      <button type="button" className="admin-button" onClick={() => setRetry((n) => n + 1)}>Retry status history</button></div>
      : page?.items.length ? <ol>{page.items.map((e) => <li key={e.id}><strong>{e.version === 1 ? 'Initial Active baseline' : e.status === 'active' ? 'Activated' : 'Deactivated'} · v{e.version}</strong>
        <small>{e.version === 1 ? 'Source rate actor' : 'Actor'} {e.actorId} · Recorded {e.recordedAt}</small><small>Rate revision {e.revisionId}</small></li>)}</ol>
        : <p>No status events on this page.</p>}
    <div className="admin-pagination"><button type="button" className="admin-button admin-button--secondary" disabled={busy || !offset}
      onClick={() => setOffset(Math.max(0, offset - 25))}>Previous status changes</button>
      <span>Page {Math.floor(offset / 25) + 1}</span>
      <button type="button" className="admin-button admin-button--secondary" disabled={busy || error || page?.nextOffset == null}
        onClick={() => setOffset(page.nextOffset)}>Next status changes</button></div>
  </section>;
}
