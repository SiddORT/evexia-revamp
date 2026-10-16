import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Check, Download, Eye, Plus, Search, X, ClipboardList } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { releaseBlob } from '../../services/downloadRelease.js';
import { DOCTORS, STATUSES, demoStore, filterOrders, money, ordersCsv, totalMinor } from '../../services/lupinOrdersDemo.js';
import '../../lupinOrders.css';

const BASE = '/admin/orders/lupin';
const doctorOptions = DOCTORS.map((d) => ({ value: d.id, label: d.name }));
const none = { date: '', doctorId: '', statuses: [] };

export default function LupinOrders() {
  const { date } = useAdminDateFormatters();
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const { theme, appearance } = useAdminPreferences();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(none);
  const [applied, setApplied] = useState(none);
  const [exportError, setExportError] = useState('');
  const rows = useMemo(() => filterOrders(snap.orders, { search, ...applied }), [snap.orders, search, applied]);
  const toggle = (s) => setDraft((d) => ({ ...d, statuses: d.statuses.includes(s) ? d.statuses.filter((x) => x !== s) : [...d.statuses, s] }));
  const reset = () => { setSearch(''); setDraft(none); setApplied(none); };
  const exportCsv = () => {
    setExportError('');
    try {
      // This mock is deliberately offline: use only the local handoff primitive,
      // not the real exports/download-reporting API.
      releaseBlob(new Blob([ordersCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'lupin-orders.csv');
    } catch {
      setExportError('The browser could not start this local CSV download. Try Export again.');
    }
  };
  const columns = [
    { key: 'sn', label: 'S.No', render: (_o, i) => i + 1 },
    { key: 'order', label: 'Order details', render: (o) => <><strong>{o.number}</strong><span className="lupin-sub">{date(o.date)}</span><span className="lupin-sub">{o.patientCount} patients, {money(totalMinor(o.patientCount, o.price))}</span></> },
    { key: 'dm', label: 'Doctor / MR', render: (o) => <>{o.doctorName}<span className="lupin-sub">{o.mrName}</span></> },
    { key: 'status', label: 'Order status', render: (o) => <span className="lupin-pill">{o.status}</span> },
    { key: 'pay', label: 'Payment status', render: (o) => <span className={`lupin-pill${o.paymentStatus === 'Unpaid' ? ' lupin-pill--unpaid' : ''}`}>{o.paymentStatus}</span> },
    { key: 'act', label: 'Action', render: (o) => <Link href={`${BASE}/${o.id}`} className="admin-icon-button" aria-label={`View ${o.number}`} data-testid={`link-lupin-view-${o.id}`}><Eye size={16} aria-hidden="true" /></Link> },
  ];
  return <AdminLayout title="LUPIN"><div className="lupin">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders</p><h1>Order Management – Lupin</h1>
        <p className="admin-page-head__description">Review Lupin orders by doctor, MR and status.</p></div>
      <div className="lupin-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={exportCsv} data-testid="button-lupin-export"><Download size={15} aria-hidden="true" />Export</button>
        <Link href={`${BASE}/new`} className="admin-button" data-testid="link-lupin-add"><Plus size={16} aria-hidden="true" />Add</Link>
      </div>
    </div>
    <p className="lupin-notice" data-testid="status-lupin-demo">Fictional demo: orders live in browser memory only. Nothing is submitted, uploaded or shipped, and a reload resets everything.</p>
    {snap.notice && <div className="lupin-notice lupin-notice--ok" role="status" data-testid="lupin-notice"><span>{snap.notice}</span><button type="button" className="lupin-link" onClick={() => demoStore.setNotice('')}>Dismiss</button></div>}
    {exportError && <p className="lupin-error" role="alert">{exportError}</p>}
    <section className="admin-panel" aria-label="Lupin orders">
      <div className="lupin-filters">
        <label className="lupin-field">Search
          <span style={{ position: 'relative', display: 'block' }}><Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 11, top: 12, color: 'var(--admin-muted)' }} />
            <input style={{ paddingLeft: 33 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order, doctor or MR" data-testid="input-lupin-search" /></span></label>
        <label className="lupin-field">Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} data-testid="input-lupin-date" /></label>
        <div className="lupin-field"><label htmlFor="lupin-f-doctor">Doctor</label>
          <SearchableSelect viewportMenu id="lupin-f-doctor" label="Doctor" value={draft.doctorId} options={doctorOptions} onChange={(v) => setDraft({ ...draft, doctorId: v })} placeholder="All doctors" /></div>
        <div className="lupin-field"><span id="lupin-status-label">Order Status</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button type="button" className="lupin-status-trigger" aria-labelledby="lupin-status-label" data-testid="button-lupin-status"><span>{draft.statuses.length ? `${draft.statuses.length} selected` : 'Select statuses'}</span><ChevronDown size={15} aria-hidden="true" /></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="admin-dropdown__menu lupin-menu" data-admin-theme={theme} data-admin-appearance={appearance} align="start" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }}>
                {STATUSES.map((s) => <DropdownMenu.CheckboxItem key={s} className="admin-dropdown__item" checked={draft.statuses.includes(s)} onSelect={(e) => { e.preventDefault(); toggle(s); }} data-testid={`option-lupin-status-${s}`}>{s} Orders<DropdownMenu.ItemIndicator><Check size={15} aria-hidden="true" /></DropdownMenu.ItemIndicator></DropdownMenu.CheckboxItem>)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root></div>
        <div className="lupin-actions">
          <button type="button" className="admin-button" onClick={() => setApplied(draft)} data-testid="button-lupin-apply">Apply Filter</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-lupin-reset">Reset</button>
        </div>
      </div>
      {draft.statuses.length > 0 && <ul className="lupin-chips" aria-label="Selected statuses" style={{ listStyle: 'none', margin: 0 }}>{draft.statuses.map((s) => <li key={s} className="lupin-chip">{s} Orders<button type="button" onClick={() => toggle(s)} aria-label={`Remove ${s} Orders`}><X size={13} aria-hidden="true" /></button></li>)}</ul>}
      <div className="lupin-bar"><span aria-live="polite" data-testid="text-lupin-count">Showing {rows.length} of {snap.orders.length} orders</span></div>
      <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} label="Lupin orders (scrolls horizontally)" testIdPrefix="lupin"
        empty={<div className="lupin-empty" data-testid="empty-lupin"><ClipboardList size={28} aria-hidden="true" /><strong>{snap.orders.length ? 'No orders match' : 'No Lupin orders yet'}</strong><p>{snap.orders.length ? 'Adjust the search or filters.' : 'Add an order to begin.'}</p>{snap.orders.length ? <button type="button" className="admin-button admin-button--secondary" onClick={reset}>Reset</button> : <Link href={`${BASE}/new`} className="admin-button">Add</Link>}</div>} />
    </section>
  </div></AdminLayout>;
}
