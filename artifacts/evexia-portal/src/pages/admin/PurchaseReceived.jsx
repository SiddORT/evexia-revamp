import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Activity, ArrowUpRight, BarChart3, ChevronDown, ClipboardCheck, Download, Eye, FileDown, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import PRDocumentPreview from '../../components/admin/PRDocumentPreview.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { exportPRCSV, filterPRs, getPOFulfillment, guardedSeedSamplePRs, isSamplePR, loadPRSnapshot } from '../../services/purchaseReceived.js';
import { downloadPRDocument, makePRDocument } from '../../services/prDocuments.js';
import '../../purchaseOrders.css';
import '../../purchaseReceived.css';

const BASE = '/admin/inventory/purchase-received';
const displayDate = (d) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const stamp = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const initial = { search: '', from: '', to: '', vendorId: '', receivedBy: '', fulfillment: '', status: 'active', sort: 'recent' };
export const fulfilClass = (f) => f === 'Closed' ? 'pr-tag pr-tag--closed' : f === 'Open' ? 'pr-tag pr-tag--open' : 'pr-tag';

export default function PurchaseReceived() {
  const [, navigate] = useLocation();
  const scopedPoId = new URLSearchParams(useSearch()).get('poId') || '';
  const newPRPath = `${BASE}/new${scopedPoId ? `?poId=${encodeURIComponent(scopedPoId)}` : ''}`;
  const defaultFilters = () => ({ ...initial, status: scopedPoId ? 'all' : 'active' });
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('receipts');
  const [filters, setFilters] = useState(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [scopedPoId, filters.status !== 'all', filters.from, filters.to, filters.vendorId, filters.receivedBy, filters.fulfillment].filter(Boolean).length;
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState('');
  const [search2, setSearch2] = useState('');
  const [scope, setScope] = useState('active');

  function refresh() {
    try { setSnapshot(loadPRSnapshot()); setLoadError(''); setActionError(''); setNotice(''); }
    catch (cause) { setSnapshot(null); setLoadError(cause.message || 'Purchase received records could not be loaded.'); }
  }
  useEffect(() => { refresh(); }, []);
  const receipts = useMemo(() => (snapshot?.record.receipts || []).filter((receipt) => !scopedPoId || receipt.poId === scopedPoId), [snapshot, scopedPoId]);
  const events = useMemo(() => (snapshot?.record.events || []).filter((event) => !scopedPoId || receipts.some((receipt) => receipt.id === event.receiptId)), [snapshot, receipts, scopedPoId]);
  const emptyWorkspace = !scopedPoId && receipts.length === 0 && events.length === 0;
  const sampleReceipts = receipts.filter(isSamplePR);
  const poRecord = snapshot?.poRecord;
  const orderById = useMemo(() => new Map((poRecord?.orders || []).map((o) => [o.id, o])), [poRecord]);
  const scopedPO = scopedPoId ? orderById.get(scopedPoId) : null;
  const canCreate = !scopedPoId || (scopedPO?.status === 'open' && getPOFulfillment(scopedPO, receipts) !== 'Closed');
  const receiptById = useMemo(() => new Map(receipts.map((r) => [r.id, r])), [receipts]);
  const activeReceipts = receipts.filter((r) => r.status === 'active');
  const fulfil = (r) => { const po = orderById.get(r.poId); return po ? getPOFulfillment(po, activeReceipts) : '—'; };
  const visible = useMemo(() => snapshot ? filterPRs(receipts, poRecord, filters) : [], [snapshot, receipts, poRecord, filters]);
  const pagination = useTablePagination(visible);
  const statusOf = useMemo(() => new Map(receipts.map((r) => [r.id, r.status])), [receipts]);
  const inScope = (status) => scope === 'all' || status === scope;
  const filteredEvents = useMemo(() => [...events].reverse().filter((e) => inScope(statusOf.get(e.receiptId) || 'deleted')).filter((e) => !search2.trim() || [e.number, e.action, e.summary, e.actor].some((v) => String(v || '').toLocaleLowerCase().includes(search2.trim().toLocaleLowerCase()))), [events, search2, scope, statusOf]);
  const eventPages = useTablePagination(filteredEvents);
  useEffect(() => {
    setFilters({ ...initial, status: scopedPoId ? 'all' : 'active' });
    setSearch2('');
    setScope(scopedPoId ? 'all' : 'active');
    pagination.resetPage();
    eventPages.resetPage();
  }, [scopedPoId]);
  const vendors = [...new Map(receipts.map((r) => [r.vendorId, r.vendorName])).entries()];
  const receivers = [...new Set(receipts.map((r) => r.receivedBy))];
  const scoped = receipts.filter((r) => inScope(r.status));
  const scopedEvents = events.filter((e) => inScope(statusOf.get(e.receiptId) || 'deleted'));
  const scopeLabel = { active: 'active receipts only', all: 'all receipts including deleted', deleted: 'deleted receipts only' }[scope];
  const linkedPOs = [...new Set(scoped.map((r) => r.poId))].map((id) => orderById.get(id)).filter(Boolean);
  const counts = { Open: 0, 'Partially Received': 0, Closed: 0 };
  linkedPOs.forEach((po) => { counts[getPOFulfillment(po, activeReceipts)] += 1; });
  const allLines = activeReceipts.flatMap((r) => r.lines);
  const rejectedLines = allLines.filter((l) => Number(l.rejectedQty) > 0).length;
  const sLines = scoped.flatMap((r) => r.lines);
  const acceptedAny = sLines.filter((l) => Number(l.acceptedQty) > 0).length;
  const fullyAccepted = sLines.filter((l) => Number(l.acceptedQty) > 0 && Number(l.rejectedQty) === 0).length;
  const anyRejected = sLines.filter((l) => Number(l.rejectedQty) > 0).length;
  const allRejected = sLines.filter((l) => Number(l.receivedQty) > 0 && Number(l.acceptedQty) === 0).length;
  const scopeSelect = <div className="admin-filter"><label htmlFor="pr-scope">Include</label><select id="pr-scope" className="admin-select" value={scope} onChange={(e) => { setScope(e.target.value); eventPages.resetPage(); }} data-testid="select-pr-scope"><option value="active">Active receipts</option><option value="all">Active and deleted receipts</option><option value="deleted">Deleted receipts only</option></select></div>;

  function change(key, value) { setFilters((f) => ({ ...f, [key]: value })); pagination.resetPage(); }
  function exportCsv() {
    try {
      const blob = new Blob([exportPRCSV(visible, poRecord)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'purchase-received.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (cause) { setActionError(cause.message || 'Could not export CSV.'); }
  }
  async function loadSamples() {
    if (busy) return;
    setBusy('samples');
    setActionError('');
    setNotice('');
    try {
      const next = await guardedSeedSamplePRs(snapshot);
      setSnapshot(next);
      setFilters(initial);
      pagination.resetPage();
      setNotice('Five sample receipts added in this browser.');
    } catch (cause) {
      setActionError(cause.message || 'Could not load sample receipts. Refresh records and try again.');
    } finally {
      setBusy('');
    }
  }
  function preview(r) { setActionError(''); try { setDoc(makePRDocument(r)); } catch (cause) { setActionError(cause.message || 'Could not preview this receipt.'); } }
  async function pdf(r) {
    if (busy) return; setBusy(r.id); setActionError('');
    try { await downloadPRDocument(makePRDocument(r), `${r.number}.pdf`, `${import.meta.env.BASE_URL}images/evexia-logo.png`); }
    catch (cause) { setActionError(cause.message || 'Could not download this receipt.'); }
    finally { setBusy(''); }
  }
  const open = (r) => navigate(`${BASE}/${encodeURIComponent(r.id)}`);
  const actions = (r) => <div className="po-actions">
    <button type="button" className="po-action po-action--icon" title="View" aria-label={`View ${r.number}`} onClick={() => open(r)} data-testid={`button-view-pr-${r.id}`}><ArrowUpRight size={15} /></button>
    <button type="button" className="po-action po-action--icon" title="Preview receipt" aria-label={`Preview ${r.number}`} onClick={() => preview(r)} data-testid={`button-preview-pr-${r.id}`}><Eye size={15} /></button>
    <button type="button" className="po-action po-action--icon" title="Download PDF" aria-label={`Download PDF for ${r.number}`} disabled={!!busy} onClick={() => pdf(r)} data-testid={`button-pdf-pr-${r.id}`}><Download size={15} /></button>
  </div>;
  const statusTag = (r) => <>{isSamplePR(r) && <span className="pr-sample-badge">Sample</span>} {r.status === 'deleted' && <span className="po-status po-status--draft">deleted</span>}</>;
  const columns = [
    { key: 's', label: 'Sr. No.', render: (_r, i) => i + 1 },
    { key: 'n', label: 'PR Number', render: (r) => <><button type="button" className="po-link po-number" onClick={() => open(r)} data-testid={`link-pr-${r.id}`}>{r.number}</button> {statusTag(r)}</> },
    { key: 'd', label: 'PR Date', render: (r) => displayDate(r.receivedDate) },
    { key: 'p', label: 'PO Number', render: (r) => <button type="button" className="po-link" onClick={() => navigate(`/admin/inventory/purchase-orders/${encodeURIComponent(r.poId)}`)}>{r.poNumber}</button> },
    { key: 'f', label: 'PO Status', render: (r) => <span className={fulfilClass(fulfil(r))}>{fulfil(r)}</span> },
    { key: 'b', label: 'Received By', render: (r) => r.receivedBy },
    { key: 'v', label: 'Vendor Details', render: (r) => <><strong>{r.vendorName}</strong><span className="po-secondary">{r.vendorPhone || 'No mobile on record'}</span></> },
    { key: 'a', label: 'Actions', render: actions },
  ];
  const tabs = [['receipts', ClipboardCheck, 'Receipts'], ['activity', Activity, 'Activity'], ['analytics', BarChart3, 'Analytics']];

  return <AdminLayout title="Purchase Received"><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Receiving</p><h1>Purchase received</h1><p className="admin-page-head__description">Record goods received against saved purchase orders in this browser.</p></div><div className="po-head-actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-pr"><RefreshCw size={15} /> Refresh</button>
      <button type="button" className="admin-button" disabled={!snapshot || !canCreate} title={!canCreate ? 'This PO is deleted, unavailable or fully received.' : 'Create a receipt'} onClick={() => navigate(newPRPath)} data-testid="button-new-pr"><Plus size={16} /> New PR</button></div></div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-pr-feedback">{notice}</div>}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert">{actionError} <button type="button" className="po-link" onClick={refresh} data-testid="button-refresh-pr-error">Refresh records</button></div>}
    {snapshot && scopedPoId && <div className="admin-feedback" role={scopedPO ? 'status' : 'alert'}>
      {scopedPO ? <>Showing receipts linked to <strong>{scopedPO.number}</strong> only.</> : 'The purchase order in this link was not found in this browser.'}
      {' '}<button type="button" className="po-link" onClick={() => navigate(BASE)} data-testid="button-clear-pr-po-scope">Show all receipts</button>
      {scopedPO && <> · <button type="button" className="po-link" onClick={() => navigate(`/admin/inventory/purchase-orders/${encodeURIComponent(scopedPoId)}`)}>View PO</button></>}
    </div>}
    {loadError ? <section className="admin-panel po-recovery" role="alert"><h2>Purchase received is unavailable</h2><p>{loadError} Existing records have not been changed.</p><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-pr">Try again</button></section>
    : !snapshot ? <section className="admin-panel" aria-label="Loading"><div className="po-skeleton" /><div className="po-skeleton" /><div className="po-skeleton" /></section> : <>
       {sampleReceipts.length > 0 && <div className="admin-feedback pr-sample-note" role="note">
         Sample receipts are fictional browser-local records. They count in activity and analytics and affect fulfillment on their sample purchase orders. An active sample receipt prevents editing or deleting its source PO. No inventory or vendor records are updated.
       </div>}
      <div className="po-summary">
        <div className="po-summary__item po-summary__item--accent"><span>Active receipts</span><strong data-testid="text-pr-active">{activeReceipts.length}</strong><small>{receipts.length - activeReceipts.length} deleted retained</small></div>
        <div className="po-summary__item"><span>POs partially received</span><strong>{counts['Partially Received']}</strong><small>Outstanding accepted quantity</small></div>
        <div className="po-summary__item"><span>POs closed</span><strong>{counts.Closed}</strong><small>Fully accepted</small></div>
        <div className="po-summary__item"><span>Lines with rejections</span><strong>{rejectedLines}</strong><small>Of {allLines.length} received lines</small></div>
      </div>
      <section className="admin-panel">
        <div className="po-tabs" role="tablist">{tabs.map(([k, Icon, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className="po-tab" onClick={() => { setTab(k); setSearch2(''); }} data-testid={`tab-pr-${k}`}><Icon size={15} />{l}</button>)}</div>
        {tab === 'receipts' && <div role="tabpanel">
          <div className="po-toolbar">
            <label className="admin-search"><Search size={16} /><span className="sr-only">Search receipts</span><input type="search" value={filters.search} onChange={(e) => change('search', e.target.value)} placeholder="Search PR, PO, vendor, receiver or product" data-testid="input-search-pr" /></label>
            <button type="button" className="admin-button admin-button--secondary po-filter-toggle" onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen} aria-controls="pr-filter-panel" data-testid="button-toggle-pr-filters">
              <SlidersHorizontal size={15} aria-hidden="true" /> Filters
              {activeFilterCount > 0 && <span className="po-filter-toggle__count" aria-label={`${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`}>{activeFilterCount}</span>}
              <ChevronDown size={15} className="po-filter-toggle__chevron" aria-hidden="true" />
            </button>
            <div className="pr-toolbar-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => { setFilters(defaultFilters()); pagination.resetPage(); }} data-testid="button-clear-pr-filters">Clear filters</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={!visible.length} onClick={exportCsv} data-testid="button-export-pr"><FileDown size={15} /> CSV ({visible.length})</button></div>
          </div>
          <div id="pr-filter-panel" className="po-toolbar po-filter-panel" hidden={!filtersOpen} role="region" aria-label="Purchase received filters">
            <div className="admin-filter"><label htmlFor="pr-from">From date</label><input id="pr-from" type="date" className="admin-select" value={filters.from} onChange={(e) => change('from', e.target.value)} data-testid="input-pr-from" /></div>
            <div className="admin-filter"><label htmlFor="pr-to">To date</label><input id="pr-to" type="date" className="admin-select" value={filters.to} onChange={(e) => change('to', e.target.value)} data-testid="input-pr-to" /></div>
            <div className="admin-filter"><label htmlFor="pr-vendor">Vendor</label><select id="pr-vendor" className="admin-select" value={filters.vendorId} onChange={(e) => change('vendorId', e.target.value)} data-testid="select-pr-vendor"><option value="">All vendors</option>{vendors.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
            <div className="admin-filter"><label htmlFor="pr-by">Received by</label><select id="pr-by" className="admin-select" value={filters.receivedBy} onChange={(e) => change('receivedBy', e.target.value)} data-testid="select-pr-receiver"><option value="">Anyone</option>{receivers.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
            <div className="admin-filter"><label htmlFor="pr-ful">PO status</label><select id="pr-ful" className="admin-select" value={filters.fulfillment} onChange={(e) => change('fulfillment', e.target.value)} data-testid="select-pr-fulfillment"><option value="">All</option><option>Open</option><option>Partially Received</option><option>Closed</option></select></div>
            <div className="admin-filter"><label htmlFor="pr-st">Record</label><select id="pr-st" className="admin-select" value={filters.status} onChange={(e) => change('status', e.target.value)} data-testid="select-pr-status"><option value="active">Active</option><option value="deleted">Deleted</option><option value="all">All</option></select></div>
            <div className="admin-filter"><label htmlFor="pr-sort">Sort</label><select id="pr-sort" className="admin-select" value={filters.sort} onChange={(e) => change('sort', e.target.value)} data-testid="select-pr-sort"><option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="number">PR number</option></select></div>
          </div>
          {visible.length ? <><div className="po-table"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(r) => r.id} label="Purchase received" testIdPrefix="pr" /></div>
            <div className="po-mobile" role="list">{pagination.pageRows.map((r, i) => <article className="po-card" key={r.id} role="listitem"><div className="po-card__top"><div><span className="po-secondary">Sr. No. {pagination.startIndex + i + 1}</span><button type="button" className="po-link po-number" onClick={() => open(r)}>{r.number}</button> {isSamplePR(r) && <span className="pr-sample-badge">Sample</span>}<h2>{r.vendorName}</h2><p>{r.vendorPhone || 'No mobile on record'}</p></div><span className={fulfilClass(fulfil(r))}>{fulfil(r)}</span></div>
              <dl><div><dt>PR date</dt><dd>{displayDate(r.receivedDate)}</dd></div><div><dt>PO</dt><dd><button type="button" className="po-link" onClick={() => navigate(`/admin/inventory/purchase-orders/${encodeURIComponent(r.poId)}`)} data-testid={`link-po-mobile-${r.id}`}>{r.poNumber}</button></dd></div><div><dt>Received by</dt><dd>{r.receivedBy}</dd></div><div><dt>Record</dt><dd>{r.status}</dd></div></dl>{actions(r)}</article>)}</div></>
           : emptyWorkspace
             ? <div className="admin-empty pr-sample-empty"><span className="admin-empty__icon"><ClipboardCheck size={21} /></span><strong>No purchase receipts yet</strong><p>Load fictional sample receipts to explore the receiving workspace, or create a receipt against a saved purchase order.</p>
               <div className="po-actions pr-sample-empty__actions"><button type="button" className="admin-button" disabled={busy === 'samples'} onClick={loadSamples} data-testid="button-sample-purchase-received">{busy === 'samples' ? 'Loading samples…' : 'Load sample receipts'}</button><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(`${BASE}/new`)}>Create PR</button></div>
               <p className="pr-sample-empty__requirements">Loading requires the four original open sample purchase orders to be present and unmodified. If they are unavailable, go to <button type="button" className="po-link" onClick={() => navigate('/admin/inventory/purchase-orders')}>Purchase Orders</button> and choose <strong>Load sample orders</strong> first. Existing records are never reset.</p>
             </div>
              : <div className="admin-empty"><span className="admin-empty__icon"><ClipboardCheck size={21} /></span><strong>{receipts.length ? 'No receipts match these filters' : scopedPoId ? 'No receipts for this PO yet' : 'No purchase receipts yet'}</strong><p>{receipts.length ? 'Change the filters or search to see more.' : scopedPoId ? 'Receipts linked to this purchase order will appear here.' : 'Create a receipt against a saved purchase order.'}</p>{!receipts.length && canCreate && <button type="button" className="admin-button" style={{ marginTop: 14 }} onClick={() => navigate(newPRPath)}>Create PR</button>}</div>}
          <TablePagination {...pagination} filtered={visible.length} total={receipts.length} label={visible.length === 1 ? 'receipt' : 'receipts'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-pr-count" />
        </div>}
         {tab === 'activity' && <div role="tabpanel"><div className="po-toolbar"><label className="admin-search"><Search size={16} /><span className="sr-only">Search activity</span><input type="search" value={search2} onChange={(e) => { setSearch2(e.target.value); eventPages.resetPage(); }} placeholder="Search PR, change or actor" data-testid="input-search-pr-activity" /></label>{scopeSelect}</div>
           {filteredEvents.length ? <div className="po-activity">{eventPages.pageRows.map((e) => <article className="po-event" key={e.id}><div className="po-event__mark"><Activity size={14} /></div><div><button type="button" className="po-link" onClick={() => navigate(`${BASE}/${encodeURIComponent(e.receiptId)}`)}>{e.number}</button> {isSamplePR(receiptById.get(e.receiptId)) && <span className="pr-sample-badge">Sample</span>} <strong>· {e.action}</strong><p>{e.summary}</p><p className="po-event__attribution"><strong>{e.actor || 'Demo Admin'}</strong> (local demo) · <time dateTime={e.at}>{stamp(e.at)}</time></p></div></article>)}</div>
            : <div className="admin-empty"><span className="admin-empty__icon"><Activity size={21} /></span><strong>No activity to show</strong><p>{scopedEvents.length ? 'Try a different search.' : 'Receipt changes appear here once saved.'}</p></div>}
          <TablePagination {...eventPages} filtered={filteredEvents.length} total={scopedEvents.length} label="events" onPageChange={eventPages.setPage} onPageSizeChange={eventPages.setPageSize} testId="text-pr-activity-count" /></div>}
        {tab === 'analytics' && <div className="po-analytics" role="tabpanel"><div className="po-toolbar" style={{ padding: '0 0 16px' }}>{scopeSelect}</div><h2>Receipt activity</h2><p>Scope: {scopeLabel}. Counts of changes saved in this browser by a local demo actor. Quantities are not summed across products or units.</p>
          <div className="po-event-counts">{['created', 'updated', 'deleted'].map((a) => <div key={a}><strong>{scopedEvents.filter((e) => e.action === a).length}</strong><span>{a} PRs</span></div>)}</div>
          <h2>Linked purchase orders</h2><p>POs linked to {scopeLabel}. Fulfillment always counts active receipts only, so a PO whose receipts are all deleted shows as Open.</p>
          <div className="po-event-counts">{Object.entries(counts).map(([k, v]) => <div key={k}><strong>{v}</strong><span>{k}</span></div>)}<div><strong>{sLines.length}</strong><span>received lines</span></div></div>
          <h2>Line outcomes</h2><div className="po-event-counts"><div><strong>{acceptedAny}</strong><span>lines with any accepted qty</span></div><div><strong>{fullyAccepted}</strong><span>fully accepted lines</span></div><div><strong>{anyRejected}</strong><span>lines with any rejection</span></div><div><strong>{allRejected}</strong><span>all-rejected lines</span></div><div><strong>{scoped.length}</strong><span>receipts in scope</span></div></div></div>}
      </section></>}
    {doc && <PRDocumentPreview document={doc} onClose={() => setDoc(null)} />}
  </div></AdminLayout>;
}
