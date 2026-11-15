import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';
export default function CountTariffCells({ count, tariff }) {
  const prefs = useAdminPreferences();
  const draft = tariff.drafts?.[count];
  const history = (tariff.saved?.history || []).filter((row) => row.allergenCount === count)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const date = (value) => formatAdminDate(value, prefs) || value;
  return <>
    <td>
      {draft ? <>
        <label htmlFor={`count-mrp-${count}`}>Total Suborder MRP (INR)</label>
        <input id={`count-mrp-${count}`} inputMode="decimal" maxLength={64} value={draft.totalMrp}
          disabled={tariff.locked} onChange={(e) => tariff.edit(count, 'totalMrp', e.target.value)} />
        {!history.length && <small>Enter an explicit amount before saving.</small>}
        {!!history.length && <small>Saved tariff amount. Enter a new explicit date to append a revision.</small>}
        <label htmlFor={`count-date-${count}`}>Effective From</label>
        <input id={`count-date-${count}`} type="date" value={draft.effectiveFrom} disabled={tariff.locked}
          onChange={(e) => tariff.edit(count, 'effectiveFrom', e.target.value)} />
        <button type="button" className="admin-button" disabled={tariff.locked || tariff.blocked}
          onClick={() => tariff.save(count)}>Save count {count} tariff only</button>
        <details><summary>Rate history ({history.length})</summary>
          {!history.length ? <p>No saved applicable rate. Enter and save an explicit tariff to price orders.</p> : <ol>{history.map((row, i) => <li key={row.id}>
            <strong>₹{row.totalMrp}</strong> from <time dateTime={row.effectiveFrom}>{date(row.effectiveFrom)}</time>
            {history[i + 1] ? ` until before ${date(history[i + 1].effectiveFrom)}` : ' onwards'} (starting day included).
            <small>Version {row.version}; revision {row.id}. Actor {row.actorId}; recorded {row.recordedAt}.</small>
          </li>)}</ol>}
        </details>
      </> : <p>Tariffs unavailable until the protected history loads.</p>}
    </td>
  </>;
}
