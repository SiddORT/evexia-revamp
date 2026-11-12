import { money, valueMoney, locationLabel } from '../../services/openingStock.js';
import { useAdminDateFormatters } from './adminPreferences.js';

/** Display retained snapshots, never reconstruct old values from today's record. */
export default function OpeningRevisionHistory({ opening }) {
  const { date } = useAdminDateFormatters();
  const fields = (row) => <dl className="opening-stock-detail__fields">
    <div><dt>Item / type</dt><dd>{row.productName} · {row.itemKind}</dd></div>
    <div><dt>Quantity</dt><dd>{row.quantity} {row.unit}</dd></div>
    <div><dt>Unit rate</dt><dd>{money(row.unitRate)}</dd></div>
    <div><dt>Opening value</dt><dd>{valueMoney(row.openingValue)}</dd></div>
    <div><dt>Location</dt><dd>{locationLabel(row.location)}</dd></div>
    <div><dt>Recorded date</dt><dd>{date(row.recordedDate)}</dd></div>
    <div><dt>Expiry date</dt><dd>{row.expiryDate ? date(row.expiryDate) : 'Unknown / unavailable'}</dd></div>
  </dl>;
  return <section className="opening-stock-history" aria-label="Opening stock audit history">
    <h3>Original entry and corrections</h3>
    <p>Created by {opening.actor} · <time dateTime={opening.createdAt}>{new Date(opening.createdAt).toLocaleString()}</time>.
      {' '}Current revision: {opening.version || 1}. Original creator and creation time are never replaced by an editor.</p>
    {(opening.revisions || []).map((revision) => <details key={revision.version}>
      <summary>Revision {revision.version} · {revision.activity.actor} · {new Date(revision.activity.at).toLocaleString()}</summary>
      <h4>Before · revision {revision.version - 1}</h4>{fields(revision.before)}
      <h4>After · revision {revision.version}</h4>{fields(revision.after)}
    </details>)}
    {!opening.revisions?.length && <p>No corrections recorded.</p>}
    <p>{opening.historicalData}</p>
  </section>;
}
