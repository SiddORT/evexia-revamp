import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import TablePagination from './TablePagination.jsx';
import ComboProvenance from './ComboProvenance.jsx';
import { dayEndExclusiveISO, dayStartISO, formatPrice, stockHistory } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';

export default function StockStatusDetail({ row, asOf, onClose }) {
  const { date: displayDate, timestamp } = useAdminDateFormatters();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [state, setState] = useState({ items: [], filtered: 0, scope: '', loading: true, error: '' });
  const [tick, setTick] = useState(0);
  const badRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (badRange) return undefined;
    const controller = new AbortController();
    let current = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    stockHistory(row.productId, { from_date: from ? dayStartISO(from) : '', to_date: to ? dayEndExclusiveISO(to) : '', offset: (page - 1) * pageSize, limit: pageSize }, controller.signal)
      .then((d) => { if (current) setState({ items: d.items || [], filtered: d.filtered ?? 0, scope: d.scope || '', loading: false, error: '' }); })
      .catch((e) => { if (current && !controller.signal.aborted) setState((s) => ({ ...s, items: [], loading: false, error: e.message || 'History could not be loaded.' })); });
    return () => { current = false; controller.abort(); };
  }, [row.productId, from, to, page, pageSize, tick, badRange]);

  const lotById = useMemo(() => Object.fromEntries(row.lots.map((l) => [l.lotId, l])), [row]);
  const pageCount = Math.max(1, Math.ceil(state.filtered / pageSize));
  const lotColumns = [
    { key: 'b', label: 'Batch', render: (l) => l.batchNo || 'Unavailable' },
    { key: 'r', label: 'Receipt', render: (l) => l.receiptNumber || 'Unavailable' },
    { key: 'e', label: 'Expiry', render: (l) => l.expiryDate ? displayDate(l.expiryDate) : 'Unavailable' },
    { key: 'l', label: 'Location', render: (l) => l.locationName },
    { key: 'q', label: 'On hand', render: (l) => <span className="inv-mono">{l.quantity}</span> },
  ];
  const columns = [
    { key: 'd', label: 'Posted', render: (r) => timestamp(r.at) },
    { key: 'lot', label: 'Lot', render: (r) => lotById[r.lotId] ? `${lotById[r.lotId].batchNo || 'Batch unavailable'} · ${lotById[r.lotId].receiptNumber || 'Assembled combo'}` : r.lotId.slice(0, 8) },
    { key: 'loc', label: 'Location', render: (r) => lotById[r.lotId]?.locationId === r.locationId ? lotById[r.lotId].locationName : r.locationId.slice(0, 8) },
    { key: 'dl', label: 'Change', render: (r) => <span className="inv-mono">{r.delta}</span> },
    { key: 'ba', label: 'Before / After', render: (r) => <span className="inv-mono">{r.before} to {r.after}</span> },
    { key: 'a', label: 'Actor', render: (r) => r.actor },
    { key: 's', label: 'Source', render: (r) => <span className="stock-status">{r.movementId ? 'Transfer' : r.source?.startsWith('assembly:') ? (r.delta.startsWith('-') ? 'Assembly consumption' : 'Assembly output') : 'Receipt'}</span> },
  ];
  return <Dialog className="stock-detail" eyebrow={row.itemKind === 'combo' ? 'Assembled combo stock' : 'Individual allergen stock'} title={row.name} onClose={onClose}
    description={`ID ${row.productId} · ${row.concentration} · ${row.category} · ${formatPrice(row.sellingPrice)}. On hand ${row.quantity} ${row.unit}${asOf ? ` as of ${timestamp(asOf)}` : ''}.`}>
    <div className="admin-feedback" role="note">No sales backend is connected and no opening balances are inferred. History shows recorded receipt, assembly and transfer postings, including saved before/after balances.</div>
    {row.itemKind === 'combo' && <ComboLots lots={row.lots} />}
    <h3 className="stock-section-title">Lots on hand</h3>
    <div className="stock-history-table">
      {row.lots.length ? <DataTable columns={lotColumns} rows={row.lots} rowKey={(l) => `${l.lotId}-${l.locationId}`} label="Lots on hand" testIdPrefix="stock-lot" />
        : <div className="admin-empty"><strong>No lots on hand</strong><p>{row.itemKind === 'combo' ? 'No assembled combo quantity remains on hand.' : 'This allergen has no accepted receipt quantity on hand.'}</p></div>}
    </div>
    <h3 className="stock-section-title">Posting history</h3>
    <div className="inv-period">
      <label className="stock-field stock-field--inline">From <input type="date" className="admin-input" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} data-testid="input-stock-history-from" /></label>
      <label className="stock-field stock-field--inline">To <input type="date" className="admin-input" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} data-testid="input-stock-history-to" /></label>
      {(from || to) && <button type="button" className="admin-button admin-button--secondary" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>All periods</button>}
    </div>
    <p className="mr-form__hint">The period filters this history only (UTC days). It never changes current stock.</p>
    {badRange && <div className="admin-feedback admin-feedback--error" role="alert">The start date must not be after the end date.</div>}
    {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
    <div className="stock-history-table" aria-busy={state.loading}>
      {state.loading ? <div className="admin-empty" role="status"><strong>Loading history…</strong></div>
        : state.error || badRange ? null
        : state.items.length ? <DataTable columns={columns} rows={state.items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Posting history" testIdPrefix="stock-history" />
        : <div className="admin-empty"><strong>No postings in this period</strong><p>Choose All periods to see every recorded posting.</p></div>}
      {!state.error && !badRange && <TablePagination page={Math.min(page, pageCount)} pageCount={pageCount} pageSize={pageSize} filtered={state.filtered} total={state.filtered} label="postings" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-stock-history-count" />}
    </div>
    {state.scope && <p className="mr-form__hint">{state.scope}</p>}
  </Dialog>;
}

function ComboLots({ lots }) {
  const combos = (lots || []).filter((l) => l.recipe || l.sourceComponents || l.assemblyId);
  return <section data-testid="section-combo-provenance"><h3 className="stock-section-title">Combo provenance</h3>
    {combos.length ? combos.map((l) => <div className="admin-feedback" key={`${l.lotId}-${l.locationId}`}>
      <strong>{l.batchNo ? `Batch ${l.batchNo}` : 'Batch unavailable'} at {l.locationName}</strong><ComboProvenance item={l} /></div>) : <p>No retained assembly details.</p>}</section>;
}
