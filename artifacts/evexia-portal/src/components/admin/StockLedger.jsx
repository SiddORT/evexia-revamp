import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import TablePagination from './TablePagination.jsx';
import StockSourceView from './StockSourceView.jsx';
import { dayEndExclusiveISO, dayStartISO, LEDGER_TYPES, stockLedger, typeLabel } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';

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

  const unit = data?.product?.unit || row.unit;
  const s = state.loading || state.error || badRange ? null : data?.summary;
  const items = state.loading || state.error ? [] : data?.items || [];
  const filtered = Number(data?.filtered || 0);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };
  const columns = [
    { key: 'at', label: 'Recorded', render: (r) => <>{timestamp(r.at)}{r.businessDate && <span className="stock-sub">Document date {displayDate(r.businessDate)}</span>}{!r.businessDate && <span className="stock-sub">Document date unavailable</span>}</> },
    { key: 'type', label: 'Type', render: (r) => typeLabel(r.type) },
    { key: 'ref', label: 'Reference', render: (r) => <StockSourceView kind={r.sourceKind} id={r.sourceId} available={r.sourceAvailable} reference={r.reference || 'Reference unavailable'} testId={`ledger-source-${r.id}`} /> },
    { key: 'lot', label: 'Lot / batch', render: (r) => <>{r.batchNo || 'Batch unavailable'}<span className="stock-sub">{r.lotId ? `Lot ${r.lotId}` : 'Multiple lots — see source details'}</span></> },
    { key: 'loc', label: 'Location', render: (r) => <>{r.location || 'Unallocated'}{r.legs?.length > 0 && <ul className="ledger-legs">{r.legs.map((l, i) => <li key={i}>{l.location || 'Unallocated'}: {l.delta} · lot {l.lotId}</li>)}</ul>}</> },
    { key: 'in', label: 'In', render: (r) => <span className="inv-mono">{r.quantityIn}</span> },
    { key: 'out', label: 'Out', render: (r) => <span className="inv-mono">{r.quantityOut}</span> },
    { key: 'bal', label: 'Balance', render: (r) => <strong className="inv-mono">{r.balance}</strong> },
    { key: 'act', label: 'Actor / reason', render: (r) => <>{r.actor || 'Unavailable'}<span className="stock-sub">{r.reason ? `Reason: ${r.reason}` : 'Reason not recorded'}</span></> },
  ];
  const procColumns = [
    { key: 'k', label: 'Document', render: (r) => <StockSourceView kind={r.kind === 'po' ? 'po' : 'receipt'} id={r.sourceId || r.id} available={r.sourceAvailable} reference={`${r.kind === 'po' ? 'Purchase order' : 'Purchase receipt'} ${r.number || 'unavailable'}`} testId={`ledger-procurement-${r.id}`} /> },
    { key: 'd', label: 'Date', render: (r) => r.date ? displayDate(r.date) : 'Unavailable' },
    { key: 's', label: 'Status', render: (r) => r.status },
    { key: 'o', label: 'Ordered', render: (r) => r.ordered },
    { key: 'r', label: 'Received', render: (r) => r.received },
    { key: 'a', label: 'Accepted', render: (r) => r.accepted },
    { key: 'j', label: 'Rejected', render: (r) => r.rejected },
    { key: 'e', label: 'Stock effect', render: (r) => r.stockEffect },
  ];
  const proc = state.loading || state.error || badRange ? [] : data?.procurement?.items || [];
  return <Dialog className="stock-ledger" eyebrow="Individual allergen stock" title={`Ledger: ${row.name} ${row.concentration}`} onClose={onClose}
    description={data ? `ID ${row.productId} · Unit ${unit}. As of ${timestamp(data.asOf)}.` : `ID ${row.productId} · Unit ${unit}.`}>
    {!state.loading && !state.error && data?.coverage && <div className="admin-feedback" role="note" data-testid="text-ledger-coverage">{data.coverage.complete ? 'Complete recorded history.' : 'History is incomplete.'} {data.coverage.earliestRecordedAt ? `Earliest record ${timestamp(data.coverage.earliestRecordedAt)}. ` : ''}{data.coverage.contract}{(data.coverage.limitations || []).map((l, i) => <span key={i}> {l}</span>)}</div>}
    <div className="ledger-filters">
      <label className="stock-field">From <input type="date" className="admin-input" value={from} max={to || undefined} onChange={reset(setFrom)} data-testid="input-ledger-from" /></label>
      <label className="stock-field">To <input type="date" className="admin-input" value={to} min={from || undefined} onChange={reset(setTo)} data-testid="input-ledger-to" /></label>
      <label className="stock-field">Location <select className="admin-select" value={location} onChange={reset(setLocation)} data-testid="select-ledger-location"><option value="">All locations</option><option value="unallocated">Unallocated</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="stock-field">Type <select className="admin-select" value={type} onChange={reset(setType)} data-testid="select-ledger-type">{LEDGER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    </div>
    {badRange && <div className="admin-feedback admin-feedback--error" role="alert">The start date must not be after the end date.</div>}
    {s && <div className="ledger-summary" data-testid="section-ledger-summary">
      <div><span>Period opening balance</span><strong className="inv-mono">{s.opening}</strong></div>
      <div><span>Additions</span><strong className="inv-mono">{s.additions}</strong></div>
      <div><span>Reductions</span><strong className="inv-mono">{s.reductions}</strong></div>
      <div><span>Closing balance</span><strong className="inv-mono">{s.closing}</strong></div>
      <div><span>Current on hand</span><strong className="inv-mono">{s.current}</strong></div>
    </div>}
    {s?.scope && <p className="mr-form__hint" data-testid="text-ledger-scope">{s.scope}</p>}
    {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-ledger-retry">Retry</button></div>}
    <div className="ledger-table" aria-busy={state.loading}>
      {state.loading ? <div className="admin-empty" role="status"><strong>Loading ledger…</strong></div>
        : state.error || badRange ? null
        : items.length ? <DataTable columns={columns} rows={items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Stock ledger" testIdPrefix="ledger" />
        : <div className="admin-empty"><strong>No ledger entries match</strong><p>Clear the date, location or type filters to see all recorded history.</p></div>}
      {!state.error && !badRange && <TablePagination page={Math.min(page, pageCount)} pageCount={pageCount} pageSize={pageSize} filtered={filtered} total={filtered} label="entries" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-ledger-count" />}
    </div>
    <h3 className="stock-section-title">Related purchase activity (not stock)</h3>
    <p className="mr-form__hint" data-testid="text-ledger-procurement-scope">{data?.procurement?.scope || 'Purchase orders are commitments and never change stock. Receipt stock is counted only from the ledger above.'}</p>
    <div className="ledger-table">{state.loading ? <div className="admin-empty" role="status"><strong>Loading purchase activity…</strong></div> : state.error || badRange ? null : proc.length ? <DataTable columns={procColumns} rows={proc} rowKey={(r) => `${r.kind}-${r.id}`} label="Purchase activity" testIdPrefix="ledger-procurement" />
      : <div className="admin-empty"><strong>No related purchase activity</strong></div>}</div>
  </Dialog>;
}
