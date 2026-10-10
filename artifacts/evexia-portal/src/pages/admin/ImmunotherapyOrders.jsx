import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { ClipboardList, Eye, Pencil, Plus, Printer, Search, ChevronDown } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import ImmPrintDialog, { PRINT_KINDS } from '../../components/immunotherapy/ImmPrintDialog.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { DOCTORS, MRS, STATUSES, demoStore, filterOrders, money, shippingRecipient, totalMinor } from '../../services/immunotherapyDemo.js';
import '../../immunotherapy.css';

const BASE = '/admin/orders/immunotherapy';
export const StatusPill = ({ status }) => <span className={`imm-status imm-status--${status.replace(' ', '-')}`}>{status}</span>;
const nameOf = (list, id) => list.find((x) => x.id === id)?.name || 'Not recorded';

export default function ImmunotherapyOrders() {
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const { theme, appearance } = useAdminPreferences();
  const [printKind, setPrintKind] = useState('');
  const printTrigger = useRef(null);
  const openingPrint = useRef(false);
  const rows = useMemo(() => filterOrders(snap.orders, snap.patients, { search, status, from, to }), [snap.orders, snap.patients, search, status, from, to]);
  const pager = useTablePagination(rows);
  const { resetPage } = pager;
  const eligible = (o) => o.status === 'In process';
  useEffect(() => { resetPage(); }, [search, status, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  // Revalidate: selections never outlive filter visibility or eligibility.
  useEffect(() => {
    setSelected((cur) => {
      const ok = new Set(rows.filter(eligible).map((o) => o.id));
      const next = new Set([...cur].filter((id) => ok.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [rows]);
  const reset = () => { setSearch(''); setStatus('All'); setFrom(''); setTo(''); };
  const filtered = search || status !== 'All' || from || to;
  const pageEligible = pager.pageRows.filter(eligible);
  const allPage = pageEligible.length > 0 && pageEligible.every((o) => selected.has(o.id));
  const toggle = (id) => setSelected((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSelected((cur) => { const n = new Set(cur); pageEligible.forEach((o) => allPage ? n.delete(o.id) : n.add(o.id)); return n; });
  const chosen = snap.orders.filter((o) => selected.has(o.id) && eligible(o));
  const counts = STATUSES.map((s) => [s, snap.orders.filter((o) => o.status === s).length]);

  const columns = [
    { key: 'sel', label: <input type="checkbox" className="imm-check" aria-label="Select eligible In process orders on this page" checked={allPage} disabled={!pageEligible.length} onChange={togglePage} data-testid="check-imm-page" />, render: (o) => <input type="checkbox" className="imm-check" aria-label={eligible(o) ? `Select ${o.number}` : `${o.number} is ${o.status}; only In process orders can be printed`} checked={selected.has(o.id)} disabled={!eligible(o)} onChange={() => toggle(o.id)} data-testid={`check-imm-${o.id}`} /> },
    { key: 'number', label: 'Order', render: (o) => <><strong>{o.number}</strong><span className="imm-cell-sub">{o.date}</span></> },
    { key: 'patient', label: 'Patient', render: (o) => { const p = snap.patients.find((x) => x.id === o.patientId); return <><strong>{p?.name || 'Unknown'}</strong><span className="imm-cell-sub">{p?.phone}</span></>; } },
    { key: 'dm', label: 'Doctor / MR', render: (o) => <>{nameOf(DOCTORS, o.doctorId)}<span className="imm-cell-sub">{nameOf(MRS, o.mrId)}</span></> },
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
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders</p><h1>Immunotherapy</h1>
        <p className="admin-page-head__description">Review patient dosage and bottle composition for each order.</p></div>
      <Link href={`${BASE}/new`} className="admin-button" data-testid="link-imm-add"><Plus size={16} aria-hidden="true" />Add Order</Link>
    </div>
    <p className="imm-boundary" data-testid="status-imm-demo">Fictional demo: patients, doctors, MRs, allergens and orders live in browser memory only. Nothing is submitted, dispensed or shipped, and a reload resets everything.</p>
    {snap.notice && <div className="imm-notice" role="status" data-testid="status-imm-notice"><span>{snap.notice}</span><button type="button" className="imm-link-btn" onClick={() => demoStore.setNotice('')}>Dismiss</button></div>}
    <div className="imm-summary" aria-label="Order counts by status">
      <div className="imm-stat"><strong>{snap.orders.length}</strong><span>All orders</span></div>
      {counts.map(([s, n]) => <div className="imm-stat" key={s}><strong>{n}</strong><span>{s}</span></div>)}
    </div>
    <section className="admin-panel" aria-label="Immunotherapy orders">
      <div className="imm-filters">
        <label className="imm-field imm-field--grow">Search
          <span style={{ position: 'relative', display: 'block' }}><Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 13, color: 'var(--admin-muted)' }} />
            <input className="imm-input" style={{ paddingLeft: 35 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order, patient, phone, doctor or MR" data-testid="input-imm-search" /></span></label>
        <label className="imm-field">Status<select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-imm-status"><option>All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="imm-field">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="input-imm-from" /></label>
        <label className="imm-field">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="input-imm-to" /></label>
        <button type="button" className="admin-button admin-button--secondary" onClick={reset} disabled={!filtered} data-testid="button-imm-reset">Reset</button>
      </div>
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
                {PRINT_KINDS.map((k) => <DropdownMenu.Item key={k.key} className="admin-dropdown__item" onSelect={() => { openingPrint.current = true; setPrintKind(k.key); }} data-testid={`menu-imm-print-${k.key}`}>{k.label}</DropdownMenu.Item>)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <DataTable columns={columns} rows={pager.pageRows} rowKey={(o) => o.id} label="Immunotherapy orders (scrolls horizontally)" testIdPrefix="imm"
        empty={<div className="imm-empty" data-testid="empty-imm"><ClipboardList size={28} aria-hidden="true" /><strong>{snap.orders.length ? 'No orders match' : 'No immunotherapy orders yet'}</strong><p>{snap.orders.length ? 'Adjust the search, status or dates.' : 'Add a demo order to begin.'}</p>{snap.orders.length ? <button type="button" className="admin-button admin-button--secondary" onClick={reset}>Reset filters</button> : <Link href={`${BASE}/new`} className="admin-button">Add Order</Link>}</div>} />
      <div className="imm-toolbar imm-edges" style={{ borderTop: '1px solid var(--admin-border)', borderBottom: 0 }}>
        <span>Jump to page {pager.page} of {pager.pageCount}</span>
        <div className="imm-toolbar__actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => pager.setPage(1)} disabled={pager.page === 1} data-testid="button-imm-first">First page</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => pager.setPage(pager.pageCount)} disabled={pager.page === pager.pageCount} data-testid="button-imm-last">Last page</button>
        </div>
      </div>
      <TablePagination page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} filtered={rows.length} total={snap.orders.length} label="orders" testId="text-imm-count" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </section>
    {printKind && <ImmPrintDialog kind={printKind} orders={chosen} snap={snap} returnFocusRef={printTrigger} onClose={() => setPrintKind('')} />}
  </div></AdminLayout>;
}
