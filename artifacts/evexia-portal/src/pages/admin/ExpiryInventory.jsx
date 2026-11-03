import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, History, IndianRupee, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import { usePlatformConfirm } from '../../components/PlatformConfirmation.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import InHouseAccessDenied from './InHouseAccessDenied.jsx';
import {
  EXPIRY_LIMIT, EXPIRY_PENDING_EVENT, expiryRequestOutcome, forgetExpiry, inr, isZeroCost, journaledExpiry, listExpiry,
  newKey, pendingExpiry, provenanceLabel, reconcileExpiryRead, reviewDisposal, saveDisposal, saveExpiryCost, validProvenance, validUnitCost,
} from '../../services/serverInventory.js';
import '../../mr.css';
import '../../inventoryServer.css';
import '../../stockStatus.css';
import './ExpiryInventory.css';

const BASE = '/admin/inventory';
const STATUS_LABEL = {
  today: 'Expires today - already unusable',
  next15: 'Tomorrow to day 15',
  expired: 'Expired',
  unknown: 'Expiry unknown - excluded from usable stock',
  future: 'Beyond 15 days',
};
const GROUPS = [
  { value: 'all', label: 'All expiring' },
  { value: 'today', label: 'Today (unusable)' },
  { value: 'next15', label: 'Tomorrow to day 15' },
];

export default function ExpiryInventory({ kind }) {
  const { user } = useAdminSession();
  return isSuperAdminIdentity(user) ? <ExpiryWorkspace key={kind} kind={kind} /> : <InHouseAccessDenied />;
}

function usePendingExpiry() {
  const [state, setState] = useState({ item: null, error: '' });
  const read = useCallback(() => {
    try { setState({ item: pendingExpiry(), error: '' }); } catch (e) { setState({ item: null, error: e.message }); }
  }, []);
  useEffect(() => {
    read();
    window.addEventListener('storage', read);
    window.addEventListener(EXPIRY_PENDING_EVENT, read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener(EXPIRY_PENDING_EVENT, read); };
  }, [read]);
  return { ...state, blocked: Boolean(state.item) || Boolean(state.error), read };
}

const facts = (row) => [
  ['Product', row.productName], ['Category', row.category || 'Uncategorised'], ['Batch', row.batchNo || 'No batch'],
  ['Source', row.sourceKind === 'reserve' ? 'In-house reserve' : 'Stock lot'], ['Location', row.locationName || 'No location'],
];

function ExpiryWorkspace({ kind }) {
  const { date, timestamp } = useAdminDateFormatters();
  const [tab, setTab] = useState(kind === 'expiring' ? 'soon' : 'expired');
  const view = kind === 'expiring' ? 'soon' : tab;
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [dispose, setDispose] = useState(null);
  const [cost, setCost] = useState(null);
  const pending = usePendingExpiry();
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async ({ reconcile = false, signal } = {}) => {
    const id = ++seq.current;
    setLoading(true); setLoadError(''); setData(null);
    const params = { view, group: view === 'soon' ? group : undefined, query, offset, limit: EXPIRY_LIMIT };
    try {
      const next = await (reconcile ? reconcileExpiryRead(params, signal) : listExpiry(params, signal));
      if (id !== seq.current || signal?.aborted) return;
      setData(next); setLoading(false);
    } catch (e) {
      if (id !== seq.current || signal?.aborted) return;
      setData(null); setLoadError(e.message || 'Expiry records could not be loaded.'); setLoading(false);
    }
  }, [view, group, query, offset]);
  useEffect(() => { const c = new AbortController(); load({ signal: c.signal }); return () => { c.abort(); seq.current++; }; }, [load]);

  const filtered = data?.filtered ?? 0;
  const items = data?.items || [];
  const s = data?.summary;
  const hasFilters = Boolean(search || (view === 'soon' && group !== 'all'));
  const actionable = (r) => r.status === 'expired' || r.status === 'today';
  const actionsOff = pending.blocked || loading || Boolean(loadError);

  const baseCols = [
    { key: 'p', label: 'Product', render: (r) => <><strong className="admin-table__name">{r.productName}</strong><span className="stock-sub">{r.category || 'Uncategorised'} · {r.sourceKind === 'reserve' ? 'In-house reserve' : 'Stock lot'}</span></> },
    { key: 'b', label: 'Batch', render: (r) => <span className="inv-mono">{r.batchNo || 'No batch'}</span> },
    { key: 'l', label: 'Location', render: (r) => r.locationName || 'No location' },
    { key: 'e', label: 'Expiry', render: (r) => <><span>{r.expiryDate ? date(r.expiryDate) : 'Unknown'}</span><span className={`expiry-tag expiry-tag--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></> },
    { key: 'q', label: 'Quantity', render: (r) => <strong className="inv-mono">{r.quantity} {r.unit}</strong> },
    { key: 'c', label: 'Unit cost', render: (r) => r.unitCost == null ? <span className="expiry-uncosted">Cost unavailable</span> : <><span className="inv-mono">{inr(r.unitCost)}</span><span className="stock-sub">{provenanceLabel(r.costProvenance)}</span></> },
    { key: 'v', label: 'Value', render: (r) => r.expiredValue == null ? <span className="expiry-uncosted">Not valued</span> : <strong className="inv-mono">{inr(r.expiredValue)}</strong> },
  ];
  const actionCol = { key: 'a', label: 'Actions', render: (r) => <div className="stock-row-actions">
    {r.unitCost == null && <button type="button" className="admin-button admin-button--secondary stock-view" disabled={actionsOff} onClick={() => { setNotice(''); setCost(r); }} data-testid={`button-cost-${r.batchId}`}><IndianRupee size={14} /> Enter cost</button>}
    {actionable(r) && <button type="button" className="admin-button admin-button--secondary stock-view expiry-dispose" disabled={actionsOff} onClick={() => { setNotice(''); setDispose(r); }} data-testid={`button-dispose-${r.batchId}`}><Trash2 size={14} /> Dispose</button>}
  </div> };
  const historyCols = [
    { key: 'at', label: 'Disposed', render: (r) => <><span>{timestamp(r.at)}</span><span className="stock-sub">by {r.actor || 'Unknown actor'}</span></> },
    ...baseCols.slice(0, 5),
    { key: 'r', label: 'Reason', render: (r) => <span className="expiry-reason">{r.reason}</span> },
    { key: 'cs', label: 'Cost at disposal', render: (r) => { const unit = r.costSnapshot?.unitCost ?? r.unitCost; const prov = r.costSnapshot?.provenance ?? r.costSnapshot?.costProvenance ?? r.costProvenance;
      return unit == null ? <span className="expiry-uncosted">Uncosted at disposal</span> : <><span className="inv-mono">{inr(unit)}</span><span className="stock-sub">{provenanceLabel(prov)}</span>{r.expiredValue != null && <span className="stock-sub">Loss {inr(r.expiredValue)}</span>}</>; } },
  ];
  const columns = view === 'history' ? historyCols : [...baseCols, actionCol];
  const rowKey = (r) => r.id || `${r.sourceKind}-${r.batchId}-${r.locationId || 'none'}`;
  const todayRows = view === 'soon' && group === 'all' ? items.filter((r) => r.status === 'today') : [];
  const laterRows = view === 'soon' && group === 'all' ? items.filter((r) => r.status !== 'today') : [];

  async function checkOutcome() {
    const item = pending.item; if (!item) return;
    try {
      const r = await expiryRequestOutcome(item.key);
      await forgetExpiry(item.key);
      setNotice(r.state === 'committed' ? 'The earlier save was committed. Records refreshed.' : 'The earlier save was not committed. Nothing changed; you can act again.');
      load({ reconcile: true });
    } catch (e) { setNotice(''); setLoadError(e.message || 'The earlier outcome could not be checked. Retry.'); }
  }
  const done = (msg) => { setDispose(null); setCost(null); setNotice(msg); load({ reconcile: true }); };

  const title = kind === 'expiring' ? 'Expiring soon' : 'Expired and disposal';
  return <AdminLayout title={title}><div className="stock-page expiry-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Expiry</p><h1>{title}</h1>
      <p className="admin-page-head__description">{kind === 'expiring' ? 'Batches expiring today are already unusable and listed apart from those expiring tomorrow through day 15.' : 'Expired batches awaiting disposal, and a read-only record of every disposal.'}</p></div>
      <div className="stock-actions">
        <Link href={`${BASE}/stock-status`} className="admin-button admin-button--secondary" data-testid="link-expiry-stock-status"><ArrowLeft size={15} /> Stock status</Link>
        <Link href={`${BASE}/${kind === 'expiring' ? 'expired' : 'expiring'}`} className="admin-button admin-button--secondary" data-testid="link-expiry-switch">{kind === 'expiring' ? <><AlertTriangle size={15} /> Expired</> : <><History size={15} /> Expiring soon</>}</Link>
      </div></div>

    {pending.error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-expiry-storage">{pending.error}</div>}
    {pending.item && <div className="admin-feedback admin-feedback--error inv-banner" role="alert" data-testid="status-expiry-pending">
      <p><strong>An earlier {pending.item.kind === 'cost' ? 'cost' : 'disposal'} save has an unconfirmed outcome.</strong> New disposals and cost entries are blocked until it is checked.</p>
      <button type="button" className="admin-button admin-button--secondary" onClick={checkOutcome} data-testid="button-check-expiry-outcome">Check outcome</button></div>}
    {notice && <div className="admin-feedback" role="status" data-testid="status-expiry-notice">{notice}</div>}

    <section className="expiry-ledger" aria-label="Scope totals" data-testid="panel-expiry-summary">
      <div className="expiry-ledger__cell expiry-ledger__cell--lead"><span>Expired stock value awaiting disposal</span><strong className="inv-mono" data-testid="text-pending-value">{s ? inr(s.pendingValue) : '...'}</strong><small>Costed batches only</small></div>
      <div className="expiry-ledger__cell"><span>Disposed loss</span><strong className="inv-mono" data-testid="text-disposed-value">{s ? inr(s.disposedValue) : '...'}</strong><small data-testid="text-disposed-uncosted">{!s ? '' : s.disposedUncostedBatches ? `Incomplete: excludes ${s.disposedUncostedBatches} uncosted disposed batch${s.disposedUncostedBatches === 1 ? '' : 'es'}${s.disposedUncostedQuantities?.length ? ` (${s.disposedUncostedQuantities.map((u) => `${u.quantity} ${u.unit}`).join(' · ')})` : ''}` : 'All disposed batches costed'}</small></div>
      <div className="expiry-ledger__cell"><span>Uncosted batches</span><strong className="inv-mono" data-testid="text-uncosted-batches">{s ? s.uncostedBatches : '...'}</strong>
        <small>{s?.uncostedQuantities?.length ? s.uncostedQuantities.map((u) => `${u.quantity} ${u.unit}`).join(' · ') : 'No uncosted quantity'}</small></div>
      <div className="expiry-ledger__cell"><span>Unknown expiry</span><strong className="inv-mono" data-testid="text-unknown-expiry">{s ? (s.unknownExpiryBatches ?? 0) : '...'}</strong><small>Excluded from usable stock</small></div>
      <div className="expiry-ledger__cell"><span>Daily digest</span><strong>{!data?.digest ? 'Not sent' : data.digest.status === 'accepted' ? 'Accepted by provider' : String(data.digest.status ?? 'Unknown')}</strong><small>{data?.digest ? `${date(data.digest.day)}${data.digest.category ? ` · ${data.digest.category}` : ''}${data.digest.status === 'accepted' ? ' · Not proof of recipient delivery' : ''}` : 'No digest for this scope'}</small></div>
      <p className="expiry-ledger__note">Totals cover the whole filtered scope, not this page{data?.asOf ? ` · As of ${timestamp(data.asOf)}` : ''}.</p>
    </section>

    <section className="admin-panel stock-panel">
      {kind === 'expired' && <div className="expiry-tabs" role="tablist" aria-label="Expired views">
        {[['expired', 'Awaiting disposal'], ['history', 'Disposal history']].map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={tab === v} className={`expiry-tab${tab === v ? ' is-active' : ''}`} onClick={() => { setTab(v); setOffset(0); setNotice(''); }} data-testid={`tab-expiry-${v}`}>{l}</button>)}
      </div>}
      <div className="stock-toolbar"><div className="master-filter-toolbar">
        <div className="stock-search-group">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => { setNotice(''); load({ reconcile: true }); }} disabled={loading} data-testid="button-refresh-expiry"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
          <div className="admin-filter stock-search"><div className="admin-search"><Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Search expiry records" maxLength={200} value={search} placeholder="Product, batch, location or category" onChange={(e) => setSearch(e.target.value)} data-testid="input-search-expiry" /></div></div>
          {view === 'soon' && <div className="admin-filter"><label htmlFor="expiry-group" className="sr-only">Window</label>
            <select id="expiry-group" className="admin-select" value={group} onChange={(e) => { setGroup(e.target.value); setOffset(0); }} data-testid="select-expiry-group">
              {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></div>}
        </div>
        <MasterFilterReset disabled={!hasFilters} onClick={() => { setSearch(''); setQuery(''); setGroup('all'); setOffset(0); }} testId="button-reset-expiry-filters" />
      </div></div>

      <details className="expiry-rules"><summary><ShieldCheck size={15} aria-hidden="true" /> How costs and expiry are treated</summary><ul>
        <li><strong>Cost unavailable</strong> means no purchase or manufacturing cost per unit was captured for the batch. Its value is excluded from totals and counted as uncosted until an administrator records a cost.</li>
        <li>The catalogue selling price is never substituted for a missing cost.</li>
        <li>Batches with an <strong>unknown expiry</strong> are excluded from usable stock until corrected.</li>
        <li>Batches expiring <strong>today</strong> are already unusable and can be disposed.</li>
      </ul></details>

      {loadError && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{loadError}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => load()} data-testid="button-retry-expiry">Retry</button></div>}
      {loading ? <div className="expiry-skeleton" role="status" aria-live="polite"><span className="sr-only">Loading expiry records</span>{Array.from({ length: 6 }, (_, i) => <div key={i} />)}</div>
        : loadError || !data ? null
        : items.length === 0 ? <div className="admin-empty" role="status"><strong>{view === 'history' ? 'No disposals recorded' : view === 'soon' ? 'Nothing expires in the next 15 days' : 'No expired batches awaiting disposal'}</strong><p>{hasFilters ? 'Change the search or window to widen the scope.' : 'Records appear here as soon as the server reports them.'}</p></div>
        : view === 'soon' && group === 'all' ? <>
          {todayRows.length > 0 && <div className="expiry-group expiry-group--today"><h2>Expires today <span>Already unusable</span></h2><div className="stock-list-table"><DataTable columns={columns} rows={todayRows} rowOffset={0} rowKey={rowKey} label="Expiring today" testIdPrefix="expiry-today" /></div></div>}
          {laterRows.length > 0 && <div className="expiry-group"><h2>Tomorrow to day 15</h2><div className="stock-list-table"><DataTable columns={columns} rows={laterRows} rowOffset={0} rowKey={rowKey} label="Expiring tomorrow to day 15" testIdPrefix="expiry-next15" /></div></div>}
        </>
        : <div className="stock-list-table" aria-busy={loading}><DataTable columns={columns} rows={items} rowOffset={offset} rowKey={rowKey} label={view === 'history' ? 'Disposal history' : 'Expiry records'} testIdPrefix={`expiry-${view}`} /></div>}
      {data && <div className="expiry-pager" data-testid="text-expiry-count">
        <span>{filtered === 0 ? 'No records' : `${offset + 1}-${Math.min(offset + EXPIRY_LIMIT, filtered)} of ${filtered}`}</span>
        <div><button type="button" className="admin-button admin-button--secondary" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - EXPIRY_LIMIT))} aria-label="Previous page" data-testid="button-expiry-prev"><ChevronLeft size={15} /></button>
          <button type="button" className="admin-button admin-button--secondary" disabled={loading || offset + EXPIRY_LIMIT >= filtered} onClick={() => setOffset(offset + EXPIRY_LIMIT)} aria-label="Next page" data-testid="button-expiry-next"><ChevronRight size={15} /></button></div>
      </div>}
    </section>
    {dispose && <DisposeDialog row={dispose} date={date} blocked={pending.blocked} onClose={() => setDispose(null)} onDone={() => done('Disposal recorded. It now appears in Disposal history.')} onUncertain={() => { setDispose(null); pending.read(); }} />}
    {cost && <CostDialog row={cost} blocked={pending.blocked} onClose={() => setCost(null)} onDone={() => done('Cost recorded for this batch.')} onUncertain={() => { setCost(null); pending.read(); }} />}
  </div></AdminLayout>;
}

function Facts({ row, date }) {
  return <dl className="expiry-facts">{facts(row).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    <div><dt>Expiry</dt><dd>{row.expiryDate ? date(row.expiryDate) : 'Unknown'}</dd></div>
    <div><dt>Available</dt><dd className="inv-mono">{row.quantity} {row.unit}</dd></div>
    <div><dt>Unit cost</dt><dd className="inv-mono">{row.unitCost == null ? 'Cost unavailable' : `${inr(row.unitCost)} (${provenanceLabel(row.costProvenance)})`}</dd></div></dl>;
}

function DisposeDialog({ row, date, blocked, onClose, onDone, onUncertain }) {
  const confirm = usePlatformConfirm();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const keyRef = useRef(null);
  async function submit(e) {
    e.preventDefault();
    if (busy || blocked) return;
    const err = {};
    if (!reason.trim()) err.reason = 'Enter a disposal reason.';
    else if (reason.trim().length > 500) err.reason = 'Reason must be 500 characters or fewer.';
    setErrors(err); setMessage('');
    if (Object.keys(err).length) return;
    setBusy(true);
    const body = { sourceKind: row.sourceKind, batchId: row.batchId, locationId: row.locationId ?? null, quantity: row.quantity, reason: reason.trim() };
    try {
      const reviewed = await reviewDisposal(body);
      const b = reviewed.batch;
      const ok = await confirm(`Dispose ${b.quantity ?? body.quantity} ${b.unit || row.unit} of ${b.productName}, batch ${b.batchNo || 'No batch'}, at ${b.locationName || 'No location'}. Unit cost: ${b.unitCost == null ? 'Cost unavailable (counted as uncosted)' : `${inr(b.unitCost)}`}. Value: ${b.expiredValue == null ? 'Not valued' : inr(b.expiredValue)}. Reason: ${b.reason || body.reason}. This is permanent and appears in disposal history.`,
        { title: 'Confirm disposal', actionLabel: 'Dispose stock', destructive: true });
      if (!ok) { setBusy(false); return; }
      const key = keyRef.current || (keyRef.current = newKey());
      await journaledExpiry(key, 'disposal', () => saveDisposal({ ...body, reviewToken: reviewed.reviewToken, idempotencyKey: key }));
      keyRef.current = null;
      onDone();
    } catch (cause) {
      setBusy(false);
      if (cause.uncertain) { onUncertain(); return; }
      keyRef.current = null;
      setMessage(`${cause.message || 'Nothing was disposed.'} Your entry is preserved.`);
    }
  }
  return <Dialog eyebrow="Inventory / Expiry" title="Dispose expired stock" description="The server reviews the batch before you confirm. Nothing is disposed until you confirm." onClose={busy ? () => {} : onClose} dismissDisabled={busy}
    footer={<><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={onClose} data-testid="button-cancel-dispose">Cancel</button>
      <button type="submit" form="expiry-dispose-form" className="admin-button admin-button--danger" disabled={busy || blocked} data-testid="button-review-dispose">{busy ? 'Working...' : 'Review disposal'}</button></>}>
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    {blocked && <div className="admin-feedback admin-feedback--error" role="alert">An earlier expiry save must be checked before disposing.</div>}
    <Facts row={row} date={date} />
    <form id="expiry-dispose-form" onSubmit={submit} noValidate className="expiry-form"><fieldset disabled={busy || blocked}>
      <div className="ms-field"><label htmlFor="dispose-qty">Quantity to dispose ({row.unit})</label>
        <input id="dispose-qty" className="mr-form__control inv-mono" value={`${row.quantity} ${row.unit}`} readOnly aria-describedby="dispose-qty-hint" data-testid="text-dispose-quantity" />
        <p id="dispose-qty-hint" className="mr-form__hint">Disposal always removes the entire remaining quantity. The server revalidates the exact remaining amount at review and save; if it changed, nothing is disposed and you must refresh.</p></div>
      <div className="ms-field"><label htmlFor="dispose-reason">Reason <span className="mr-form__required">*</span></label>
        <textarea id="dispose-reason" className="mr-form__control" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'dispose-reason-error' : undefined} placeholder="For example: expired 12 days ago, vials discarded under supervision" data-testid="input-dispose-reason" />
        {errors.reason && <p id="dispose-reason-error" className="mr-form__error" role="alert">{errors.reason}</p>}</div>
    </fieldset></form>
  </Dialog>;
}

function CostDialog({ row, blocked, onClose, onDone, onUncertain }) {
  const [unitCost, setUnitCost] = useState('');
  const [provenance, setProvenance] = useState('');
  const basis = (row.costTargetKind || row.sourceKind) === 'reserve' ? 'actual manufacturing cost' : 'actual purchase cost';
  const [knownZero, setKnownZero] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const keyRef = useRef(null);
  const zero = validUnitCost(unitCost) && isZeroCost(unitCost);
  // Diluted outputs are costed on their source reserve; the output rate is derived by the server from source cost and factor.
  const target = { kind: row.costTargetKind || row.sourceKind, id: row.costTargetId || row.batchId, unit: row.costTargetUnit || row.unit };
  const redirected = target.id !== row.batchId || target.kind !== row.sourceKind || target.unit !== row.unit;
  async function submit(e) {
    e.preventDefault();
    if (busy || blocked) return;
    const err = {};
    if (!validUnitCost(unitCost)) err.unitCost = 'Enter a plain decimal: up to 9 whole digits and 6 decimals.';
    else if (zero && !knownZero) err.unitCost = 'A zero cost must be confirmed as known.';
    if (!validProvenance(provenance)) err.provenance = 'Describe the documented source in 3 to 1000 characters.';
    setErrors(err); setMessage('');
    if (Object.keys(err).length) return;
    setBusy(true);
    const key = keyRef.current || (keyRef.current = newKey());
    try {
      await journaledExpiry(key, 'cost', () => saveExpiryCost({ sourceKind: target.kind, batchId: target.id, unitCost: unitCost.trim(), provenance: provenance.trim(), idempotencyKey: key }));
      keyRef.current = null; onDone();
    } catch (cause) {
      setBusy(false);
      if (cause.uncertain) { onUncertain(); return; }
      keyRef.current = null; setMessage(`${cause.message || 'The cost was not saved.'} Your entry is preserved.`);
    }
  }
  return <Dialog eyebrow="Inventory / Expiry" title="Record unavailable cost" description={`Cost per established unit (${target.unit}) in INR for ${row.productName}, batch ${row.batchNo || 'No batch'}. Only batches without a captured cost can be costed here; selling price is never used.`} onClose={busy ? () => {} : onClose} dismissDisabled={busy}
    footer={<><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={onClose} data-testid="button-cancel-cost">Cancel</button>
      <button type="submit" form="expiry-cost-form" className="admin-button" disabled={busy || blocked} data-testid="button-save-cost">{busy ? 'Saving...' : 'Save cost'}</button></>}>
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    {redirected && <div className="admin-feedback" role="note" data-testid="text-cost-source-reserve"><strong>Enter the source reserve cost, not the output rate.</strong> This batch is a dilution. Its cost is recorded on the source {target.kind === 'reserve' ? 'in-house reserve' : 'batch'} per {target.unit} of that source. Do not enter a per {row.unit} rate for the diluted output; the server derives the output rate exactly from the source cost and dilution factor.</div>}
    <form id="expiry-cost-form" onSubmit={submit} noValidate className="expiry-form"><fieldset disabled={busy || blocked}>
      <div className="ms-field"><label htmlFor="cost-unit">{redirected ? 'Source reserve unit cost' : 'Unit cost'} (INR per {target.unit}{redirected ? ' of source reserve' : ''}) <span className="mr-form__required">*</span></label>
        <input id="cost-unit" className="mr-form__control inv-mono" inputMode="decimal" maxLength={16} value={unitCost} onChange={(e) => { setUnitCost(e.target.value); setKnownZero(false); }} aria-invalid={Boolean(errors.unitCost)} aria-describedby="cost-unit-hint" data-testid="input-cost-unit" />
        <p id="cost-unit-hint" className={errors.unitCost ? 'mr-form__error' : 'mr-form__hint'} role={errors.unitCost ? 'alert' : undefined}>{errors.unitCost || 'Up to 9 whole digits and 6 decimals, stored exactly as entered.'}</p></div>
      <div className="ms-field"><label htmlFor="cost-prov">Cost source <span className="mr-form__required">*</span></label>
        <textarea id="cost-prov" className="mr-form__control" rows={3} maxLength={1000} value={provenance} onChange={(e) => setProvenance(e.target.value)} placeholder="For example: supplier invoice INV-2291 line 4, or manufacturing worksheet MW-118" aria-invalid={Boolean(errors.provenance)} aria-describedby="cost-prov-hint" data-testid="input-cost-provenance" />
        <p id="cost-prov-hint" className={errors.provenance ? 'mr-form__error' : 'mr-form__hint'} role={errors.provenance ? 'alert' : undefined}>{errors.provenance || `Recorded as ${basis}. Cite the document that establishes it.`}</p></div>
      {zero && <label className="expiry-check"><input type="checkbox" checked={knownZero} onChange={(e) => setKnownZero(e.target.checked)} data-testid="checkbox-known-zero" /> This batch genuinely cost nothing (known zero), not an unknown cost.</label>}
    </fieldset></form>
  </Dialog>;
}
