import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import { combinationHistory } from '../../services/serverCombinationPricing.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';

export default function CombinationPricingHistory({ categoryId, dosage, memberKey = '', onClose, returnFocusRef }) {
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
