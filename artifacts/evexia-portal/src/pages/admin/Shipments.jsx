import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileDown, PackageCheck, Search, Truck, Undo2, CalendarCheck } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import ShipmentActionDialog from '../../components/admin/ShipmentActionDialog.jsx';
import { useOrderListFreshness } from '../../services/orderFreshness.js';
import { EMPTY_FILTERS, SHIPMENT_STATUSES, SHIPMENT_TYPES, TYPE_LABELS, listShipments, exportShipments, announceShipmentChange } from '../../services/serverShipments.js';
import '../../kitsOrders.css';
import './Shipments.css';

const NA = <span className="shipment-na">Unavailable</span>;

function StatusPill({ status }) {
  const tone = status === 'Shipped' ? 'shipped' : status === 'Returned' ? 'returned' : 'process';
  return <span className={`shipment-pill shipment-pill--${tone}`}>{status}</span>;
}

function Actions({ row, onAction }) {
  if (row.status === 'In process') return <button type="button" className="admin-button shipment-act" onClick={() => onAction('ship', row)} data-testid={`button-ship-${row.key}`}><Truck size={15} aria-hidden="true" />Ship</button>;
  if (row.status === 'Shipped') return <div className="shipment-actions">
    {!row.actualDeliveryDate && <button type="button" className="admin-button admin-button--secondary shipment-act" onClick={() => onAction('delivery', row)} data-testid={`button-delivery-${row.key}`}><CalendarCheck size={15} aria-hidden="true" />Delivery date</button>}
    <button type="button" className="admin-button admin-button--secondary shipment-act" onClick={() => onAction('return', row)} data-testid={`button-return-${row.key}`}><Undo2 size={15} aria-hidden="true" />Return</button>
  </div>;
  return <span className="shipment-sub">No action</span>;
}

function Denied() {
  return <AdminLayout title="SHIPMENTS"><section className="admin-panel shipments-state" role="alert"><strong>Shipments are restricted</strong><p>Only the Super Admin can manage shipments.</p></section></AdminLayout>;
}

export default function Shipments() {
  const { user } = useAdminSession();
  if (!isSuperAdminIdentity(user)) return <Denied />;
  return <ShipmentsPage />;
}

function ShipmentsPage() {
  const { date, timestamp } = useAdminDateFormatters();
  const { theme, appearance } = useAdminPreferences();
  const fmtDate = (v) => (v ? date(v) : '');
  const [draft, setDraft] = useState(EMPTY_FILTERS), [applied, setApplied] = useState(EMPTY_FILTERS);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [dateError, setDateError] = useState('');
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(''), [exportMsg, setExportMsg] = useState(null);
  const actionOpen = useRef(false);
  actionOpen.current = Boolean(action);
  const refresh = () => { if (!actionOpen.current) setRevision((n) => n + 1); };
  useOrderListFreshness('shipments', refresh);
  useOrderListFreshness('kits', refresh);
  useOrderListFreshness('immunotherapy', refresh);
  useOrderListFreshness('lupin', refresh);
  useOrderListFreshness('spt', refresh);
  const set = (patch) => { setDraft((v) => ({ ...v, ...patch })); setDateError(''); };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    listShipments(applied, { offset: (page - 1) * pageSize, limit: pageSize, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult({ items: data.items || [], total: data.total ?? 0 }); })
      .catch((e) => { if (!controller.signal.aborted) { setError(e.message || 'Shipments could not be loaded.'); setResult({ items: [], total: 0 }); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, pageSize, revision]);

  function apply(e) {
    e.preventDefault();
    if (draft.from_date && draft.to_date && draft.from_date > draft.to_date) { setDateError('From date must be on or before To date.'); return; }
    setApplied({ ...draft, search: draft.search.trim() }); setPage(1);
  }
  const reset = () => { setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setDateError(''); setPage(1); };

  function done(updated) {
    const prev = action;
    setAction(null);
    const label = prev.mode === 'ship' ? 'marked Shipped' : prev.mode === 'return' ? 'marked Returned' : 'updated with the actual delivery date';
    setNotice(`${updated?.number || prev.row.number} ${label}.`);
    announceShipmentChange(prev.row.type);
    setRevision((n) => n + 1);
  }

  async function runExport(format) {
    if (exporting) return;
    setExporting(format); setExportMsg(null);
    try {
      const count = await exportShipments(applied, format);
      setExportMsg({ ok: true, text: `${format.toUpperCase()} prepared with all ${count} matching shipments.` });
    } catch (e) { setExportMsg({ ok: false, text: e.message || 'Export failed. No file was released.' }); }
    finally { setExporting(''); }
  }

  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  const who = (r) => <><span>{r.doctor ?? NA}</span><span className="shipment-sub">MR: {r.mr ?? 'Unavailable'}</span></>;
  const courier = (r) => r.courier || r.trackingId ? <><span>{r.courier ?? NA}</span><span className="shipment-sub shipment-mono">{r.trackingId ?? 'Unavailable'}</span></> : <span className="shipment-sub">Not shipped</span>;
  const delivery = (r) => <dl className="shipment-dates">
    <div><dt>Expected</dt><dd>{r.expectedDeliveryDate ? fmtDate(r.expectedDeliveryDate) : '—'}</dd></div>
    <div><dt>Actual</dt><dd>{r.actualDeliveryDate ? fmtDate(r.actualDeliveryDate) : '—'}</dd></div>
    {r.shippedAt && <div><dt>Shipped</dt><dd>{timestamp(r.shippedAt)}</dd></div>}
  </dl>;
  const columns = [
    { key: 'sr', label: 'Sr. No.', render: (_r, i) => i + 1 },
    { key: 'order', label: 'Order', render: (r) => <><strong className="shipment-mono" data-testid={`text-order-${r.key}`}>{r.number}</strong><span className="shipment-sub">{fmtDate(r.date)}</span></> },
    { key: 'type', label: 'Type', render: (r) => <span className={`shipment-type shipment-type--${r.type.toLowerCase()}`}>{r.type}</span> },
    { key: 'value', label: 'Value', render: (r) => r.value != null ? <span className="shipment-mono">{r.value}</span> : NA },
    { key: 'who', label: 'Doctor / MR', render: who },
    { key: 'address', label: 'Shipping address', render: (r) => <div className="shipment-address">{r.recipient && <strong>{r.recipient}</strong>}{r.address ?? NA}</div> },
    { key: 'courier', label: 'Courier / Tracking', render: courier },
    { key: 'delivery', label: 'Delivery', render: delivery },
    { key: 'status', label: 'Status', render: (r) => <><StatusPill status={r.status} /><span className="shipment-sub">Payment: {r.paymentStatus ?? 'Unavailable'}</span></> },
    { key: 'act', label: 'Action', render: (r) => <Actions row={r} onAction={(mode, row) => { setNotice(''); setAction({ mode, row }); }} /> },
  ];

  return <AdminLayout title="SHIPMENTS"><div className="kits kits-listing shipments">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Fulfillment</p><h1>Shipments</h1><p className="admin-page-head__description">Dispatch saved Kits, Immunotherapy, Lupin and SPT orders, then track delivery and returns.</p></div>
      <div className="kits-actions-top">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={Boolean(exporting)} data-testid="button-export-shipments"><FileDown size={16} aria-hidden="true" />{exporting ? 'Preparing…' : 'Export'}<ChevronDown size={14} aria-hidden="true" /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu shipments-menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12}>
            <DropdownMenu.Label className="shipments-menu__label">All matching shipments</DropdownMenu.Label>
            <DropdownMenu.Item className="shipments-menu__item" onSelect={() => runExport('csv')} data-testid="menu-export-csv">Download CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="shipments-menu__item" onSelect={() => runExport('xlsx')} data-testid="menu-export-xlsx">Download XLSX</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
    {exportMsg && <div className={`admin-feedback ${exportMsg.ok ? 'admin-feedback--success' : 'admin-feedback--error'}`} role={exportMsg.ok ? 'status' : 'alert'} data-testid="status-export">{exportMsg.text}</div>}
    {notice && <div className="admin-feedback admin-feedback--success" role="status" data-testid="status-shipment-notice">{notice}</div>}
    <section className="admin-panel kits-panel kits-listing__panel" aria-label="Shipments">
      <OrderListingFilters masterDisclosure disclosureLabel="Filter shipments" refreshLabel="Refresh shipments" onRefresh={refresh} onReset={reset} onApply={apply}
        applyTestId="button-apply-shipment-filters" resetTestId="button-reset-shipment-filters"
        search={<label className="kits-field"><span className="kits-listing__search-control"><Search size={16} aria-hidden="true" /><input aria-label="Search" maxLength={200} value={draft.search} onChange={(e) => set({ search: e.target.value })} placeholder="Order, doctor, MR, courier or tracking" data-testid="input-shipment-search" /></span></label>}>
        <label className="kits-field">From<input type="date" value={draft.from_date} max={draft.to_date || undefined} onChange={(e) => set({ from_date: e.target.value })} data-testid="input-from-date" /></label>
        <label className="kits-field">To<input type="date" value={draft.to_date} min={draft.from_date || undefined} onChange={(e) => set({ to_date: e.target.value })} data-testid="input-to-date" /></label>
        <label className="kits-field">Order status<select value={draft.status} onChange={(e) => set({ status: e.target.value })} data-testid="select-shipment-status">{SHIPMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="kits-field">Type<select value={draft.type} onChange={(e) => set({ type: e.target.value })} data-testid="select-shipment-type">{SHIPMENT_TYPES.map((t) => <option key={t} value={t}>{t === 'All' ? 'All' : `${t} — ${TYPE_LABELS[t]}`}</option>)}</select></label>
        {dateError && <p className="shipment-error" role="alert">{dateError}</p>}
      </OrderListingFilters>
      {error ? <div className="kits-listing__state kits-listing__state--error" role="alert"><strong>Shipments unavailable</strong><p>{error}</p><button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-retry-shipments">Retry loading shipments</button></div>
        : <>
          <div className="shipments-table">
            <DataTable columns={columns} rows={result.items} loading={loading} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.key} label="Shipments (scrolls horizontally)" testIdPrefix="shipment"
              empty={<div className="kits-listing__state"><PackageCheck size={28} aria-hidden="true" /><strong>{applied.status === 'In process' && applied.type === 'All' && !applied.search && !applied.from_date && !applied.to_date ? 'Nothing waiting to ship' : 'No matching shipments'}</strong><p>Change or reset the filters. All includes In process, Shipped and Returned orders.</p></div>} />
          </div>
          <ul className="shipments-cards" aria-label="Shipments">
            {loading ? [0, 1, 2].map((i) => <li key={i} className="shipment-card shipment-card--skeleton" aria-hidden="true"><span /><span /><span /></li>)
              : result.items.length === 0 ? <li className="kits-listing__state"><strong>No matching shipments</strong><p>Change the status filter or reset the filters.</p></li>
              : result.items.map((r) => <li key={r.key} className="shipment-card" data-testid={`card-shipment-${r.key}`}>
                <div className="shipment-card__head"><div><strong className="shipment-mono">{r.number}</strong><span className="shipment-sub">{fmtDate(r.date)} · {TYPE_LABELS[r.type] || r.type}</span></div><StatusPill status={r.status} /></div>
                <dl className="shipment-card__facts">
                  <div><dt>Value</dt><dd>{r.value ?? NA}</dd></div>
                  <div><dt>Payment</dt><dd>{r.paymentStatus ?? NA}</dd></div>
                  <div><dt>Doctor / MR</dt><dd>{who(r)}</dd></div>
                  <div><dt>Address</dt><dd>{r.recipient && <strong>{r.recipient} </strong>}{r.address ?? NA}</dd></div>
                  <div><dt>Courier</dt><dd>{courier(r)}</dd></div>
                  <div><dt>Delivery</dt><dd>{delivery(r)}</dd></div>
                </dl>
                <Actions row={r} onAction={(mode, row) => { setNotice(''); setAction({ mode, row }); }} />
              </li>)}
          </ul>
          <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={result.total} total={result.total} label="shipments" testId="shipments-count"
            onPageChange={(n) => { if (!loading && n >= 1 && n <= pageCount) setPage(n); }} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
        </>}
    </section>
    {action && <ShipmentActionDialog key={`${action.mode}-${action.row.key}`} mode={action.mode} row={action.row} formatDate={fmtDate} onClose={() => setAction(null)} onDone={done} />}
  </div></AdminLayout>;
}
