import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { ClipboardList, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import { demoStore, money, totalMinor } from '../../services/sptOrdersDemo.js';
import '../../sptOrders.css';

const BASE = '/admin/orders/spt';

export default function SptOrders() {
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return snap.orders.filter((o) => (status === 'All' || o.status === status)
      && (!q || `${o.number} ${o.doctorName} ${o.mrName}`.toLocaleLowerCase().includes(q)));
  }, [snap.orders, search, status]);
  const clear = () => { setSearch(''); setStatus('All'); };

  const columns = [
    { key: 'number', label: 'Order no.', render: (o) => <strong>{o.number}</strong> },
    { key: 'date', label: 'Date', render: (o) => o.date },
    { key: 'doctor', label: 'Doctor', render: (o) => o.doctorName || 'Not chosen' },
    { key: 'mr', label: 'MR', render: (o) => o.mrName || 'Not chosen' },
    { key: 'count', label: 'Patients', render: (o) => o.patients.length },
    { key: 'total', label: 'Total (INR)', render: (o) => <span className="spt-num">{money(totalMinor(o.patients))}</span> },
    { key: 'status', label: 'Status', render: (o) => <span className={`admin-badge${o.status === 'Draft' ? ' admin-badge--inactive' : ''}`}>{o.status}</span> },
    { key: 'action', label: 'Action', render: (o) => <Link className="spt-link" href={`${BASE}/${o.id}`} data-testid={`link-spt-open-${o.id}`}>{o.status === 'Draft' ? 'Resume' : 'Review'}<span className="sr-only"> {o.number}</span></Link> },
  ];

  return (
    <AdminLayout title="SPT">
      <div className="spt">
        <div className="admin-page-head">
          <div>
            <p className="admin-page-head__eyebrow">Orders</p>
            <h1>SPT</h1>
            <p className="admin-page-head__description">Evaluate the order entry workflow with sample data.</p>
          </div>
          <Link href={`${BASE}/new`} className="admin-button" data-testid="link-spt-add-order"><Plus size={16} aria-hidden="true" />Add Order</Link>
        </div>
        <p className="spt-boundary" data-testid="status-spt-demo">Mock only: doctors, MRs, patients and orders here are fictional and kept in browser memory. Nothing is submitted, paid or fulfilled, and a page reload resets the demo.</p>
        {snap.notice && <div className="spt-notice" role="status" data-testid="status-spt-feedback"><span>{snap.notice}</span><button type="button" onClick={() => demoStore.setNotice('')}>Dismiss</button></div>}
        <section className="admin-panel" aria-label="SPT orders">
          <div className="spt-filters">
            <label className="spt-field spt-field--grow">Search orders
              <span style={{ position: 'relative', display: 'block' }}>
                <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--admin-muted)' }} />
                <input className="spt-input" style={{ paddingLeft: 36 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order number, doctor or MR" data-testid="input-spt-search" />
              </span>
            </label>
            <div className="spt-field"><label htmlFor="spt-filter-status">Status</label>
              <select id="spt-filter-status" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-spt-status">
                <option>All</option><option>Draft</option><option>Saved</option>
              </select>
            </div>
          </div>
          {rows.length > 0 && <p className="spt-scroll-hint">Scroll horizontally to see all columns. Keyboard: focus the table region and use arrow keys.</p>}
          <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} label="SPT orders" testIdPrefix="spt"
            empty={<div className="spt-empty" data-testid="empty-spt-orders"><ClipboardList size={28} aria-hidden="true" /><strong>{snap.orders.length ? 'No orders match' : 'No SPT orders yet'}</strong><p>{snap.orders.length ? 'Try a different search or status.' : 'Add a mock order to try the workflow.'}</p>{snap.orders.length ? <button type="button" className="admin-button admin-button--secondary" onClick={clear}>Clear filters</button> : <Link href={`${BASE}/new`} className="admin-button">Add Order</Link>}</div>} />
          <div className="spt-count" aria-live="polite">{rows.length} of {snap.orders.length} orders</div>
        </section>
      </div>
    </AdminLayout>
  );
}
