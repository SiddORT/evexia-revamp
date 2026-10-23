import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, BarChart3, ChevronDown, ClipboardCheck, ClipboardList, Plus, RefreshCw, Search, SlidersHorizontal, Eye, Pencil, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ProcurementDocumentActions from '../../components/admin/ProcurementDocumentActions.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import PurchaseOrderReferenceSelect from '../../components/admin/PurchaseOrderReferenceSelect.jsx';
import PurchaseOrderDeleteDialog from '../../components/admin/PurchaseOrderDeleteDialog.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import {
  describeError, formatPaise, getPurchaseOrderAnalytics, getPurchaseOrderOverview, isPermissionError, listPurchaseOrderActivity,
  consumeSaved, listPurchaseOrders, validDate, getPurchaseOrder, pendingPurchaseOrderDeletions,
} from '../../services/serverPurchaseOrders.js';
import '../../purchaseOrders.css';

const BASE = '/admin/inventory/purchase-orders';
const DEFAULT_FILTERS = { status: 'open', vendor: null, product: null, from: '', to: '', sort: 'recent' };
const actorName = (actor) => typeof actor === 'string' ? actor : actor?.name || actor?.username || actor?.email || actor?.id || 'Unknown actor';
const ACTION_LABEL = { created: 'Created by', updated: 'Updated by', deleted: 'Deleted by' };
const idle = { status: 'loading', data: null, error: '', permission: false };

/** Loads server data, ignoring responses from superseded requests. */
function useServerData(fetcher, deps, enabled = true) {
  const [state, setState] = useState(idle);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => {
    if (!enabled) { setState(idle); return undefined; }
    const controller = new AbortController();
    const request = ++seq.current;
    setState(idle); // never show rows from a previous query, filter or error
    fetchRef.current(controller.signal).then((data) => {
      if (request === seq.current) setState({ status: 'ready', data, error: '', permission: false });
    }).catch((error) => {
      if (request !== seq.current || error?.name === 'AbortError') return;
      setState({ status: 'error', data: null, error: describeError(error, 'This data could not be loaded.'), permission: isPermissionError(error) });
    });
    return () => { seq.current += 1; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);
  return [state, () => setNonce((value) => value + 1)];
}

function Recovery({ title, state, onRetry }) {
  return <section className="admin-panel po-recovery" role="alert"><h2>{state.permission ? 'Access required' : title}</h2><p>{state.error}</p>{!state.permission && <button type="button" className="admin-button" onClick={onRetry}>Try again</button>}</section>;
}
const Skeleton = ({ label }) => <div aria-label={label} role="status"><div className="po-skeleton" /><div className="po-skeleton" /><div className="po-skeleton" /></div>;

export default function PurchaseOrders() {
  const { date: displayDate, timestamp: displayTime } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState('orders');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activityPage, setActivityPage] = useState(1);
  const [savedNotice] = useState(() => consumeSaved());
  const [showSaved, setShowSaved] = useState(Boolean(savedNotice));
  const [freshness, setFreshness] = useState(0);
  const [deleting, setDeleting] = useState(null);
  const [deleteNotice, setDeleteNotice] = useState('');
  const [deleteRecovery, setDeleteRecovery] = useState(pendingPurchaseOrderDeletions);
  const [recoveryBusy, setRecoveryBusy] = useState('');
  const recoveryBusyRef = useRef(false);
  const deleteFocus = useRef(null);
  const refreshButton = useRef(null);
  const closeDelete = () => { setDeleting(null); setDeleteRecovery(pendingPurchaseOrderDeletions()); requestAnimationFrame(() => {
    const target = deleteFocus.current;
    if (target?.isConnected) target.focus(); else refreshButton.current?.focus();
  }); };
  async function recoverDeletion(id, trigger) {
    if (recoveryBusyRef.current) return;
    recoveryBusyRef.current = true; setRecoveryBusy(id);
    deleteFocus.current = trigger;
    try { setDeleting(await getPurchaseOrder(id)); setDeleteNotice(''); }
    catch (cause) { setDeleteNotice(describeError(cause, 'The order could not be loaded for deletion reconciliation. Retry the same recovery action.')); }
    finally { recoveryBusyRef.current = false; setRecoveryBusy(''); }
  }
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !deleting) setFreshness((n) => n + 1); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [deleting]);

  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(timer); }, [search]);

  // Invalid or incomplete date text is treated as cleared.
  const from = validDate(filters.from) ? filters.from : '';
  const to = validDate(filters.to) ? filters.to : '';
  const rangeError = from && to && from > to ? 'The start date must be on or before the end date.' : '';
  const activeFilterCount = [filters.status !== 'open', filters.vendor, filters.product, from, to].filter(Boolean).length;

  const settled = search.trim() === debounced;
  const [overview, reloadOverview] = useServerData((signal) => getPurchaseOrderOverview(signal), [freshness]);
  const [orders, reloadOrders] = useServerData((signal) => listPurchaseOrders({
    query: debounced, status: filters.status, vendor_id: filters.vendor?.id, product_id: filters.product?.id, from_date: from, to_date: to,
    sort: filters.sort, limit: pageSize, offset: (page - 1) * pageSize,
  }, signal), [debounced, filters.status, filters.vendor?.id, filters.product?.id, from, to, filters.sort, page, pageSize, freshness], tab === 'orders' && !rangeError && settled);
  const [activity, reloadActivity] = useServerData((signal) => listPurchaseOrderActivity({ query: debounced, limit: pageSize, offset: (activityPage - 1) * pageSize }, signal), [debounced, activityPage, pageSize, freshness], tab === 'activity' && settled);
  const [analytics, reloadAnalytics] = useServerData((signal) => getPurchaseOrderAnalytics(signal), [freshness], tab === 'analytics');

  const orderData = orders.data;
  const ordersFor = orderData ? Math.max(1, Math.ceil(orderData.filtered / pageSize)) : 1;
  useEffect(() => { if (orderData && page > ordersFor) setPage(ordersFor); }, [orderData, page, ordersFor]);
  const activityData = activity.data;
  const activityFor = activityData ? Math.max(1, Math.ceil(activityData.filtered / pageSize)) : 1;
  useEffect(() => { if (activityData && activityPage > activityFor) setActivityPage(activityFor); }, [activityData, activityPage, activityFor]);

  const changeFilter = (patch) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const changeSearch = (value) => { setSearch(value); setPage(1); setActivityPage(1); };
  const selectTab = (key) => { setTab(key); setSearch(''); setDebounced(''); setPage(1); setActivityPage(1); };
  const clearFilters = () => { setSearch(''); setDebounced(''); setFilters(DEFAULT_FILTERS); setPage(1); };
  const refresh = useCallback(() => {
    reloadOverview();
    if (tab === 'orders') reloadOrders(); else if (tab === 'activity') reloadActivity(); else reloadAnalytics();
    setShowSaved(false);
  }, [tab, reloadOverview, reloadOrders, reloadActivity, reloadAnalytics]);
  const changePageSize = (size) => { setPageSize(size); setPage(1); setActivityPage(1); };

  const actions = (order) => <div className="po-actions po-listing-actions">
    <ProcurementDocumentActions key={order.id} kind="po" record={order} iconOnly />
    <Link className="po-icon-action" href={`${BASE}/${order.id}`} aria-label={`View record for ${order.number}`} title={`View record for ${order.number}`}><Eye size={17} aria-hidden="true" /></Link>
    {order.status === 'open' && !order.activeReceiptCount && <>
      <Link className="po-icon-action" href={`${BASE}/${order.id}?edit=1`} aria-label={`Edit ${order.number}`} title={`Edit ${order.number}`}><Pencil size={17} aria-hidden="true" /></Link>
      <button type="button" className="po-icon-action po-action--danger" aria-label={`Delete ${order.number}`} title={`Delete ${order.number}`} onClick={(event) => { deleteFocus.current = event.currentTarget; setDeleting(order); setDeleteNotice(''); }}><Trash2 size={17} aria-hidden="true" /></button>
    </>}
    {!!order.activeReceiptCount && <Link className="po-icon-action" href={`/admin/inventory/purchase-received?poId=${order.id}`}
      aria-label={`View ${order.activeReceiptCount} active ${order.activeReceiptCount === 1 ? 'receipt' : 'receipts'} for ${order.number}; active receipts prevent PO editing/deletion`}
      title={`View ${order.activeReceiptCount} active ${order.activeReceiptCount === 1 ? 'receipt' : 'receipts'} for ${order.number}; active receipts prevent PO editing/deletion`}><ClipboardCheck size={17} aria-hidden="true" /></Link>}
  </div>;
  const columns = [
    { key: 'serial', label: 'Sr. no.', render: (_order, index) => (page - 1) * pageSize + index + 1 },
    { key: 'number', label: 'Purchase order', render: (order) => <><Link className="po-number po-link" href={`${BASE}/${order.id}`}>{order.number}</Link><span className="po-secondary">{order.lines.length} {order.lines.length === 1 ? 'item' : 'items'}</span></> },
    { key: 'vendor', label: 'Vendor', render: (order) => <strong>{order.vendorName}</strong> },
    { key: 'location', label: 'Deliver to', render: (order) => order.locationName },
    { key: 'date', label: 'PO date', render: (order) => displayDate(order.poDate) },
    { key: 'expected', label: 'Expected', render: (order) => displayDate(order.expectedDate) },
    { key: 'amount', label: 'Total incl. GST', render: (order) => <span className="po-amount" data-testid={`text-po-total-${order.id}`}>{formatPaise(order.total)}</span> },
    { key: 'status', label: 'Status', render: (order) => <span className={`po-status${order.status === 'deleted' ? ' po-status--draft' : ''}`}>{order.status}</span> },
    { key: 'actions', label: 'Actions', render: actions },
  ];
  const ov = overview.data;
  const card = (value) => overview.status === 'error' && !ov ? 'Unavailable' : ov ? value : '…';
  const hasFilters = Boolean(debounced) || activeFilterCount > 0;
  const vendors = analytics.data?.vendors || [];
  const topAmount = vendors.reduce((max, vendor) => Math.max(max, vendor.amount), 0);

  return <AdminLayout title="Purchase Orders"><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Procurement</p><h1>Purchase orders</h1><p className="admin-page-head__description">Plan supplier purchases, track order value and review recorded changes.</p></div><div className="po-head-actions">
      <button ref={refreshButton} type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-purchase-orders"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
      <button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-new-purchase-order"><Plus size={16} aria-hidden="true" /> New purchase order</button>
    </div></div>
    {showSaved && <div className="admin-feedback" role="status" data-testid="status-po-feedback">{savedNotice?.number ? `Purchase order ${savedNotice.number} saved.` : 'Purchase order saved.'}</div>}
    {deleteNotice && <div className="admin-feedback" role="status">{deleteNotice}</div>}
    {(deleteRecovery.error || deleteRecovery.ids.length > 0) && <div className="admin-feedback" role="status">
      {deleteRecovery.error && <p>{deleteRecovery.error}</p>}
      {deleteRecovery.ids.length > 0 && <><p>Earlier deletions are unconfirmed. Reconcile the original requests here, even if their rows are no longer on this page. No new deletion identity is created.</p>
        <div className="po-actions">{deleteRecovery.ids.map((id, index) => <button key={id} type="button" className="admin-button admin-button--secondary" disabled={Boolean(recoveryBusy)} onClick={(event) => recoverDeletion(id, event.currentTarget)}>{recoveryBusy === id ? 'Loading order…' : `Review unconfirmed deletion ${index + 1}`}</button>)}</div></>}
    </div>}
    {overview.status === 'error' && <div className="admin-feedback admin-feedback--error" role="alert">{overview.error} <button type="button" className="po-link" onClick={reloadOverview}>Retry overview</button></div>}
    <div className="po-summary" aria-label="Purchase order overview">
      <div className="po-summary__item po-summary__item--accent"><span>Open order value</span><strong data-testid="text-po-open-value">{card(ov && formatPaise(ov.openValue))}</strong><small>Including GST</small></div>
      <div className="po-summary__item"><span>Open orders</span><strong data-testid="text-po-open-count">{card(ov?.openCount)}</strong><small>{ov ? `Across ${ov.vendorCount} ${ov.vendorCount === 1 ? 'vendor' : 'vendors'}` : 'All vendors'}</small></div>
      <div className="po-summary__item"><span>Product lines</span><strong>{card(ov?.lineCount)}</strong><small>On open orders</small></div>
      <div className="po-summary__item"><span>Changes recorded</span><strong>{card(ov?.changes)}</strong><small>Creates, edits and deletions</small></div>
    </div>
    <section className="admin-panel" aria-label="Purchase order workspace">
      <div className="po-tabs" role="tablist" aria-label="Purchase order views">
        {[['orders', ClipboardList, 'Orders'], ['activity', Activity, 'Activity'], ['analytics', BarChart3, 'Analytics']].map(([key, Icon, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className="po-tab" onClick={() => selectTab(key)} data-testid={`tab-po-${key}`}><Icon size={15} aria-hidden="true" />{label}</button>)}
      </div>
      {tab === 'orders' && <div role="tabpanel">
        <div className="po-toolbar">
          <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search purchase orders</span><input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search PO, vendor, location or product" data-testid="input-search-purchase-orders" /></label>
          <button type="button" className="admin-button admin-button--secondary po-filter-toggle" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="po-filter-panel" data-testid="button-toggle-po-filters">
            <SlidersHorizontal size={15} aria-hidden="true" /> Filters
            {activeFilterCount > 0 && <span className="po-filter-toggle__count" aria-label={`${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`}>{activeFilterCount}</span>}
            <ChevronDown size={15} className="po-filter-toggle__chevron" aria-hidden="true" />
          </button>
          <button type="button" className="admin-button admin-button--secondary" onClick={clearFilters} data-testid="button-clear-po-filters">Clear filters</button>
        </div>
        <div id="po-filter-panel" className="po-toolbar po-filter-panel" hidden={!filtersOpen} role="region" aria-label="Purchase order filters">
          <div className="admin-filter"><label htmlFor="po-status">Status</label><select id="po-status" className="admin-select" value={filters.status} onChange={(event) => changeFilter({ status: event.target.value })} data-testid="select-po-status"><option value="open">Open</option><option value="deleted">Deleted</option><option value="all">All statuses</option></select></div>
          <div className="admin-filter"><label htmlFor="po-vendor">Vendor</label><PurchaseOrderReferenceSelect id="po-vendor" kind="vendors" source="filter-options" label="Vendor" selected={filters.vendor} placeholder="All vendors" onChange={(item) => changeFilter({ vendor: item })} /></div>
          <div className="admin-filter"><label htmlFor="po-product">Product</label><PurchaseOrderReferenceSelect id="po-product" kind="products" source="filter-options" label="Product" selected={filters.product} placeholder="All products" onChange={(item) => changeFilter({ product: item })} /></div>
          <div className="admin-filter"><label htmlFor="po-from">From PO date</label><input id="po-from" className="admin-select" type="date" value={filters.from} max={to || undefined} onChange={(event) => changeFilter({ from: event.target.value })} aria-invalid={Boolean(rangeError)} data-testid="input-po-from" /></div>
          <div className="admin-filter"><label htmlFor="po-to">To PO date</label><input id="po-to" className="admin-select" type="date" value={filters.to} min={from || undefined} onChange={(event) => changeFilter({ to: event.target.value })} aria-invalid={Boolean(rangeError)} data-testid="input-po-to" /></div>
          <div className="admin-filter"><label htmlFor="po-sort">Sort</label><select id="po-sort" className="admin-select" value={filters.sort} onChange={(event) => changeFilter({ sort: event.target.value })} data-testid="select-po-sort"><option value="recent">Newest PO date</option><option value="oldest">Oldest PO date</option></select></div>
        </div>
        {rangeError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ margin: '0 18px 12px' }}>{rangeError}</div>}
        {rangeError ? null : orders.status === 'error' && !orderData ? <Recovery title="Purchase orders are unavailable" state={orders} onRetry={reloadOrders} />
          : !orderData ? <Skeleton label="Loading purchase orders" /> : <>
            {orders.status === 'error' && <div className="admin-feedback admin-feedback--error" role="alert">{orders.error} <button type="button" className="po-link" onClick={reloadOrders}>Retry</button></div>}
            {orderData.items.length ? <><div className="po-table"><DataTable columns={columns} rows={orderData.items} rowOffset={0} rowKey={(order) => order.id} label="Purchase orders" testIdPrefix="po" /></div>
              <div className="po-mobile" role="list" aria-label="Purchase orders">{orderData.items.map((order, index) => <article className="po-card" key={order.id} role="listitem"><div className="po-card__top"><div><span className="po-secondary">Sr. no. {(page - 1) * pageSize + index + 1}</span><Link className="po-number po-link" href={`${BASE}/${order.id}`}>{order.number}</Link><h2>{order.vendorName}</h2><p>{order.locationName}</p></div><span className={`po-status${order.status === 'deleted' ? ' po-status--draft' : ''}`}>{order.status}</span></div><dl><div><dt>PO date</dt><dd>{displayDate(order.poDate)}</dd></div><div><dt>Expected</dt><dd>{displayDate(order.expectedDate)}</dd></div><div><dt>Items</dt><dd>{order.lines.length}</dd></div><div><dt>Total incl. GST</dt><dd className="po-amount">{formatPaise(order.total)}</dd></div></dl>{actions(order)}</article>)}</div></>
              : <div className="admin-empty"><span className="admin-empty__icon"><ClipboardList size={21} aria-hidden="true" /></span><strong>{hasFilters ? 'No orders match these filters' : 'No purchase orders yet'}</strong><p>{hasFilters ? 'Change the filters or search to see more orders.' : 'Create your first order to start a procurement record.'}</p>{hasFilters && <div className="po-actions" style={{ marginTop: 17 }}><button type="button" className="admin-button admin-button--secondary" onClick={clearFilters}>Clear filters</button></div>}</div>}
            <TablePagination page={page} pageCount={ordersFor} pageSize={pageSize} filtered={orderData.filtered} total={orderData.total} label={orderData.filtered === 1 ? 'order' : 'orders'} onPageChange={(next) => setPage(Math.min(Math.max(1, next), ordersFor))} onPageSizeChange={changePageSize} testId="text-po-count" />
          </>}
      </div>}
      {tab === 'activity' && <div role="tabpanel">
        <div className="po-toolbar"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search order activity</span><input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search PO, change or actor" data-testid="input-search-po-activity" /></label></div>
        {activity.status === 'error' && !activityData ? <Recovery title="Activity is unavailable" state={activity} onRetry={reloadActivity} />
          : !activityData ? <Skeleton label="Loading activity" /> : <>
            {activity.status === 'error' && <div className="admin-feedback admin-feedback--error" role="alert">{activity.error} <button type="button" className="po-link" onClick={reloadActivity}>Retry</button></div>}
            {activityData.items.length ? <div className="po-activity">{activityData.items.map((event) => <article className="po-event" key={event.id}><div className="po-event__mark"><Activity size={14} aria-hidden="true" /></div><div><span className="po-number">{event.number}</span> <strong>· {event.action}</strong><p>{event.summary}</p>
              <p className="po-event__attribution"><strong>{ACTION_LABEL[event.action] || 'By'}</strong> {actorName(event.actor)}<span aria-hidden="true"> · </span><time dateTime={event.at}>{displayTime(event.at)}</time></p><Link className="po-link" href={`${BASE}/${event.orderId}`}>View {event.number}</Link></div></article>)}</div>
              : <div className="admin-empty"><span className="admin-empty__icon"><Activity size={21} aria-hidden="true" /></span><strong>No activity to show</strong><p>{debounced ? 'Try a different search.' : 'Order changes will appear here after your first purchase order.'}</p></div>}
            <TablePagination page={activityPage} pageCount={activityFor} pageSize={pageSize} filtered={activityData.filtered} total={activityData.total} label={activityData.filtered === 1 ? 'event' : 'events'} onPageChange={(next) => setActivityPage(Math.min(Math.max(1, next), activityFor))} onPageSizeChange={changePageSize} testId="text-po-activity-count" />
          </>}
      </div>}
      {tab === 'analytics' && <div className="po-analytics" role="tabpanel">
        {analytics.status === 'error' && !analytics.data ? <Recovery title="Analytics are unavailable" state={analytics} onRetry={reloadAnalytics} />
          : !analytics.data ? <Skeleton label="Loading analytics" /> : <>
            {analytics.status === 'error' && <div className="admin-feedback admin-feedback--error" role="alert">{analytics.error} <button type="button" className="po-link" onClick={reloadAnalytics}>Retry</button></div>}
            <h2>Purchase order activity</h2><p>Counts of committed purchase order changes recorded by the server, across all orders.</p>
            <div className="po-event-counts">{['created', 'updated', 'deleted'].map((action) => <div key={action}><strong>{analytics.data.counts?.[action] ?? 0}</strong><span>{action} changes</span></div>)}</div>
            <h2>Open value by vendor</h2><p>Totals include GST and exclude deleted orders, across every open order.</p>
            {vendors.length ? <div className="po-bars">{vendors.map((vendor) => <div className="po-bar" key={vendor.id}><div className="po-bar__label"><strong>{vendor.name} <span className="po-secondary">{vendor.count} {vendor.count === 1 ? 'order' : 'orders'}</span></strong><strong>{formatPaise(vendor.amount)}</strong></div><div className="po-bar__track"><div className="po-bar__fill" style={{ minWidth: 0, width: `${topAmount ? vendor.amount / topAmount * 100 : 0}%` }} /></div></div>)}</div>
              : <div className="admin-empty"><span className="admin-empty__icon"><BarChart3 size={21} aria-hidden="true" /></span><strong>Nothing to compare yet</strong><p>Vendor totals will appear after an order is created.</p></div>}
          </>}
      </div>}
    </section>
    {deleting && <PurchaseOrderDeleteDialog key={deleting.id} order={deleting} onClose={closeDelete} onDeleted={(saved) => { closeDelete(); setDeleteNotice(`${saved.number} deleted. Listing and summary refreshed.`); setFreshness((n) => n + 1); }} />}
  </div></AdminLayout>;
}
