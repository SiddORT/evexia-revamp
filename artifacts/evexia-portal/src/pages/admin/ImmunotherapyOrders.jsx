import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { ClipboardList, Eye, Pencil, Plus, Printer, Search, ChevronDown } from 'lucide-react';
import AdminLayout, { useOrderBase } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import OrderTransfers from '../../components/admin/OrderTransfers.jsx';
import ImmPrintDialog, { PRINT_KINDS } from '../../components/immunotherapy/ImmPrintDialog.jsx';
import { STATUSES, request, money, shippingRecipient, totalMinor } from '../../services/serverImmunotherapy.js';
import { createImmunotherapyTransferAdapter } from '../../services/immunotherapyTransfers.js';
import '../../immunotherapy.css';

export const StatusPill = ({ status }) => <span className={`imm-status imm-status--${status.replace(' ', '-')}`}>{status}</span>;

export default function ImmunotherapyOrders() {
  const BASE = useOrderBase('immunotherapy');
  const { date } = useAdminDateFormatters();
  const [result, setResult] = useState({ items: [], total: 0, counts: {}, nextCursor: null, filtered: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cursors, setCursors] = useState([null]);
  const [known, setKnown] = useState({});
  const [printOrders, setPrintOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const { theme, appearance } = useAdminPreferences();
  const [printKind, setPrintKind] = useState('');
  const printTrigger = useRef(null);
  const openingPrint = useRef(false);
  const rows = result.items;
  const filters = { search, status: status === 'All' ? '' : status, from_date: from, to_date: to };
  const resetPage = () => { setPage(1); setCursors([null]); setSelected(new Set()); setKnown({}); };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = setTimeout(() => request('', { params: { ...filters, limit: pageSize, cursor: cursors[page - 1] }, signal: controller.signal })
      .then((data) => {
        setResult(data); setKnown((current) => ({ ...current, ...Object.fromEntries(data.items.map((o) => [o.id, o])) }));
        setSelected((current) => new Set([...current].filter((id) => !data.items.some((o) => o.id === id && o.status !== 'In process'))));
      }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setResult((r) => ({ ...r, items: [], nextCursor: null })); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, status, from, to, page, pageSize, revision]); // explicit finite server page
  const pageCount = page + (result.nextCursor ? 1 : 0);
  const setServerPage = (next) => {
    if (loading || next < 1) return;
    if (next === page + 1 && result.nextCursor) setCursors((current) => { const resultCursors = [...current]; resultCursors[page] = result.nextCursor; return resultCursors; });
    else if (next > 1 && !cursors[next - 1]) return;
    setPage(next);
  };
  const pager = { page, pageCount, pageSize, pageRows: rows, startIndex: (page - 1) * pageSize,
    setPage: setServerPage, setPageSize: (size) => { setPageSize(size); resetPage(); } };
  const snap = { orders: rows, patients: rows.map((o) => o.patient) };
  const transferAdapter = createImmunotherapyTransferAdapter(filters, () => { resetPage(); setRevision((n) => n + 1); });
  const eligible = (o) => o.status === 'In process';
  useEffect(() => { resetPage(); }, [search, status, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { setSearch(''); setStatus('All'); setFrom(''); setTo(''); resetPage(); };
  const filtered = search || status !== 'All' || from || to;
  const pageEligible = pager.pageRows.filter(eligible);
  const allPage = pageEligible.length > 0 && pageEligible.every((o) => selected.has(o.id));
  const toggle = (id) => setSelected((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSelected((cur) => { const n = new Set(cur); pageEligible.forEach((o) => allPage ? n.delete(o.id) : n.add(o.id)); return n; });
  const chosen = Object.values(known).filter((o) => selected.has(o.id) && eligible(o));
  const counts = STATUSES.map((s) => [s, result.counts[s] || 0]);
  async function openPrint(kind) {
    setError('');
    try {
      if (chosen.length > 100) throw new Error('Print up to 100 selected orders at a time.');
      const current = await Promise.all(chosen.map((o) => request(`/${o.id}`)));
      if (current.some((o) => !eligible(o))) throw new Error('Some selected orders are no longer In process. Refresh and select again.');
      setPrintOrders(current); setPrintKind(kind);
    } catch (e) { setError(e.message); }
  }

  const columns = [
    { key: 'sel', label: <input type="checkbox" className="imm-check" aria-label="Select eligible In process orders on this page" checked={allPage} disabled={!pageEligible.length} onChange={togglePage} data-testid="check-imm-page" />, render: (o) => <input type="checkbox" className="imm-check" aria-label={eligible(o) ? `Select ${o.number}` : `${o.number} is ${o.status}; only In process orders can be printed`} checked={selected.has(o.id)} disabled={!eligible(o)} onChange={() => toggle(o.id)} data-testid={`check-imm-${o.id}`} /> },
    { key: 'serial', label: 'Sr No.', render: (_o, index) => <span className="imm-num">{index + 1}</span> },
    { key: 'number', label: 'Order', render: (o) => <><strong>{o.number}</strong><span className="imm-cell-sub">{date(o.date)}</span></> },
    { key: 'patient', label: 'Patient', render: (o) => <><strong>{o.patient.name}</strong><span className="imm-cell-sub">{o.patient.phone}</span></> },
    { key: 'dm', label: 'Doctor / MR', render: (o) => <>{o.doctor.name}<span className="imm-cell-sub">{o.mr.name}</span></> },
    { key: 'dosage', label: 'Dosage', render: (o) => o.dosage },
    { key: 'bottles', label: 'Bottles', render: (o) => o.groups.length },
    { key: 'value', label: 'Value', render: (o) => <span className="imm-num">{money(totalMinor(o.groups))}</span> },
    { key: 'ship', label: 'Ship to', render: (o) => <>{shippingRecipient(o, snap.patients)?.name || '-'}<span className="imm-cell-sub">{o.shipping === 'doctor' ? 'Doctor' : 'Patient'}</span></> },
    { key: 'status', label: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'actions', label: 'Actions', render: (o) => <div className="admin-table__actions">
      <Link href={`${BASE}/${o.id}`} className="admin-icon-button" aria-label={`View ${o.number}`} data-testid={`link-imm-view-${o.id}`}><Eye size={16} aria-hidden="true" /></Link>
      <Link href={`${BASE}/${o.id}/edit`} className="admin-icon-button" aria-label={`Edit ${o.number}`} data-testid={`link-imm-edit-${o.id}`}><Pencil size={16} aria-hidden="true" /></Link></div> },
  ];

  return <AdminLayout title="IMMUNOTHERAPY"><div className="imm">
    <OrderTransfers kind="immunotherapy" rows={rows} snapshot={snap} adapter={transferAdapter} total={result.filtered ?? result.total} renderActions={(actions) => <div className="admin-page-head imm-list-head">
      <div><p className="admin-page-head__eyebrow">Orders</p><h1>Immunotherapy</h1>
        <p className="admin-page-head__description">Review patient dosage and bottle composition for each order.</p></div>
      <div className="imm-list-head__actions">
        {actions}
        <Link href={`${BASE}/new`} className="admin-button" data-testid="link-imm-add"><Plus size={16} aria-hidden="true" />Add Order</Link>
      </div>
    </div>} />
    {error && <div className="imm-errors" role="alert">{error} <button type="button" className="imm-link-btn" onClick={() => setRevision((n) => n + 1)}>Retry</button></div>}
    {loading && <p role="status">Loading saved orders…</p>}
    <div className="imm-summary" aria-label="Order counts by status">
      <div className="imm-stat"><strong>{result.total}</strong><span>All orders</span></div>
      {counts.map(([s, n]) => <div className="imm-stat" key={s}><strong>{n}</strong><span>{s}</span></div>)}
    </div>
    <section className="admin-panel imm-listing" aria-label="Immunotherapy orders">
      <OrderListingFilters masterDisclosure onRefresh={() => { resetPage(); setRevision((n) => n + 1); }} onReset={reset} resetDisabled={!filtered && pager.page === 1} resetTestId="button-imm-reset" search={
        <label className="imm-field imm-field--grow">
          <span style={{ position: 'relative', display: 'block' }}><Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 13, color: 'var(--admin-muted)' }} />
            <input aria-label="Search" className="imm-input" style={{ paddingLeft: 35 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order, patient, phone, doctor or MR" data-testid="input-imm-search" /></span></label>
      }>
        <label className="imm-field">Status<select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-imm-status"><option>All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="imm-field">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="input-imm-from" /></label>
        <label className="imm-field">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="input-imm-to" /></label>
      </OrderListingFilters>
      <div className="imm-toolbar">
        <span aria-live="polite" data-testid="text-imm-selection">{selected.size} selected across all pages. Only In process orders can be selected. Filters drop hidden selections.</span>
        <div className="imm-toolbar__actions">
          {selected.size > 0 && <button type="button" className="imm-link-btn" onClick={() => setSelected(new Set())}>Clear selection</button>}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button ref={printTrigger} type="button" className="admin-button admin-button--secondary" disabled={!chosen.length} data-testid="button-imm-bulk-print"><Printer size={15} aria-hidden="true" />Bulk Print<ChevronDown size={14} aria-hidden="true" /></button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="admin-dropdown__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ width: 210, maxWidth: 'calc(100vw - 24px)' }} aria-label="Bulk print options" onCloseAutoFocus={(event) => { if (openingPrint.current) { event.preventDefault(); openingPrint.current = false; } }}>
                {PRINT_KINDS.map((k) => <DropdownMenu.Item key={k.key} className="admin-dropdown__item" onSelect={() => { openingPrint.current = true; openPrint(k.key); }} data-testid={`menu-imm-print-${k.key}`}>{k.label}</DropdownMenu.Item>)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <DataTable columns={columns} rows={pager.pageRows} rowOffset={pager.startIndex} rowKey={(o) => o.id} label="Immunotherapy orders (scrolls horizontally)" testIdPrefix="imm"
        empty={<div className="imm-empty" data-testid="empty-imm"><ClipboardList size={28} aria-hidden="true" /><strong>{loading ? 'Loading…' : error ? 'Orders unavailable' : result.total ? 'No matches in this section' : 'No immunotherapy orders yet'}</strong><p>{result.nextCursor ? 'Continue to the next section to search more saved records.' : result.total ? 'Adjust the search, status or dates.' : 'Add an order to begin.'}</p>{result.total ? <button type="button" className="admin-button admin-button--secondary" onClick={reset}>Reset filters</button> : <Link href={`${BASE}/new`} className="admin-button">Add Order</Link>}</div>} />
      <TablePagination cursorMode sectionCount={rows.length} page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} filtered={result.filtered} total={result.total} label="orders" testId="text-imm-count" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </section>
    {printKind && <ImmPrintDialog kind={printKind} orders={printOrders} returnFocusRef={printTrigger} onClose={() => setPrintKind('')} />}
  </div></AdminLayout>;
}
