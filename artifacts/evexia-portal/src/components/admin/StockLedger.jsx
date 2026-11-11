import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import TablePagination from './TablePagination.jsx';
import StockSourceView from './StockSourceView.jsx';
import { dayEndExclusiveISO, dayStartISO, LEDGER_TYPES, stockLedger, typeLabel } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../stockLedger.css';

const saved = (value) => value == null || value === '' ? 'Unavailable' : value;

function EntryDetails({ entry: r, unit, displayDate }) {
  return <details className="stock-ledger-entry__details" data-testid={`details-ledger-entry-${r.id}`}>
    <summary>Details &amp; evidence</summary>
    <dl className="stock-ledger-meta">
      <div><dt>Document date</dt><dd>{r.businessDate ? displayDate(r.businessDate) : 'Unavailable'}</dd></div>
      <div><dt>Batch</dt><dd>{r.batchNo || 'Batch unavailable'}</dd></div>
      <div><dt>Lot</dt><dd>{r.lotId || 'Single-lot reference unavailable; see source details and recorded legs'}</dd></div>
      <div><dt>Location</dt><dd>{r.location || 'Location unavailable'}</dd></div>
      <div><dt>Recorded actor</dt><dd>{r.actor || 'Unavailable'}</dd></div>
      <div><dt>Reason</dt><dd>{r.reason || 'Reason not recorded'}</dd></div>
      <div className="stock-ledger-meta__wide"><dt>Full reference</dt><dd>{r.reference || 'Reference unavailable'}</dd></div>
      <div className="stock-ledger-meta__wide"><dt>Source reference</dt><dd>{r.sourceId || 'Unavailable'}</dd></div>
      <div className="stock-ledger-meta__wide"><dt>Ledger entry reference</dt><dd>{saved(r.id)}</dd></div>
    </dl>
    <h5>Recorded location / transfer legs</h5>
    {r.legs?.length ? <ul className="stock-ledger-legs">{r.legs.map((leg, i) => <li key={i}>
      <strong>{leg.location || 'Location unavailable'}</strong>
      <span>Recorded change: {saved(leg.delta)} {unit}</span>
      <span>Lot: {leg.lotId || 'Unavailable'}</span>
    </li>)}</ul> : <p>No location / transfer legs available.</p>}
  </details>;
}

const When = ({ at, timestamp }) => at ? <time dateTime={at}>{timestamp(at)}</time> : <span>Time unavailable</span>;
const Source = ({ r }) => <StockSourceView kind={r.sourceKind} id={r.sourceId} available={r.sourceAvailable} reference={r.reference?.length > 48 ? `${r.reference.slice(0, 45)}…` : r.reference || 'Reference unavailable'} testId={`ledger-source-${r.id}`} />;

function LedgerEntry({ entry: r, unit, displayDate, timestamp }) {
  return <li className="stock-ledger-entry" data-testid={`row-ledger-timeline-${r.id}`}>
    <article aria-label={`${typeLabel(r.type)} entry`}>
      <div className="stock-ledger-entry__main">
        <div className="stock-ledger-entry__heading">
          <h4>{typeLabel(r.type)}</h4>
          <p><When at={r.at} timestamp={timestamp} /></p>
        </div>
        <dl className="stock-ledger-entry__quantities">
          <div className="stock-ledger-entry__in"><dt>In</dt><dd>{saved(r.quantityIn)}</dd></div>
          <div className="stock-ledger-entry__out"><dt>Out</dt><dd>{saved(r.quantityOut)}</dd></div>
          <div className="stock-ledger-entry__bal"><dt>Saved balance</dt><dd>{saved(r.balance)} <small>{unit}</small></dd></div>
        </dl>
      </div>
      <div className="stock-ledger-entry__source"><Source r={r} /></div>
      <EntryDetails entry={r} unit={unit} displayDate={displayDate} />
    </article>
  </li>;
}

function LedgerTable({ items, unit, displayDate, timestamp }) {
  return <div className="stock-ledger-scroll" role="region" aria-label="Stock ledger table, scrollable" tabIndex={0} data-testid="region-ledger-table">
    <table className="stock-ledger-table">
      <caption className="stock-ledger-sr">Stock ledger entries, oldest first. Quantities in {unit}.</caption>
      <thead><tr><th scope="col">Recorded</th><th scope="col">Type / reference</th><th scope="col" className="num">In</th><th scope="col" className="num">Out</th><th scope="col" className="num">Saved balance</th></tr></thead>
      <tbody>{items.map((r) => <tr key={r.id} data-testid={`row-ledger-table-${r.id}`}>
        <td className="stock-ledger-table__time"><When at={r.at} timestamp={timestamp} /></td>
        <td className="stock-ledger-table__ref"><strong>{typeLabel(r.type)}</strong><Source r={r} /><EntryDetails entry={r} unit={unit} displayDate={displayDate} /></td>
        <td className="num in">{saved(r.quantityIn)}</td>
        <td className="num out">{saved(r.quantityOut)}</td>
        <td className="num bal">{saved(r.balance)} <small>{unit}</small></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function ProcurementTable({ items, displayDate }) {
  return <div className="stock-ledger-scroll" role="region" aria-label="Related purchase activity table, scrollable" tabIndex={0}>
    <table className="stock-ledger-table stock-ledger-table--proc">
      <caption className="stock-ledger-sr">Related purchase activity. Not stock.</caption>
      <thead><tr><th scope="col">Document</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col" className="num">Ordered</th><th scope="col" className="num">Received</th><th scope="col" className="num">Accepted</th><th scope="col" className="num">Rejected</th><th scope="col">Stock effect</th></tr></thead>
      <tbody>{items.map((r) => <tr key={`${r.kind}-${r.id}`} data-testid={`row-ledger-procurement-${r.id}`}>
        <td className="stock-ledger-table__ref"><StockSourceView kind={r.kind === 'po' ? 'po' : 'receipt'} id={r.sourceId || r.id} available={r.sourceAvailable} reference={`${r.kind === 'po' ? 'Purchase order' : 'Purchase receipt'} ${r.number || 'unavailable'}`} testId={`ledger-procurement-${r.id}`} /></td>
        <td>{r.date ? displayDate(r.date) : 'Unavailable'}</td>
        <td>{saved(r.status)}</td>
        <td className="num">{saved(r.ordered)}</td>
        <td className="num">{saved(r.received)}</td>
        <td className="num">{saved(r.accepted)}</td>
        <td className="num">{saved(r.rejected)}</td>
        <td>{saved(r.stockEffect)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function StockLedger({ row, onClose }) {
  const { date: displayDate, timestamp } = useAdminDateFormatters();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [location, setLocation] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState('timeline');
  const [data, setData] = useState(null);
  const [locations, setLocations] = useState([]);
  const [state, setState] = useState({ loading: true, error: '' });
  const badRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (badRange) return undefined;
    const c = new AbortController(); let live = true;
    setData(null); setState({ loading: true, error: '' });
    stockLedger(row.productId, { from_date: from ? dayStartISO(from) : '', to_date: to ? dayEndExclusiveISO(to) : '', location_id: location, transaction_type: type, offset: (page - 1) * pageSize, limit: pageSize }, c.signal)
      .then((d) => { if (live) { setData(d); if (d.locations?.length) setLocations(d.locations); setState({ loading: false, error: '' }); } })
      .catch((e) => { if (live && !c.signal.aborted) { setData(null); setState({ loading: false, error: e.message || 'The ledger could not be loaded.' }); } });
    return () => { live = false; c.abort(); };
  }, [row.productId, from, to, location, type, page, pageSize, tick, badRange]);

  const unit = data?.product?.unit || row.unit || 'Unit unavailable';
  const s = state.loading || state.error || badRange ? null : data?.summary;
  const items = state.loading || state.error ? [] : data?.items || [];
  const filtered = Number(data?.filtered || 0);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };
  const proc = state.loading || state.error || badRange ? [] : data?.procurement?.items || [];
  return <Dialog className="stock-ledger" eyebrow="Individual allergen stock" title="Stock ledger" onClose={onClose}
    description={<><strong>{[row.name, row.concentration].filter(Boolean).join(' · ')}</strong><span>Unit: {unit}{data ? ` · As of ${timestamp(data.asOf)}` : ''}</span></>}>
    <div className="stock-ledger__body" role="region" aria-label="Stock ledger content" tabIndex={0}>
    <details className="stock-ledger__more stock-ledger__reference"><summary>Product reference</summary><p>{row.productId}</p></details>
    {!state.loading && !state.error && data?.coverage && <div className={`admin-feedback stock-ledger__coverage${data.coverage.complete ? '' : ' is-incomplete'}`} role={data.coverage.complete ? 'note' : 'alert'} data-testid="text-ledger-coverage">
      <strong>{data.coverage.complete ? 'Complete recorded history.' : 'History is incomplete.'}</strong>{data.coverage.earliestRecordedAt ? <> Earliest record {timestamp(data.coverage.earliestRecordedAt)}.</> : ''}
      {(!data.coverage.complete) && (data.coverage.limitations || []).map((l, i) => <span key={i}> {l}</span>)}
      {(data.coverage.contract || (data.coverage.complete && data.coverage.limitations?.length)) ? <details className="stock-ledger__more"><summary>How history is recorded</summary>
        <p>{data.coverage.contract}</p>
        {data.coverage.complete && (data.coverage.limitations || []).map((l, i) => <p key={i}>{l}</p>)}
        <p>Oldest first in server recorded-time order (UTC; entry ID breaks ties). Each balance is supplied by the server, not calculated from this page.</p>
      </details> : null}
    </div>}
    <section className="stock-ledger__filters" aria-label="Ledger filters">
    <div className="stock-ledger__section-heading"><h3>Filters</h3><button type="button" className="admin-button admin-button--secondary" data-testid="button-ledger-reset" disabled={!from && !to && !location && !type} onClick={() => { setFrom(''); setTo(''); setLocation(''); setType(''); setPage(1); }}>Reset filters</button></div>
    <div className="ledger-filters">
      <label className="stock-field">From <input type="date" className="admin-input" value={from} max={to || undefined} onChange={reset(setFrom)} data-testid="input-ledger-from" /></label>
      <label className="stock-field">To <input type="date" className="admin-input" value={to} min={from || undefined} onChange={reset(setTo)} data-testid="input-ledger-to" /></label>
      <label className="stock-field">Location <select className="admin-select" value={location} onChange={reset(setLocation)} data-testid="select-ledger-location"><option value="">All locations</option><option value="unallocated">Unallocated</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="stock-field">Type <select className="admin-select" value={type} onChange={reset(setType)} data-testid="select-ledger-type">{LEDGER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    </div>
    </section>
    {badRange && <div className="admin-feedback admin-feedback--error" role="alert">The start date must not be after the end date.</div>}
    {s && <section className="stock-ledger__balances" aria-label="Stock balances" data-testid="section-ledger-summary">
      <div className="stock-ledger__current"><span>Current on hand <small>(selected location, ignores dates/type)</small></span><strong className="inv-mono" data-testid="text-ledger-current">{saved(s.current)} <small>{unit}</small></strong></div>
       <div className="stock-ledger__period"><h3>Selected period · all types</h3>
      <dl className="ledger-summary">
        <div><dt>Opening</dt><dd>{saved(s.opening)}</dd></div>
        <div><dt>Additions</dt><dd className="in">{saved(s.additions)}</dd></div>
        <div><dt>Reductions</dt><dd className="out">{saved(s.reductions)}</dd></div>
        <div><dt>Closing</dt><dd>{saved(s.closing)}</dd></div>
      </dl><p className="stock-ledger__unit">Period values in {unit}</p></div>
    </section>}
    {s?.scope && <details className="stock-ledger__more"><summary>Period balance scope</summary><p className="stock-ledger__hint" data-testid="text-ledger-scope">{s.scope}</p></details>}
    {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-ledger-retry">Retry</button></div>}
    <section className="stock-ledger__history" aria-label="Recorded stock history" aria-busy={state.loading}>
      <div className="stock-ledger__section-heading"><h3>Recorded stock history</h3>
        <div className="stock-ledger-switch" role="group" aria-label="Ledger view">
          {[['timeline', 'Timeline'], ['table', 'Table']].map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)} data-testid={`button-ledger-view-${v}`}>{l}</button>)}
        </div>
      </div>
      {state.loading ? <div className="stock-ledger-skeleton" role="status" aria-label="Loading ledger"><span /><span /><span /><span className="stock-ledger-sr">Loading ledger…</span></div>
        : state.error || badRange ? null
        : !items.length ? <div className="admin-empty"><strong>No ledger entries match</strong><p>Clear the date, location or type filters to see all recorded history.</p></div>
        : view === 'table' ? <LedgerTable items={items} unit={unit} displayDate={displayDate} timestamp={timestamp} />
        : <ol className="stock-ledger-timeline" start={(page - 1) * pageSize + 1} aria-label={`Stock ledger entries, quantities in ${unit}`}>{items.map((r) => <LedgerEntry key={r.id} entry={r} unit={unit} displayDate={displayDate} timestamp={timestamp} />)}</ol>}
      {!state.error && !badRange && <TablePagination page={Math.min(page, pageCount)} pageCount={pageCount} pageSize={pageSize} filtered={filtered} total={filtered} label="entries" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-ledger-count" />}
    </section>
    <section className="stock-ledger-procurement" aria-label="Related purchase activity, not stock">
      <details className="stock-ledger-procurement__toggle" data-testid="details-ledger-procurement">
        <summary><span>Related purchase activity <em>(not stock)</em></span>{!state.loading && !state.error && !badRange && <span className="stock-ledger-count">{proc.length}</span>}</summary>
        <p className="stock-ledger__hint" data-testid="text-ledger-procurement-scope">{data?.procurement?.scope || 'Purchase orders are commitments and never change stock. Receipt stock is counted only from the ledger above.'}</p>
        {state.loading ? <div className="admin-empty" role="status"><strong>Loading purchase activity…</strong></div> : state.error || badRange ? null : proc.length ? <ProcurementTable items={proc} displayDate={displayDate} />
          : <div className="admin-empty"><strong>No related purchase activity</strong></div>}
      </details>
    </section>
    </div>
  </Dialog>;
}
