import { useRef, useState } from 'react';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useLocation } from 'wouter';
import { ArrowLeftRight, ChevronDown, Eye, Filter, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import MovementDrawer from '../../components/admin/MovementDrawer.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import { listReference } from '../../services/serverInventory.js';
import { useMoveStocks } from '../../hooks/useMoveStocks.js';
import '../../mr.css';
import '../../allergen.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';

const BASE = '/admin/inventory/move-stocks';
const UNALLOCATED = [{ value: 'unallocated', label: 'Unallocated (opening stock, no location)' }];

export default function MoveStocks() {
  const can = useResourceActions('stock_movement');
  const { date: displayDate } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const m = useMoveStocks();
  const [viewing, setViewing] = useState(null);
  const viewTrigger = useRef(null);

  const columns = [
    { key: 'sr', label: 'Sr. No.', render: (_r, i) => <span className="admin-table__serial">{i + 1}</span> },
    { key: 'src', label: 'Source', render: (r) => r.source.name },
    { key: 'dst', label: 'Destination', render: (r) => r.destination.name },
    { key: 'date', label: 'Date', render: (r) => displayDate(r.date) },
    { key: 'by', label: 'Delivered by', render: (r) => r.deliveredBy },
    { key: 'items', label: 'Items', render: (r) => `${r.lines.length} lot${r.lines.length === 1 ? '' : 's'}` },
    { key: 'act', label: 'Actions', render: (r) => <button id={`movement-view-${r.id}`} type="button" className="admin-button admin-button--secondary" onClick={(event) => { viewTrigger.current = event.currentTarget; setViewing(r.id); }} aria-label={`View details, ${r.source.name} to ${r.destination.name}, ${displayDate(r.date)}`} title="View movement details" data-testid={`button-view-move-${r.id}`}><Eye size={14} aria-hidden="true" /></button> },
  ];

  return <AdminLayout title="Move Stocks"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Move stocks</p><h1>Move stocks</h1><p className="admin-page-head__description">Append-only transfers of receipt lots between storage locations.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button" disabled={!can.create} onClick={() => navigate(`${BASE}/new`)} data-testid="button-new-move"><Plus size={16} /> Move stock</button></div></div>
    <section className="admin-panel" aria-label="Stock movement list">
      <div className="admin-allergen-toolbar">
        <div className="admin-allergen-toolbar__top master-filter-toolbar">
          <div className="admin-allergen-toolbar__search-group">
            <button type="button" className="admin-button admin-button--secondary" disabled={m.loading} onClick={m.reload}>Refresh records</button>
            <div className="admin-filter admin-allergen-filters__search"><label className="admin-search" htmlFor="move-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search movements by location, delivered by or product</span>
              <input id="move-search" type="search" maxLength={200} value={m.query} onChange={(e) => m.setQuery(e.target.value)} placeholder="Location, delivered by or product" /></label></div>
          </div>
          <MasterFilterReset disabled={!m.query && !m.activeFilters} onClick={m.resetFilters} />
        </div>
        <details className="admin-allergen-filter-disclosure">
          <summary><Filter size={15} aria-hidden="true" /> Filter records{m.activeFilters > 0 && ` · ${m.activeFilters} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
          <div className="admin-allergen-filters ms-list-filters">
            <div className="admin-filter"><label htmlFor="move-source-filter">Source</label><ReferenceSelect id="move-source-filter" label="Source" kind="movement-sources" fetchPage={listReference} pinned={UNALLOCATED} value={m.source?.value || ''} selected={m.source} onChange={(_v, o) => m.setSource(o || null)} placeholder="All sources" /></div>
            <div className="admin-filter"><label htmlFor="move-destination-filter">Destination</label><ReferenceSelect id="move-destination-filter" label="Destination" kind="movement-destinations" fetchPage={listReference} value={m.destination?.value || ''} selected={m.destination} onChange={(_v, o) => m.setDestination(o || null)} placeholder="All destinations" /></div>
            <div className="admin-filter"><label htmlFor="move-allergen-filter">Allergens</label><ReferenceSelect id="move-allergen-filter" label="Allergens" kind="movement-allergens" fetchPage={listReference} multiple selections={m.allergens} onChange={m.setAllergens} placeholder="All allergens — search to select" /><p className="mr-form__hint">Matches any selected allergen, including saved assembly recipes. Finished-product openings without a saved recipe have no inferred allergen members.</p></div>
          </div>
        </details>
      </div>
      {m.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{m.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={m.reload}>Retry</button></div>}
      <div className="ms-table-wrap">
        {!m.error && <DataTable columns={columns} rows={m.rows} rowOffset={m.startIndex} rowKey={(r) => r.id} label="Stock movements" testIdPrefix="move" loading={m.loading}
          empty={<div className="admin-empty"><span className="admin-empty__icon"><ArrowLeftRight size={21} /></span><strong>{m.query || m.activeFilters ? 'No movements match' : 'No stock movements yet'}</strong><p>{m.query || m.activeFilters ? 'Change the search or reset filters to see every movement.' : 'Committed server movements appear here.'}</p>{can.create && !m.query && !m.activeFilters && <button type="button" className="admin-button" style={{ marginTop: 14 }} onClick={() => navigate(`${BASE}/new`)}>Move stock</button>}</div>} />}
      </div>
      {!m.error && <TablePagination page={m.page} pageCount={m.pageCount} pageSize={m.pageSize} filtered={m.filtered} total={m.total} label={m.filtered === 1 ? 'movement' : 'movements'} onPageChange={m.setPage} onPageSizeChange={m.setPageSize} testId="text-move-count" />}
    </section>
    {viewing && <MovementDrawer id={viewing} returnFocusTo={viewTrigger.current} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
