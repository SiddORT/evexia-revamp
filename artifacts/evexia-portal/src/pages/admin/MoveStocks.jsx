import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeftRight, Eye, Plus } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { useMoveStocks } from '../../hooks/useMoveStocks.js';
import '../../moveStocks.css';

const BASE = '/admin/inventory/move-stocks';
const displayDate = (d) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

export default function MoveStocks() {
  const [, navigate] = useLocation();
  const { snapshot } = useMoveStocks();
  const [viewing, setViewing] = useState(null);
  const movements = snapshot.movements || [];
  const pagination = useTablePagination(movements);

  const columns = [
    { key: 'sr', label: 'Sr. No.', render: (_r, i) => <span className="admin-table__serial">{i + 1}</span> },
    { key: 'src', label: 'Source', render: (r) => r.sourceName },
    { key: 'dst', label: 'Destination', render: (r) => r.destinationName },
    { key: 'date', label: 'Date', render: (r) => displayDate(r.date) },
    { key: 'by', label: 'Delivered by', render: (r) => r.deliveredBy },
    { key: 'prod', label: 'Product list', render: (r) => <button type="button" className="admin-button admin-button--secondary" onClick={() => setViewing(r)} aria-label={`View product list, ${r.sourceName} to ${r.destinationName}, ${displayDate(r.date)}`} data-testid={`button-view-move-${r.id}`}><Eye size={14} /> View ({r.lines.length})</button> },
  ];

  return <AdminLayout title="Move Stocks"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Move stocks</p><h1>Move stocks</h1><p className="admin-page-head__description">Transfer whole vials or bottles between storage locations.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-new-move"><Plus size={16} /> Move stock</button></div></div>
    <div className="admin-feedback ms-note" role="note" data-testid="text-move-guidance">Isolated fictional inventory preview. It is frontend-only, not server-backed, and resets on a full page reload. It does not change masters, purchase orders or purchase received records. Delivered by is a typed name and is not verified.</div>
    {snapshot.notice && <div className="admin-feedback" role="status" data-testid="status-move-feedback">{snapshot.notice}</div>}
    <section className="admin-panel">
      <div className="ms-table-wrap">
        <DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(r) => r.id} label="Stock movements" testIdPrefix="move"
          empty={<div className="admin-empty"><span className="admin-empty__icon"><ArrowLeftRight size={21} /></span><strong>No stock movements yet</strong><p>Moves you record in this preview appear here.</p><button type="button" className="admin-button" style={{ marginTop: 14 }} onClick={() => navigate(`${BASE}/new`)}>Move stock</button></div>} />
      </div>
      <TablePagination {...pagination} filtered={movements.length} total={movements.length} label={movements.length === 1 ? 'movement' : 'movements'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-move-count" />
    </section>
    {viewing && <Dialog className="ms-dialog" eyebrow="Move stocks" title="Product list" description={`${viewing.sourceName} to ${viewing.destinationName}, ${displayDate(viewing.date)}. Delivered by ${viewing.deliveredBy} (not verified).`} onClose={() => setViewing(null)} footer={<button type="button" className="admin-button admin-button--secondary" onClick={() => setViewing(null)}>Close</button>}>
      <div className="admin-table-scroll"><table className="ms-lines"><thead><tr><th scope="col">Product</th><th scope="col">Quantity</th><th scope="col">Unit</th></tr></thead>
        <tbody>{viewing.lines.map((l) => <tr key={l.productId}><td>{l.productName}</td><td>{l.quantity}</td><td>{l.unit}</td></tr>)}</tbody></table></div>
    </Dialog>}
  </div></AdminLayout>;
}
