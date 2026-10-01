import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Activity, ArrowUpRight, BarChart3, ChevronDown, ClipboardList, Download, Eye, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import PurchaseOrderEventMeta from '../../components/admin/PurchaseOrderEventMeta.jsx';
import POInvoicePreview from '../../components/admin/POInvoicePreview.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { deletePO, filterPOs, loadPOSnapshot, money, poEventActor, seedSamplePOs } from '../../services/purchaseOrders.js';
import { makePOInvoiceDocument } from '../../services/poInvoiceTemplates.js';
import { downloadInvoiceDocument } from '../../services/poInvoicePdf.js';
import '../../purchaseOrders.css';

const BASE = '/admin/inventory/purchase-orders';
const displayDate = (date) => date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

export default function PurchaseOrders() {
  const [, navigate] = useLocation();
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [tab, setTab] = useState('orders');
  const [invoiceDocument, setInvoiceDocument] = useState(null);
  const [downloading, setDownloading] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: 'open', vendorId: '', productId: '', from: '', to: '', sort: 'recent' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [filters.status !== 'all', filters.vendorId, filters.productId, filters.from, filters.to].filter(Boolean).length;

  function refresh() {
    try { setSnapshot(loadPOSnapshot()); setLoadError(''); setActionError(''); setConfirming(null); }
    catch (cause) { setSnapshot(null); setLoadError(cause.message || 'Purchase orders could not be loaded.'); }
  }
  useEffect(() => { refresh(); }, []);
  const record = snapshot?.record;
  const orders = record?.orders || [];
  const events = record?.events || [];
  const open = orders.filter((order) => order.status === 'open');
  const visible = useMemo(() => filterPOs(orders, filters).filter((order) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || [order.number, order.vendorName, order.locationName, ...order.lines.map((line) => line.productName)].some((value) => value.toLocaleLowerCase().includes(query));
  }), [orders, filters, search]);
  const pagination = useTablePagination(visible);
  const filteredEvents = useMemo(() => [...events].reverse().filter((event) => !search.trim() || [event.number, event.action, event.summary, poEventActor(event)].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [events, search]);
  const eventPages = useTablePagination(filteredEvents);
  const vendorTotals = useMemo(() => {
    const grouped = new Map();
    open.forEach((order) => grouped.set(order.vendorId, { id: order.vendorId, name: order.vendorName, amount: (grouped.get(order.vendorId)?.amount || 0) + order.total, count: (grouped.get(order.vendorId)?.count || 0) + 1 }));
    return [...grouped.values()].sort((a, b) => b.amount - a.amount);
  }, [orders]);
  function changeFilter(key, value) { setFilters((current) => ({ ...current, [key]: value })); pagination.resetPage(); }
  function clearFilters() { setSearch(''); setFilters({ status: 'open', vendorId: '', productId: '', from: '', to: '', sort: 'recent' }); pagination.resetPage(); }
  function remove() {
    if (!confirming || !snapshot) return;
    try {
      const next = deletePO(snapshot, confirming.id);
      setSnapshot({ ...snapshot, record: next });
      setConfirming(null);
      setActionError('');
      setNotice(`${confirming.number} deleted. Its activity remains available in this browser.`);
    } catch (cause) { setActionError(cause.message || 'Could not delete this purchase order. Refresh and try again.'); }
  }
  function loadSamples() {
    try {
      const next = seedSamplePOs(snapshot);
      setSnapshot({ ...snapshot, record: next });
      setNotice('Five sample purchase orders added in this browser.');
      setActionError('');
    } catch (cause) { setActionError(cause.message || 'Could not load sample purchase orders. Refresh and try again.'); }
  }
  function previewInvoice(order) {
    setActionError('');
    try { setInvoiceDocument(makePOInvoiceDocument(order, snapshot.refs)); }
    catch (cause) { setActionError(cause.message || 'Could not preview this PO invoice. Refresh and try again.'); }
  }
  async function downloadInvoice(order) {
    setActionError('');
    setDownloading(order.id);
    try {
      const document = makePOInvoiceDocument(order, snapshot.refs);
      await downloadInvoiceDocument(document, `${order.number}.pdf`, `${import.meta.env.BASE_URL}images/evexia-logo.png`);
    } catch (cause) { setActionError(cause.message || 'Could not download this PO invoice. Please try again.'); }
    finally { setDownloading(''); }
  }
  const actionButtons = (order) => <div className="po-actions">
    <button type="button" className="po-action po-action--icon" onClick={() => navigate(`${BASE}/${encodeURIComponent(order.id)}`)} title="View purchase order" aria-label={`View ${order.number}`} data-testid={`button-view-po-${order.id}`}><ArrowUpRight size={15} aria-hidden="true" /></button>
    <button type="button" className="po-action po-action--icon" onClick={() => previewInvoice(order)} title="Preview PO invoice" aria-label={`Preview invoice for ${order.number}`} data-testid={`button-preview-invoice-${order.id}`}><Eye size={15} aria-hidden="true" /></button>
    <button type="button" className="po-action po-action--icon" onClick={() => downloadInvoice(order)} disabled={!!downloading} title={downloading === order.id ? 'Preparing PDF…' : 'Download PO invoice PDF'} aria-label={`Download invoice for ${order.number}`} data-testid={`button-download-invoice-${order.id}`}><Download size={15} aria-hidden="true" /></button>
    {order.status === 'open' && <button type="button" className="po-action po-action--icon po-action--danger" onClick={() => { setActionError(''); setConfirming(order); }} title="Delete purchase order" aria-label={`Delete ${order.number}`} data-testid={`button-delete-po-${order.id}`}><Trash2 size={15} aria-hidden="true" /></button>}
  </div>;
  const columns = [
    { key: 'serial', label: 'Sr. no.', render: (_order, index) => index + 1 },
    { key: 'number', label: 'Purchase order', render: (order) => <><button type="button" className="po-link po-number" onClick={() => navigate(`${BASE}/${encodeURIComponent(order.id)}`)} data-testid={`link-po-${order.id}`}>{order.number}</button><span className="po-secondary">{order.lines.length} {order.lines.length === 1 ? 'item' : 'items'}</span></> },
    { key: 'vendor', label: 'Vendor', render: (order) => <strong>{order.vendorName}</strong> },
    { key: 'location', label: 'Deliver to', render: (order) => order.locationName },
    { key: 'date', label: 'PO date', render: (order) => displayDate(order.poDate) },
    { key: 'expected', label: 'Expected', render: (order) => displayDate(order.expectedDate) },
    { key: 'amount', label: 'Total incl. GST', render: (order) => <span className="po-amount" data-testid={`text-po-total-${order.id}`}>{money(order.total)}</span> },
    { key: 'status', label: 'Status', render: (order) => <span className={`po-status${order.status === 'deleted' ? ' po-status--draft' : ''}`}>{order.status}</span> },
    { key: 'actions', label: 'Actions', render: actionButtons },
  ];

  return <AdminLayout title="Purchase Orders"><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Procurement</p><h1>Purchase orders</h1><p className="admin-page-head__description">Plan supplier purchases, track order value and review local changes.</p></div><div className="po-head-actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-purchase-orders"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
      <button type="button" className="admin-button" disabled={!snapshot} onClick={() => navigate(`${BASE}/new`)} data-testid="button-new-purchase-order"><Plus size={16} aria-hidden="true" /> New purchase order</button>
    </div></div>
    {new URLSearchParams(window.location.search).has('saved') && !notice && <div className="admin-feedback" role="status">Purchase order saved in this browser.</div>}
    {notice && <div className="admin-feedback" role="status" data-testid="status-po-feedback">{notice}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError} <button type="button" className="po-link" onClick={refresh}>Refresh records</button></div>}
    {loadError ? <section className="admin-panel po-recovery" role="alert"><h2>Purchase orders are unavailable</h2><p>{loadError}</p><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-purchase-orders">Try again</button></section> : !snapshot ? <section className="admin-panel" aria-label="Loading purchase orders"><div className="po-skeleton" /><div className="po-skeleton" /><div className="po-skeleton" /></section> : <>
      {orders.some((order) => order.id.startsWith('sample-po-')) && <div className="admin-feedback" role="note">Sample purchase orders are for preview only. They are saved in this browser and can be edited or deleted. Activity and analytics include these samples.</div>}
      <div className="po-summary" aria-label="Purchase order overview">
        <div className="po-summary__item po-summary__item--accent"><span>Open order value</span><strong data-testid="text-po-open-value">{money(open.reduce((sum, order) => sum + order.total, 0))}</strong><small>Including GST</small></div>
        <div className="po-summary__item"><span>Open orders</span><strong data-testid="text-po-open-count">{open.length}</strong><small>Across {new Set(open.map((order) => order.vendorId)).size} vendors</small></div>
        <div className="po-summary__item"><span>Product lines</span><strong>{open.reduce((sum, order) => sum + order.lines.length, 0)}</strong><small>On active orders</small></div>
        <div className="po-summary__item"><span>Changes recorded</span><strong>{events.length}</strong><small>Creates, edits and deletions</small></div>
      </div>
      <section className="admin-panel" aria-label="Purchase order workspace">
        <div className="po-tabs" role="tablist" aria-label="Purchase order views">
          {[['orders', ClipboardList, 'Orders'], ['activity', Activity, 'Activity'], ['analytics', BarChart3, 'Analytics']].map(([key, Icon, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className="po-tab" onClick={() => { setTab(key); setSearch(''); }} data-testid={`tab-po-${key}`}><Icon size={15} aria-hidden="true" />{label}</button>)}
        </div>
        {tab === 'orders' && <div role="tabpanel">
          <div className="po-toolbar">
            <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search purchase orders</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search PO, vendor, location or product" data-testid="input-search-purchase-orders" /></label>
            <button type="button" className="admin-button admin-button--secondary po-filter-toggle" onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen} aria-controls="po-filter-panel" data-testid="button-toggle-po-filters">
              <SlidersHorizontal size={15} aria-hidden="true" /> Filters
              {activeFilterCount > 0 && <span className="po-filter-toggle__count" aria-label={`${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`}>{activeFilterCount}</span>}
              <ChevronDown size={15} className="po-filter-toggle__chevron" aria-hidden="true" />
            </button>
            <button type="button" className="admin-button admin-button--secondary" onClick={clearFilters} data-testid="button-clear-po-filters">Clear filters</button>
          </div>
          <div id="po-filter-panel" className="po-toolbar po-filter-panel" hidden={!filtersOpen} role="region" aria-label="Purchase order filters">
            <div className="admin-filter"><label htmlFor="po-status">Status</label><select id="po-status" className="admin-select" value={filters.status} onChange={(event) => changeFilter('status', event.target.value)} data-testid="select-po-status"><option value="open">Open</option><option value="deleted">Deleted</option><option value="all">All statuses</option></select></div>
            <div className="admin-filter"><label htmlFor="po-vendor">Vendor</label><select id="po-vendor" className="admin-select" value={filters.vendorId} onChange={(event) => changeFilter('vendorId', event.target.value)} data-testid="select-po-vendor"><option value="">All vendors</option>{[...new Map(orders.map((order) => [order.vendorId, order.vendorName])).entries()].map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}</select></div>
            <div className="admin-filter"><label htmlFor="po-product">Product</label><select id="po-product" className="admin-select" value={filters.productId} onChange={(event) => changeFilter('productId', event.target.value)} data-testid="select-po-product"><option value="">All products</option>{[...new Map(orders.flatMap((order) => order.lines.map((line) => [line.productId, line.productName]))).entries()].map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}</select></div>
            <div className="admin-filter"><label htmlFor="po-from">From PO date</label><input id="po-from" className="admin-select" type="date" value={filters.from} onChange={(event) => changeFilter('from', event.target.value)} data-testid="input-po-from" /></div>
            <div className="admin-filter"><label htmlFor="po-to">To PO date</label><input id="po-to" className="admin-select" type="date" value={filters.to} onChange={(event) => changeFilter('to', event.target.value)} data-testid="input-po-to" /></div>
            <div className="admin-filter"><label htmlFor="po-sort">Sort</label><select id="po-sort" className="admin-select" value={filters.sort} onChange={(event) => changeFilter('sort', event.target.value)} data-testid="select-po-sort"><option value="recent">Newest PO date</option><option value="oldest">Oldest PO date</option></select></div>
          </div>
          {visible.length ? <><div className="po-table"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(order) => order.id} label="Purchase orders" testIdPrefix="po" /></div><div className="po-mobile" role="list" aria-label="Purchase orders">{pagination.pageRows.map((order, index) => <article className="po-card" key={order.id} role="listitem"><div className="po-card__top"><div><span className="po-secondary">Sr. no. {pagination.startIndex + index + 1}</span><button type="button" className="po-link po-number" onClick={() => navigate(`${BASE}/${encodeURIComponent(order.id)}`)}>{order.number}</button><h2>{order.vendorName}</h2><p>{order.locationName}</p></div><span className={`po-status${order.status === 'deleted' ? ' po-status--draft' : ''}`}>{order.status}</span></div><dl><div><dt>PO date</dt><dd>{displayDate(order.poDate)}</dd></div><div><dt>Expected</dt><dd>{displayDate(order.expectedDate)}</dd></div><div><dt>Items</dt><dd>{order.lines.length}</dd></div><div><dt>Total incl. GST</dt><dd className="po-amount">{money(order.total)}</dd></div></dl>{actionButtons(order)}</article>)}</div></> : <div className="admin-empty"><span className="admin-empty__icon"><ClipboardList size={21} aria-hidden="true" /></span><strong>{orders.length ? 'No orders match these filters' : 'No purchase orders yet'}</strong><p>{orders.length ? 'Change the filters or search to see more orders.' : 'Create your first order to start a browser-local procurement record.'}</p>{!orders.length && <div className="po-actions" style={{ marginTop: 17 }}><button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)}>Create purchase order</button><button type="button" className="admin-button admin-button--secondary" onClick={loadSamples} data-testid="button-sample-purchase-orders">Load sample orders</button></div>}</div>}
          <TablePagination {...pagination} filtered={visible.length} total={orders.length} label={visible.length === 1 ? 'order' : 'orders'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-po-count" />
        </div>}
        {tab === 'activity' && <div role="tabpanel"><div className="po-toolbar"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search order activity</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); eventPages.resetPage(); }} placeholder="Search PO, change or actor" data-testid="input-search-po-activity" /></label></div>{filteredEvents.length ? <div className="po-activity">{eventPages.pageRows.map((event) => <article className="po-event" key={event.id}><div className="po-event__mark"><Activity size={14} aria-hidden="true" /></div><div><button type="button" className="po-link" onClick={() => navigate(`${BASE}/${encodeURIComponent(event.orderId)}`)}>{event.number}</button> <strong>· {event.action}</strong><p>{event.summary}</p><PurchaseOrderEventMeta event={event} /></div></article>)}</div> : <div className="admin-empty"><span className="admin-empty__icon"><Activity size={21} /></span><strong>No activity to show</strong><p>{events.length ? 'Try a different search.' : 'Order changes will appear here after your first purchase order.'}</p></div>}<TablePagination {...eventPages} filtered={filteredEvents.length} total={events.length} label={filteredEvents.length === 1 ? 'event' : 'events'} onPageChange={eventPages.setPage} onPageSizeChange={eventPages.setPageSize} testId="text-po-activity-count" /></div>}
        {tab === 'analytics' && <div className="po-analytics" role="tabpanel"><h2>Local purchase order activity</h2><p>Counts reflect successful changes saved in this browser, not authenticated users or a tamper-proof audit log.</p><div className="po-event-counts">{['created', 'updated', 'deleted'].map((action) => <div key={action}><strong>{events.filter((event) => event.action === action).length}</strong><span>{action} POs</span></div>)}</div><h2>Open value by vendor</h2><p>Totals include GST and exclude deleted orders. Based on the records saved in this browser.</p>{vendorTotals.length ? <div className="po-bars">{vendorTotals.map((vendor) => <div className="po-bar" key={vendor.id}><div className="po-bar__label"><strong>{vendor.name} <span className="po-secondary">{vendor.count} {vendor.count === 1 ? 'order' : 'orders'}</span></strong><strong>{money(vendor.amount)}</strong></div><div className="po-bar__track"><div className="po-bar__fill" style={{ width: `${vendorTotals[0].amount ? vendor.amount / vendorTotals[0].amount * 100 : 0}%` }} /></div></div>)}</div> : <div className="admin-empty"><span className="admin-empty__icon"><BarChart3 size={21} /></span><strong>Nothing to compare yet</strong><p>Vendor totals will appear after an order is created.</p></div>}</div>}
      </section>
    </>}
    {confirming && <ConfirmationDialog title={`Delete ${confirming.number}?`} description="This will remove the order from open totals. Its details and change history remain available in this browser." actionLabel="Delete purchase order" destructive onConfirm={remove} onClose={() => { setConfirming(null); setActionError(''); }} error={actionError} />}
    {invoiceDocument && <POInvoicePreview document={invoiceDocument} onClose={() => setInvoiceDocument(null)} />}
  </div></AdminLayout>;
}