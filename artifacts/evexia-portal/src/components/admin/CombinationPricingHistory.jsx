import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import { combinationHistory, combinationStatusHistory } from '../../services/serverCombinationPricing.js';
import { formatAdminDate, formatAdminTimestamp, useAdminPreferences } from './adminPreferences.js';

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
  const context = !busy && !error ? page?.items[0] : null;
  const columns = [
    { key: 'revision', label: 'Revision', render: (r) => <><strong>Version {r.version}</strong>
      {(!memberKey || !sameSnapshot(r, context)) && <div className="pricing-history-snapshot">
        <small>{memberKey ? 'Different saved context' : 'Saved rule context'}</small>
        <strong>{r.categoryName} · {r.dosage}</strong><SavedMembers members={r.members} />
      </div>}</> },
    { key: 'rate', label: 'Total suborder MRP (INR)', render: (r) => <strong className="pricing-history-amount">₹{r.totalMrp}</strong> },
    { key: 'date', label: 'Effective From', render: (r) => <time dateTime={r.effectiveFrom}>{formatAdminDate(r.effectiveFrom, prefs) || r.effectiveFrom}</time> },
    { key: 'audit', label: 'Recorded / evidence', render: (r) => <>
      <RecordedTime value={r.recordedAt} prefs={prefs} />
      <details className="pricing-history-details">
        <summary>Revision details<span className="pricing-history-sr-only"> for version {r.version}, effective {formatAdminDate(r.effectiveFrom, prefs)}</span></summary>
        <dl><dt>Revision ID</dt><dd>{r.id}</dd><dt>Actor ID</dt><dd>{r.actorId}</dd>
          <dt>Recorded instant (original)</dt><dd>{r.recordedAt}</dd>
          <dt>Saved category</dt><dd>{r.categoryName}</dd><dt>Saved dosage</dt><dd>{r.dosage}</dd>
          <dt>Saved members</dt><dd><SavedMembers members={r.members} evidence /></dd></dl>
      </details></> },
  ];
  return <Dialog title="Pricing Rules History" eyebrow="Pricing / Read-only"
    className="pricing-history-dialog" onClose={onClose} returnFocusRef={returnFocusRef}>
    <div className="pricing-combination-history">
      <div className="pricing-history-context" aria-label="Saved pricing context">
        <p><strong>Dosage {dosage}</strong> · {memberKey ? 'Exact saved rule' : 'All saved rules in this category'}</p>
        {context ? <><p>Category snapshot: <strong>{context.categoryName}</strong></p>
          {memberKey && <SavedMembers members={context.members} />}
          <small>Context from the first revision on this page. Each revision retains its own saved evidence.</small></>
          : <small>{busy ? 'Loading saved context…' : 'Saved context is unavailable on this page.'}</small>}
      </div>
      <details className="pricing-history-notes">
        <summary>How to read this history</summary>
        <ul>
          <li>Latest recorded price may be future-dated; it is not necessarily effective today.</li>
          <li>Each effective starting day is included. A later effective date for the same rule ends the preceding interval.</li>
          <li>Names and Mix flags are saved snapshots, not current master values. Revision details retain member identities.</li>
          <li>Initial Active is a configuration baseline, not a historical activation. Its actor is the source rate owner; its recorded time is baseline initialization. Later status events record the status-change actor and time.</li>
          <li>Status is configuration-only: it does not activate order pricing. Saving a price does not reset status.</li>
          <li>Effective dates are calendar days. Recorded times use your Admin date, clock and time-zone preferences; original audit instants remain in record details.</li>
        </ul>
      </details>
      <section className="pricing-history-section" aria-label="Price history">
        <h3>Price history</h3>
        {error ? <div className="pricing-history-message" role="alert"><p>{error}</p><button type="button" className="admin-button"
          onClick={() => setRetry((n) => n + 1)}>Retry history</button></div>
          : <DataTable columns={columns} rows={page?.items || []} rowKey={(r) => r.id} loading={busy} skeletonRows={3}
            label="Saved combination pricing revisions" testIdPrefix="combination-history"
            empty={<p>No saved revisions on this page for this category and dosage.</p>} />}
        <HistoryPagination label="Price history" offset={offset} page={page} busy={busy} error={error} onChange={setOffset} />
      </section>
      {ruleId && <StatusHistory key={ruleId} ruleId={ruleId} prefs={prefs} />}
    </div>
  </Dialog>;
}

function sameSnapshot(a, b) {
  return Boolean(b) && a.categoryName === b.categoryName && a.dosage === b.dosage
    && a.members.length === b.members.length
    && a.members.every((m, i) => m.id === b.members[i].id && m.name === b.members[i].name && m.mix === b.members[i].mix);
}

function SavedMembers({ members, evidence = false }) {
  return <ul className="pricing-history-members">{members.map((m) => <li key={m.id}>
    <span>{m.name} <span className="pricing-history-mix">{m.mix ? 'Mix' : 'No Mix'}</span></span>
    {evidence && <><small>Member ID: {m.id}</small><small>Saved member version: {m.version}</small></>}
  </li>)}</ul>;
}

function RecordedTime({ value, prefs }) {
  return <time dateTime={value}>{formatAdminTimestamp(value, prefs, true)}</time>;
}

function HistoryPagination({ label, offset, page, busy, error, onChange }) {
  return <nav className="pricing-history-pagination" aria-label={`${label} pagination`}>
    <span aria-live="polite">{label} · Page {Math.floor(offset / 25) + 1}{busy ? ' · Loading…' : error ? ' · Unavailable' : ''}</span>
    <div><button type="button" className="admin-button admin-button--secondary" disabled={busy || !offset}
      aria-label={`Previous ${label.toLowerCase()} page`} onClick={() => onChange(Math.max(0, offset - 25))}>Previous</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={busy || Boolean(error) || page?.nextOffset == null}
        aria-label={`Next ${label.toLowerCase()} page`} onClick={() => onChange(page.nextOffset)}>Next</button></div>
  </nav>;
}

function StatusHistory({ ruleId, prefs }) {
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
  return <section className="pricing-history-section pricing-history-status" aria-label="Configuration status history">
    <h3>Status history <span>Configuration only</span></h3>
    {busy ? <p role="status">Loading status history…</p> : error ? <div className="pricing-history-message" role="alert"><p>{error}</p>
      <button type="button" className="admin-button" onClick={() => setRetry((n) => n + 1)}>Retry status history</button></div>
      : page?.items.length ? <ol className="pricing-history-events">{page.items.map((e) => <li key={e.id}>
        <div className="pricing-history-event-heading"><strong>{e.status === 'active' ? 'Active' : 'Inactive'}</strong>
          <span>Event v{e.version}</span>{e.version === 1 && <span>Initial baseline · not an activation</span>}</div>
        <div className="pricing-history-event-time"><span>{e.version === 1 ? 'Baseline recorded' : 'Change recorded'}</span> <RecordedTime value={e.recordedAt} prefs={prefs} /></div>
        <details className="pricing-history-details"><summary>Event details<span className="pricing-history-sr-only"> for status version {e.version}</span></summary>
          <dl><dt>Event ID</dt><dd>{e.id}</dd><dt>{e.version === 1 ? 'Source rate actor ID' : 'Actor ID'}</dt><dd>{e.actorId}</dd>
            <dt>Source rate revision ID</dt><dd>{e.revisionId}</dd><dt>Recorded instant (original)</dt><dd>{e.recordedAt}</dd></dl>
        </details>
      </li>)}</ol>
        : <p>No status events on this page.</p>}
    <HistoryPagination label="Status history" offset={offset} page={page} busy={busy} error={error} onChange={setOffset} />
  </section>;
}
