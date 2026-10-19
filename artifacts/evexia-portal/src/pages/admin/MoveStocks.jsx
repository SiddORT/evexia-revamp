import { useState } from 'react';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useLocation } from 'wouter';
import { ArrowLeftRight, Eye, Plus } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import MovementDrawer from '../../components/admin/MovementDrawer.jsx';
import { useMoveStocks } from '../../hooks/useMoveStocks.js';
import '../../moveStocks.css';
import '../../inventoryServer.css';

const BASE = '/admin/inventory/move-stocks';

export default function MoveStocks() {
  const { date: displayDate } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const m = useMoveStocks();
  const [viewing, setViewing] = useState(null);

  const columns = [
    { key: 'sr', label: 'Sr. No.', render: (_r, i) => <span className="admin-table__serial">{i + 1}</span> },
    { key: 'src', label: 'Source', render: (r) => r.source.name },
    { key: 'dst', label: 'Destination', render: (r) => r.destination.name },
    { key: 'date', label: 'Date', render: (r) => displayDate(r.date) },
    { key: 'by', label: 'Delivered by', render: (r) => r.deliveredBy },
    { key: 'items', label: 'Items', render: (r) => `${r.lines.length} lot${r.lines.length === 1 ? '' : 's'}` },
    { key: 'act', label: 'Actions', render: (r) => <button type="button" className="admin-button admin-button--secondary" onClick={() => setViewing(r.id)} aria-label={`View details, ${r.source.name} to ${r.destination.name}, ${displayDate(r.date)}`} title="View movement details" data-testid={`button-view-move-${r.id}`}><Eye size={14} aria-hidden="true" /></button> },
  ];

  return <AdminLayout title="Move Stocks"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Move stocks</p><h1>Move stocks</h1><p className="admin-page-head__description">Append-only transfers of receipt lots between storage locations.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" disabled={m.loading} onClick={m.reload}>Refresh</button><button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-new-move"><Plus size={16} /> Move stock</button></div></div>
    <div className="admin-feedback ms-note" role="note" data-testid="text-move-guidance">Committed movements cannot be edited or deleted. Quantities are procurement quantity units, exact to 0.001.</div>
    {m.summary && <div className="admin-feedback" role="status" data-testid="status-move-feedback">{m.summary.movements} matching movement{m.summary.movements === 1 ? '' : 's'}, {m.summary.lots} lot line{m.summary.lots === 1 ? '' : 's'}. {m.summary.scope}</div>}
    <section className="admin-panel">
      <div className="admin-toolbar"><div className="admin-filter"><label htmlFor="move-search">Search movements</label>
        <input id="move-search" type="search" className="admin-input" value={m.query} onChange={(e) => m.setQuery(e.target.value)} placeholder="Location, delivered by or product" /></div></div>
      {m.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{m.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={m.reload}>Retry</button></div>}
      <div className="ms-table-wrap">
        {!m.error && <DataTable columns={columns} rows={m.rows} rowOffset={m.startIndex} rowKey={(r) => r.id} label="Stock movements" testIdPrefix="move" loading={m.loading}
          empty={<div className="admin-empty"><span className="admin-empty__icon"><ArrowLeftRight size={21} /></span><strong>{m.query ? 'No movements match this search' : 'No stock movements yet'}</strong><p>{m.query ? 'Clear the search to see every movement.' : 'Committed server movements appear here.'}</p>{!m.query && <button type="button" className="admin-button" style={{ marginTop: 14 }} onClick={() => navigate(`${BASE}/new`)}>Move stock</button>}</div>} />}
      </div>
      {!m.error && <TablePagination page={m.page} pageCount={m.pageCount} pageSize={m.pageSize} filtered={m.filtered} total={m.total} label={m.filtered === 1 ? 'movement' : 'movements'} onPageChange={m.setPage} onPageSizeChange={m.setPageSize} testId="text-move-count" />}
    </section>
    {viewing && <MovementDrawer id={viewing} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
