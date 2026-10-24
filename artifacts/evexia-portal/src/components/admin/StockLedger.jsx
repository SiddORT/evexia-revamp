import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import TablePagination from './TablePagination.jsx';
import StockSourceView from './StockSourceView.jsx';
import { dayEndExclusiveISO, dayStartISO, LEDGER_TYPES, stockLedger, typeLabel } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../stockLedger.css';

const saved = (value) => value == null || value === '' ? 'Unavailable' : value;

function LedgerEntry({ entry: r, unit, displayDate, timestamp }) {
  return <li className="stock-ledger-entry">
    <article>
      <header className="stock-ledger-entry__heading">
        <h4>{typeLabel(r.type)}</h4>
        <p>Recorded {r.at ? <time dateTime={r.at}>{timestamp(r.at)}</time> : 'time unavailable'}</p>
      </header>
      <dl className="stock-ledger-entry__quantities">
        <div className="stock-ledger-entry__in"><dt>In</dt><dd>{saved(r.quantityIn)} <small>{unit}</small></dd></div>
        <div className="stock-ledger-entry__out"><dt>Out</dt><dd>{saved(r.quantityOut)} <small>{unit}</small></dd></div>
        <div><dt>Saved running balance</dt><dd>{saved(r.balance)} <small>{unit}</small></dd></div>
      </dl>
      <StockSourceView kind={r.sourceKind} id={r.sourceId} available={r.sourceAvailable} reference={r.reference || 'Reference unavailable'} testId={`ledger-source-${r.id}`} />
      <details className="stock-ledger-entry__details">
        <summary>Entry details &amp; full references</summary>
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
      </details>
    </article>
  </li>;
}

function ProcurementCard({ entry: r, displayDate }) {
  return <li className="stock-ledger-procurement__card">
    <StockSourceView kind={r.kind === 'po' ? 'po' : 'receipt'} id={r.sourceId || r.id} available={r.sourceAvailable} reference={`${r.kind === 'po' ? 'Purchase order' : 'Purchase receipt'} ${r.number || 'unavailable'}`} testId={`ledger-procurement-${r.id}`} />
    <dl className="stock-ledger-meta">
      <div><dt>Document date</dt><dd>{r.date ? displayDate(r.date) : 'Unavailable'}</dd></div>
      <div><dt>Status</dt><dd>{saved(r.status)}</dd></div>
      <div><dt>Ordered</dt><dd>{saved(r.ordered)}</dd></div>
      <div><dt>Received</dt><dd>{saved(r.received)}</dd></div>
      <div><dt>Accepted</dt><dd>{saved(r.accepted)}</dd></div>
      <div><dt>Rejected</dt><dd>{saved(r.rejected)}</dd></div>
      <div className="stock-ledger-meta__wide"><dt>Stock effect</dt><dd>{saved(r.stockEffect)}</dd></div>
    </dl>
  </li>;
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
    description={<><strong>{row.name} · {row.concentration}</strong><span>Product reference: {row.productId}</span><span>Unit: {unit}{data ? ` · As of ${timestamp(data.asOf)}` : ''}</span></>}>
    <div className="stock-ledger__body" role="region" aria-label="Stock ledger content" tabIndex={0}>
    {!state.loading && !state.error && data?.coverage && <div className="admin-feedback" role="note" data-testid="text-ledger-coverage">{data.coverage.complete ? 'Complete recorded history.' : 'History is incomplete.'} {data.coverage.earliestRecordedAt ? `Earliest record ${timestamp(data.coverage.earliestRecordedAt)}. ` : ''}{data.coverage.contract}{(data.coverage.limitations || []).map((l, i) => <span key={i}> {l}</span>)}</div>}
    <section className="stock-ledger__filters" aria-label="Ledger filters">
    <div className="stock-ledger__section-heading"><h3>Filter history</h3><button type="button" className="admin-button admin-button--secondary" disabled={!from && !to && !location && !type} onClick={() => { setFrom(''); setTo(''); setLocation(''); setType(''); setPage(1); }}>Reset filters</button></div>
    <div className="ledger-filters">
      <label className="stock-field">From <input type="date" className="admin-input" value={from} max={to || undefined} onChange={reset(setFrom)} data-testid="input-ledger-from" /></label>
      <label className="stock-field">To <input type="date" className="admin-input" value={to} min={from || undefined} onChange={reset(setTo)} data-testid="input-ledger-to" /></label>
      <label className="stock-field">Location <select className="admin-select" value={location} onChange={reset(setLocation)} data-testid="select-ledger-location"><option value="">All locations</option><option value="unallocated">Unallocated</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="stock-field">Type <select className="admin-select" value={type} onChange={reset(setType)} data-testid="select-ledger-type">{LEDGER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    </div>
    </section>
    {badRange && <div className="admin-feedback admin-feedback--error" role="alert">The start date must not be after the end date.</div>}
    {s && <section className="stock-ledger__balances" aria-label="Stock balances" data-testid="section-ledger-summary">
      <div className="stock-ledger__current"><span>Current on hand · selected location scope</span><strong className="inv-mono">{saved(s.current)} <small>{unit}</small></strong><p>Current lifetime stock, independent of the history dates and type filter.</p></div>
      <h3>Selected period balances</h3>
      <dl className="ledger-summary">
        <div><dt>Period opening balance</dt><dd>{saved(s.opening)} <small>{unit}</small></dd></div>
        <div><dt>Additions</dt><dd>{saved(s.additions)} <small>{unit}</small></dd></div>
        <div><dt>Reductions</dt><dd>{saved(s.reductions)} <small>{unit}</small></dd></div>
        <div><dt>Closing balance</dt><dd>{saved(s.closing)} <small>{unit}</small></dd></div>
      </dl>
    </section>}
    {s?.scope && <p className="mr-form__hint" data-testid="text-ledger-scope">{s.scope}</p>}
    {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-ledger-retry">Retry</button></div>}
    <section className="stock-ledger__history" aria-label="Recorded stock timeline" aria-busy={state.loading}>
      <h3>Recorded stock timeline</h3>
      <p className="stock-ledger__hint">Oldest first in server recorded-time order (UTC; entry ID breaks ties). Each balance is supplied by the server, not calculated from this page.</p>
      {state.loading ? <div className="admin-empty" role="status"><strong>Loading ledger…</strong></div>
        : state.error || badRange ? null
        : items.length ? <ol className="stock-ledger-timeline" start={(page - 1) * pageSize + 1} aria-label="Stock ledger entries">{items.map((r) => <LedgerEntry key={r.id} entry={r} unit={unit} displayDate={displayDate} timestamp={timestamp} />)}</ol>
        : <div className="admin-empty"><strong>No ledger entries match</strong><p>Clear the date, location or type filters to see all recorded history.</p></div>}
      {!state.error && !badRange && <TablePagination page={Math.min(page, pageCount)} pageCount={pageCount} pageSize={pageSize} filtered={filtered} total={filtered} label="entries" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-ledger-count" />}
    </section>
    <section className="stock-ledger-procurement" aria-label="Related purchase activity, not stock">
    <h3 className="stock-section-title">Related purchase activity (not stock)</h3>
    <p className="mr-form__hint" data-testid="text-ledger-procurement-scope">{data?.procurement?.scope || 'Purchase orders are commitments and never change stock. Receipt stock is counted only from the ledger above.'}</p>
    <div>{state.loading ? <div className="admin-empty" role="status"><strong>Loading purchase activity…</strong></div> : state.error || badRange ? null : proc.length ? <ul className="stock-ledger-procurement__cards" aria-label="Purchase activity">{proc.map((r) => <ProcurementCard key={`${r.kind}-${r.id}`} entry={r} displayDate={displayDate} />)}</ul>
      : <div className="admin-empty"><strong>No related purchase activity</strong></div>}</div>
    </section>
    </div>
  </Dialog>;
}
