import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Activity, ArrowUpRight, BarChart3, ChevronDown, ClipboardCheck, Download, Eye, FileDown, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminDateFormatters, getAdminDisplayPreferences } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import PRDocumentPreview from '../../components/admin/PRDocumentPreview.jsx';
import ReceiptRetryRecovery from '../../components/admin/ReceiptRetryRecovery.jsx';
import SelectIndicator from '../../components/admin/SelectIndicator.jsx';
import { listPR, exportPR, activityPR, analyticsPR, filtersPR, pendingPR, sourcePR, getPR, exportPRCSV } from '../../services/serverPurchaseReceived.js';
import { downloadPRDocument, makePRDocument } from '../../services/prDocuments.js';
import { downloadBlob } from '../../services/downloads.js';
import '../../purchaseOrders.css';
import '../../purchaseReceived.css';

const BASE = '/admin/inventory/purchase-received';
const initial = { search: '', from: '', to: '', vendorId: '', receivedBy: '', fulfillment: '', status: 'active', sort: 'recent' };
export const fulfilClass = (f) => f === 'Closed' ? 'pr-tag pr-tag--closed' : f === 'Open' ? 'pr-tag pr-tag--open' : 'pr-tag';

export default function PurchaseReceived() {
  const { date, timestamp } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const poId = new URLSearchParams(useSearch()).get('poId') || '';
  const [tab, setTab] = useState('receipts');
  const [filters, setFilters] = useState(() => ({ ...initial, status: poId ? 'all' : 'active' }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [scope, setScope] = useState(poId ? 'all' : 'active'), [searchActivity, setSearchActivity] = useState('');
  const [freshness, setFreshness] = useState(0);
  const [data, setData] = useState(null), [stats, setStats] = useState(null), [options, setOptions] = useState({ vendors: [], receivers: [] });
  const [source, setSource] = useState(null), [error, setError] = useState(''), [actionError, setActionError] = useState('');
  const [doc, setDoc] = useState(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(() => { try { return { pending: pendingPR() }; } catch (e) { return { error: e.message }; } });
  const generation = useRef(0);
  const params = { po_id: poId, query: filters.search, from_date: filters.from, to_date: filters.to, vendor_id: filters.vendorId,
    receiver: filters.receivedBy, fulfillment: filters.fulfillment, status: tab === 'receipts' ? filters.status : scope,
    sort: filters.sort, limit: pageSize, offset: (page - 1) * pageSize, activity_query: searchActivity };
  const signature = JSON.stringify(params);
  useEffect(() => {
    setFilters({ ...initial, status: poId ? 'all' : 'active' }); setPage(1); setScope(poId ? 'all' : 'active');
  }, [poId]);
  useEffect(() => {
    const seq = ++generation.current;
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null); setStats(null); setOptions({ vendors: [], receivers: [] }); setSource(null);
    const fetcher = tab === 'receipts' ? listPR : tab === 'activity' ? activityPR : analyticsPR;
    Promise.all([fetcher(params, controller.signal),
      analyticsPR({ ...params, status: 'all' }, controller.signal),
      filtersPR({ po_id: poId, from_date: filters.from, to_date: filters.to }, controller.signal),
      poId ? sourcePR(poId, null, controller.signal) : Promise.resolve(null)]).then(([result, summary, choices, po]) => {
      if (seq !== generation.current || controller.signal.aborted) return;
      if (result.filtered > 0 && (page - 1) * pageSize >= result.filtered) { setPage(Math.ceil(result.filtered / pageSize)); return; }
      setData(result); setStats(summary); setOptions(choices); setSource(po); setLoading(false);
    }).catch((cause) => {
      if (seq !== generation.current || controller.signal.aborted) return;
      setError(cause.message || 'Could not load server receipts.'); setLoading(false);
    });
    return () => { controller.abort(); generation.current++; };
  }, [tab, signature, freshness]);
  const refresh = () => setFreshness((n) => n + 1);
  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const canCreate = !poId || (source?.status === 'open' && source?.fulfillment !== 'Closed');
  const open = (r) => navigate(`${BASE}/${r.id}`);
  async function documentAction(r, pdf) {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const saved = await getPR(r.id);
      const document = makePRDocument(saved, undefined, getAdminDisplayPreferences());
      if (pdf) await downloadPRDocument(document, `${saved.number}.pdf`, `${import.meta.env.BASE_URL}images/evexia-logo.png`);
      else setDoc(document);
    } catch (cause) { setActionError(cause.message); }
    finally { setBusy(false); }
  }
  async function csv() {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const result = await exportPR({ ...params, offset: 0 });
      if (result.items.length !== result.filtered) throw new Error('The complete filtered result was not returned. No CSV was downloaded.');
      const csv = exportPRCSV(result.items, { orders: [] });
      await downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'purchase-received.csv',
        { source: 'purchase_received', kind: 'export', format: 'CSV' });
    } catch (cause) { setActionError(cause.message); }
    finally { setBusy(false); }
  }
  const actions = (r) => <div className="po-actions">
    <button type="button" className="po-action po-action--icon" title="View" aria-label={`View ${r.number}`} onClick={() => open(r)}><ArrowUpRight size={15} /></button>
    <button type="button" className="po-action po-action--icon" title="Preview receipt" aria-label={`Preview ${r.number}`} disabled={busy} onClick={() => documentAction(r, false)}><Eye size={15} /></button>
    <button type="button" className="po-action po-action--icon" title="Download PDF" aria-label={`Download PDF for ${r.number}`} disabled={busy} onClick={() => documentAction(r, true)}><Download size={15} /></button>
  </div>;
  const columns = [
    { key: 's', label: 'Sr. No.', render: (_r, i) => i + 1 },
    { key: 'n', label: 'PR Number', render: (r) => <><button type="button" className="po-link po-number" onClick={() => open(r)}>{r.number}</button>{r.status === 'deleted' && <span className="po-status po-status--draft">deleted</span>}</> },
    { key: 'd', label: 'PR Date', render: (r) => date(r.receivedDate) },
    { key: 'p', label: 'PO Number', render: (r) => <button type="button" className="po-link" onClick={() => navigate(`/admin/inventory/purchase-orders/${r.poId}`)}>{r.poNumber}</button> },
    { key: 'f', label: 'PO Status', render: (r) => <span className={fulfilClass(r.fulfillment)}>{r.fulfillment}</span> },
    { key: 'b', label: 'Received By', render: (r) => r.receivedBy },
    { key: 'v', label: 'Vendor Details', render: (r) => <><strong>{r.vendorName}</strong><span className="po-secondary">{r.vendorPhone || 'No mobile on record'}</span></> },
    { key: 'a', label: 'Actions', render: actions },
  ];
  const select = (id, label, value, onChange, choices) => <div className="admin-filter"><label htmlFor={id}>{label}</label>
    <SelectIndicator><select id={id} className="admin-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {choices.map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></SelectIndicator></div>;
  const pages = data?.filtered ? Math.ceil(data.filtered / pageSize) : 1;
  const pagination = <TablePagination indicated page={page} pageCount={pages} pageSize={pageSize} filtered={data?.filtered || 0} total={data?.total || 0}
    label={tab === 'activity' ? 'events' : 'receipts'} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(Number(n)); setPage(1); }} testId="text-pr-count" />;
  return <AdminLayout title="Purchase Received"><div className="po-page pr-server-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Receiving</p><h1>Purchase received</h1><p className="admin-page-head__description">Record goods received against saved server purchase orders.</p></div><div className="po-head-actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={refresh}><RefreshCw size={15} /> Refresh</button>
      <button type="button" className="admin-button" disabled={loading || !!error || !canCreate || !!recovery.pending || !!recovery.error} onClick={() => navigate(`${BASE}/new${poId ? `?poId=${poId}` : ''}`)} data-testid="button-new-pr"><Plus size={16} /> New PR</button></div></div>
    {(recovery.pending || recovery.error) && <ReceiptRetryRecovery {...recovery} onResolved={(r) => { setRecovery({}); if (r) open(r); else refresh(); }} />}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    {poId && <div className="admin-feedback">Showing receipts for {source?.number || 'selected PO'} only. <button type="button" className="po-link" onClick={() => navigate(BASE)}>Show all receipts</button></div>}
    <div className="po-summary">
      <div className="po-summary__item po-summary__item--accent"><span>Active receipts</span><strong>{stats?.active ?? '—'}</strong><small>{stats?.deleted ?? '—'} deleted retained · full filtered scope, regardless of status</small></div>
      <div className="po-summary__item"><span>POs partially received</span><strong>{stats?.fulfillment?.['Partially Received'] ?? '—'}</strong><small>Linked POs · active acceptance</small></div>
      <div className="po-summary__item"><span>POs closed</span><strong>{stats?.fulfillment?.Closed ?? '—'}</strong><small>Linked POs · fully accepted</small></div>
      <div className="po-summary__item"><span>Lines with rejections</span><strong>{stats?.anyRejected ?? '—'}</strong><small>Full filtered scope, including deleted</small></div>
    </div>
    <section className="admin-panel">
      <div className="po-tabs" role="tablist">{[['receipts', ClipboardCheck, 'Receipts'], ['activity', Activity, 'Activity'], ['analytics', BarChart3, 'Analytics']].map(([key, Icon, name]) =>
        <button key={key} type="button" role="tab" aria-selected={tab === key} className="po-tab" onClick={() => { setTab(key); setPage(1); }}><Icon size={15} />{name}</button>)}</div>
      {tab === 'receipts' ? <>
        <div className="po-toolbar">
          <label className="admin-search"><Search size={16} /><span className="sr-only">Search receipts</span><input type="search" value={filters.search} onChange={(e) => change('search', e.target.value)} placeholder="Search PR, PO, vendor, receiver or product" /></label>
          <button type="button" className="admin-button admin-button--secondary po-filter-toggle" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} aria-controls="pr-filter-panel"><SlidersHorizontal size={15} /> Filters<ChevronDown size={15} /></button>
          <div className="pr-toolbar-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => { setFilters({ ...initial, status: poId ? 'all' : 'active' }); setPage(1); }}>Clear filters</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={busy || loading || !data?.filtered} onClick={csv}><FileDown size={15} /> CSV ({data?.filtered ?? 0})</button></div>
        </div>
        <div id="pr-filter-panel" className="po-toolbar po-filter-panel" hidden={!filtersOpen}>
          <div className="admin-filter"><label htmlFor="pr-from">From date</label><input id="pr-from" type="date" className="admin-select" value={filters.from} onChange={(e) => change('from', e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="pr-to">To date</label><input id="pr-to" type="date" className="admin-select" value={filters.to} onChange={(e) => change('to', e.target.value)} /></div>
          {select('pr-vendor', 'Vendor', filters.vendorId, (v) => change('vendorId', v), [['', 'All vendors'], ...options.vendors.map((r) => [r.id, r.name])])}
          {select('pr-by', 'Received by', filters.receivedBy, (v) => change('receivedBy', v), [['', 'Anyone'], ...options.receivers.map((r) => [r.id, r.name])])}
          {select('pr-ful', 'PO status', filters.fulfillment, (v) => change('fulfillment', v), [['', 'All'], ...['Open', 'Partially Received', 'Closed'].map((s) => [s, s])])}
          {select('pr-st', 'Record', filters.status, (v) => change('status', v), [['active', 'Active'], ['deleted', 'Deleted'], ['all', 'All']])}
          {select('pr-sort', 'Sort', filters.sort, (v) => change('sort', v), [['recent', 'Newest first'], ['oldest', 'Oldest first'], ['number', 'PR number']])}
        </div>
      </> : <div className="po-toolbar">
        {tab === 'activity' && <label className="admin-search"><Search size={16} /><span className="sr-only">Search activity</span><input type="search" value={searchActivity} onChange={(e) => { setSearchActivity(e.target.value); setPage(1); }} placeholder="Search PR, change or actor" /></label>}
        {select('pr-scope', 'Include', scope, (v) => { setScope(v); setPage(1); }, [['active', 'Active receipts'], ['all', 'Active and deleted receipts'], ['deleted', 'Deleted receipts only']])}
        <p>Full filtered server scope; date/vendor/receiver/search filters from Receipts remain applied. No product quantities are added together.</p>
      </div>}
      {error ? <div className="po-recovery" role="alert"><h2>Purchase received is unavailable</h2><p>{error} Existing records have not been changed.</p><button type="button" className="admin-button" onClick={refresh}>Try again</button></div>
        : loading ? <div className="po-skeleton" role="status" aria-label="Loading server receipts" />
        : tab === 'receipts' ? <>
          {data?.items.length ? <><div className="po-table"><DataTable columns={columns} rows={data.items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Purchase received" testIdPrefix="pr" /></div>
            <div className="po-mobile" role="list">{data.items.map((r) => <article className="po-card" key={r.id} role="listitem"><div className="po-card__top"><div><button type="button" className="po-link po-number" onClick={() => open(r)}>{r.number}</button><h2>{r.vendorName}</h2><p>{r.vendorPhone}</p></div><span className={fulfilClass(r.fulfillment)}>{r.fulfillment}</span></div>
              <dl><div><dt>Received</dt><dd>{date(r.receivedDate)}</dd></div><div><dt>PO</dt><dd>{r.poNumber}</dd></div><div><dt>Received by</dt><dd>{r.receivedBy}</dd></div><div><dt>Record</dt><dd>{r.status}</dd></div></dl>{actions(r)}</article>)}</div></>
            : <div className="admin-empty"><ClipboardCheck size={21} /><strong>No receipts to show</strong><p>Create a receipt against a saved server PO, or change the filters.</p></div>}{pagination}
        </> : tab === 'activity' ? <>
          <div className="po-activity">{data?.items.map((e) => <article className="po-event" key={e.id}><Activity size={14} /><div><button type="button" className="po-link" onClick={() => navigate(`${BASE}/${e.receiptId}`)}>{e.number}</button><strong> · {e.action}</strong><p>{e.summary}</p><p><strong>{e.actor}</strong> · authenticated saving actor · {timestamp(e.at)}</p></div></article>)}</div>
          {!data?.items.length && <div className="admin-empty">No receipt activity matches this scope.</div>}{pagination}
        </> : data && <div className="po-analytics"><h2>Receipt activity</h2><p>{data.scope}</p><div className="po-event-counts">{Object.entries(data.counts).map(([k, n]) => <div key={k}><strong>{n}</strong><span>{k} PRs</span></div>)}</div>
          <h2>Linked purchase orders</h2><div className="po-event-counts">{Object.entries(data.fulfillment).map(([k, n]) => <div key={k}><strong>{n}</strong><span>{k}</span></div>)}</div>
          <h2>Line outcomes</h2><div className="po-event-counts">{[['received lines', data.lines], ['lines with acceptance', data.acceptedAny], ['fully accepted lines', data.fullyAccepted], ['lines with rejection', data.anyRejected], ['all-rejected lines', data.allRejected], ['receipts in scope', data.receipts]].map(([k, n]) => <div key={k}><strong>{n}</strong><span>{k}</span></div>)}</div></div>}
    </section>
    {doc && <PRDocumentPreview document={doc} onClose={() => setDoc(null)} />}
  </div></AdminLayout>;
}
