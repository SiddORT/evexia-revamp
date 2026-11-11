import { concentrationLabel, lotOriginLabel } from '../../services/serverInventory.js';
import { useEffect, useMemo, useState } from 'react';
import DataTable from './DataTable.jsx';
import TablePagination from './TablePagination.jsx';
import ComboProvenance from './ComboProvenance.jsx';
import { dayEndExclusiveISO, dayStartISO, formatPrice, stockHistory } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { groupStockLots } from '../../services/stockLotPresentation.js';

export default function StockStatusDetail({ row, asOf, coverage }) {
  const can = useResourceActions('stock_status');
  const { date: displayDate, timestamp } = useAdminDateFormatters();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [state, setState] = useState({ items: [], filtered: 0, scope: '', loading: true, error: '' });
  const [tick, setTick] = useState(0);
  const badRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (badRange || !can.history) return undefined;
    const controller = new AbortController();
    let current = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    stockHistory(row.productId, { from_date: from ? dayStartISO(from) : '', to_date: to ? dayEndExclusiveISO(to) : '', offset: (page - 1) * pageSize, limit: pageSize }, controller.signal)
      .then((d) => { if (current) setState({ items: d.items || [], filtered: d.filtered ?? 0, scope: d.scope || '', loading: false, error: '' }); })
      .catch((e) => { if (current && !controller.signal.aborted) setState((s) => ({ ...s, items: [], loading: false, error: e.message || 'History could not be loaded.' })); });
    return () => { current = false; controller.abort(); };
  }, [row.productId, from, to, page, pageSize, tick, badRange, can.history]);

  const lots = useMemo(() => groupStockLots(row.lots), [row.lots]);
  const lotById = useMemo(() => new Map(lots.filter((g) => g.lot.lotId).map((g) => [g.lot.lotId, g.lot])), [lots]);
  const locationById = useMemo(() => new Map((row.lots || []).filter((l) => l.locationId && l.locationName).map((l) => [l.locationId, l.locationName])), [row.lots]);
  const pageCount = Math.max(1, Math.ceil(state.filtered / pageSize));
  const columns = [
    { key: 'd', label: 'Posted', render: (r) => timestamp(r.at) },
    { key: 'lot', label: 'Lot', render: (r) => <>{lotById.has(r.lotId) ? (lotById.get(r.lotId).source === 'opening' ? 'Opening stock lot' : lotById.get(r.lotId).batchNo || 'Batch unavailable') : 'Lot name unavailable'}{r.lotId && <details className="stock-detail__evidence"><summary>Lot reference &amp; origin</summary><p>{r.lotId}</p>{lotById.has(r.lotId) && <p>{lotOriginLabel(lotById.get(r.lotId))}</p>}</details>}</> },
    { key: 'loc', label: 'Location', render: (r) => !r.locationId ? 'Unallocated' : <>{locationById.get(r.locationId) || 'Name unavailable'}<details className="stock-detail__evidence"><summary>Location reference</summary><p>{r.locationId}</p></details></> },
    { key: 'dl', label: 'Change', render: (r) => <span className="inv-mono">{r.delta}</span> },
    { key: 'ba', label: 'Before / After', render: (r) => <span className="inv-mono">{r.before} to {r.after}</span> },
    { key: 'a', label: 'Actor', render: (r) => r.actor },
    { key: 's', label: 'Source', render: (r) => <span className="stock-status">{r.source?.startsWith('adjustment:') ? 'Manual adjustment' : r.source?.startsWith('opening:') ? 'Opening stock' : r.movementId ? 'Transfer / allocation' : r.source?.startsWith('assembly:') ? (r.delta.startsWith('-') ? 'Assembly consumption' : 'Assembly output') : 'Receipt'}</span> },
  ];
  return <section className="admin-panel stock-detail" aria-label="Product stock details">
    <div className="stock-detail__summary"><div><span>Current on hand</span><strong className="inv-mono">{row.quantity} <small>{row.unit || 'Unit unavailable'}</small></strong></div>{asOf && <span>As of {timestamp(asOf)}</span>}</div>
    <details className="stock-detail__evidence"><summary>Product reference &amp; catalogue details</summary><dl className="stock-detail__meta"><div><dt>Product reference</dt><dd>{row.productId}</dd></div><div><dt>Catalogue selling price</dt><dd>{formatPrice(row.sellingPrice)}</dd></div></dl></details>
    {coverage && <details className="stock-detail__evidence"><summary>Stock snapshot coverage</summary><p>{coverage.contract}</p><p>Openings: {coverage.openings || 'Coverage unavailable'}</p><p>Sales: {coverage.sales || 'Coverage unavailable'}</p><p>History date filters do not change the current on-hand quantity above.</p></details>}
    <h2 className="stock-section-title">Lots on hand</h2>
    <div className="stock-lots">
      {lots.length ? <ul className="stock-lots__list" aria-label="Lots on hand">{lots.map((group) => <LotRow key={group.key} group={group} fallbackUnit={row.unit} itemKind={row.itemKind} displayDate={displayDate} />)}</ul>
        : <div className="admin-empty"><strong>No lots on hand</strong><p>{row.itemKind === 'combo' ? 'No combo quantity remains on hand.' : 'This allergen has no receipt or opening quantity on hand.'}</p></div>}
    </div>
    {can.history ? <><h2 className="stock-section-title">Posting history</h2>
    <div className="inv-period">
      <label className="stock-field stock-field--inline">From (UTC) <input type="date" className="admin-input" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} data-testid="input-stock-history-from" /></label>
      <label className="stock-field stock-field--inline">To (UTC) <input type="date" className="admin-input" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} data-testid="input-stock-history-to" /></label>
      {(from || to) && <button type="button" className="admin-button admin-button--secondary" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>All periods</button>}
    </div>
    {badRange && <div className="admin-feedback admin-feedback--error" role="alert">The start date must not be after the end date.</div>}
    {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
    <div className="stock-history-table" aria-busy={state.loading}>
      {state.loading ? <div className="admin-empty" role="status"><strong>Loading history…</strong></div>
        : state.error || badRange ? null
        : state.items.length ? <DataTable columns={columns} rows={state.items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Posting history" testIdPrefix="stock-history" />
        : <div className="admin-empty"><strong>No postings in this period</strong><p>Choose All periods to see every recorded posting.</p></div>}
      {!state.loading && !state.error && !badRange && <TablePagination page={Math.min(page, pageCount)} pageCount={pageCount} pageSize={pageSize} filtered={state.filtered} total={state.filtered} label="postings" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-stock-history-count" />}
    </div>
    {state.scope && <details className="stock-detail__evidence"><summary>History coverage</summary><p className="mr-form__hint">{state.scope}</p></details>}</>
      : <p className="mr-form__hint">View Stock History permission is required to read historical postings.</p>}
  </section>;
}

function LotRow({ group, fallbackUnit, itemKind, displayDate }) {
  const { lot: l, allocations } = group;
  const unit = l.unit || fallbackUnit || 'Unit unavailable';
  return <li className="stock-lot" data-testid={`row-stock-lot-${group.key}`}>
    <dl className="stock-lot__row">
      <div><dt>Batch</dt><dd><strong>{l.batchNo || 'Batch unavailable'}</strong></dd></div>
      <div><dt>Concentration</dt><dd>{concentrationLabel(l.resultingConcentration ?? l.concentration)}</dd></div>
      <div><dt>Expiry</dt><dd>{l.expiryDate ? displayDate(l.expiryDate) : 'Unavailable'}</dd></div>
      <div><dt>On hand</dt><dd className="inv-mono"><strong>{group.quantity}</strong><small>{unit}</small></dd></div>
      <div><dt>Location</dt><dd>{allocations.length === 1 ? (l.locationId ? l.locationName || 'Name unavailable' : 'Unallocated') : `${allocations.length} locations`}</dd></div>
    </dl>
    {(!group.complete || !l.lotId) && <p className="stock-lot__warning" role="note">{!group.complete ? 'Total unavailable; review saved allocation quantities.' : 'Lot identity unavailable; allocations shown separately.'}</p>}
    <div className="stock-lot__disclosures">
      <details className="stock-detail__evidence"><summary>Locations &amp; quantities</summary>
        <ul className="stock-lot__allocations">{allocations.map((a, i) => <li key={`${a.locationId}-${i}`}><span>{a.locationId ? a.locationName || 'Location name unavailable' : 'Unallocated'}{a.locationId && <span className="stock-sub">Reference: {a.locationId}</span>}</span><strong className="inv-mono">{a.quantity ?? 'Unavailable'} <small>{a.unit || unit}</small></strong></li>)}</ul>
      </details>
      <details className="stock-detail__evidence"><summary>Lot source &amp; provenance</summary>
        <dl className="stock-detail__meta">
          <div><dt>Lot reference</dt><dd>{l.lotId || 'Unavailable'}</dd></div>
          <div><dt>Origin</dt><dd>{lotOriginLabel(l)}</dd></div>
          <div><dt>Receipt</dt><dd>{l.receiptNumber || 'Unavailable'}</dd></div>
          {l.receiptId && <div><dt>Receipt reference</dt><dd>{l.receiptId}</dd></div>}
          {l.originLocationName && <div><dt>Original location</dt><dd>{l.originLocationName}</dd></div>}
          {l.source === 'opening' && <><div><dt>Opening rate</dt><dd>{l.unitRate ?? 'Unavailable'}</dd></div><div><dt>Opening value</dt><dd>{l.openingValue ?? 'Unavailable'}</dd></div></>}
        </dl>
        {(l.recipe || l.sourceComponents || l.assemblyId) ? <ComboProvenance item={l} /> : itemKind === 'combo' ? <p>No retained assembly details.</p> : null}
      </details>
    </div>
  </li>;
}
