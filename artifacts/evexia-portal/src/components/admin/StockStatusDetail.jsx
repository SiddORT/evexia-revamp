import { useRef, useState, useMemo } from 'react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import TablePagination from './TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { displayStockDate, filterHistory, financialYearLabel, formatStockPrice } from '../../services/stockStatusDemo.js';

const TABS = [['purchases', 'Purchases', 'Vendor'], ['orders', 'Orders', 'Customer']];

export default function StockStatusDetail({ row, demo, year, onClose }) {
  const [tab, setTab] = useState('purchases');
  const [scope, setScope] = useState(String(year));
  const refs = useRef({});
  const [, , partyLabel] = TABS.find((t) => t[0] === tab);
  const history = useMemo(() => filterHistory(demo[tab] || [], row.productId ?? row.id, scope === 'all' ? 'all' : Number(scope)), [demo, tab, row, scope]);
  const pg = useTablePagination(history);
  function onKey(event, index) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next][0]); pg.resetPage();
    refs.current[TABS[next][0]]?.focus();
  }
  const columns = [
    { key: 'd', label: 'Date', render: (r) => displayStockDate(r.date) },
    { key: 'r', label: 'Reference', render: (r) => r.reference },
    { key: 'p', label: partyLabel, render: (r) => r.party },
    { key: 'q', label: 'Quantity', render: (r) => `${r.quantity} ${r.unit}` },
    { key: 'pr', label: 'Price / Amount', render: (r) => <>{formatStockPrice(r.price)} / {r.unit === 'bottles' ? 'bottle' : r.unit === 'kits' ? 'kit' : 'vial'}<span className="stock-sub">Amount: {formatStockPrice(r.amount)}</span></> },
    { key: 's', label: 'Status', render: (r) => <span className="stock-status">{r.status}</span> },
  ];
  return <Dialog className="stock-detail" eyebrow="Sample product history" title={row.name} onClose={onClose}
    description={`ID ${row.productId ?? row.id} · ${row.concentration} · ${row.category}. Sample data only; orders are demo sales orders, not procurement POs.`}>
    <div className="stock-detail__bar">
      <div role="tablist" aria-label="Product history" className="stock-tabs">
        {TABS.map(([k, label], i) => <button key={k} type="button" role="tab" id={`stock-tab-${k}`} aria-selected={tab === k} aria-controls="stock-tabpanel" tabIndex={tab === k ? 0 : -1} ref={(el) => { refs.current[k] = el; }} className="stock-tab" onKeyDown={(e) => onKey(e, i)} onClick={() => { setTab(k); pg.resetPage(); }} data-testid={`tab-stock-${k}`}>{label}</button>)}
      </div>
      <label className="stock-field stock-field--inline">Period
        <select className="admin-select" value={scope} onChange={(e) => { setScope(e.target.value); pg.resetPage(); }} data-testid="select-stock-history-year">
          <option value={String(year)}>{financialYearLabel(year)} (selected)</option>
          {demo.years.filter((y) => y !== year).map((y) => <option key={y} value={String(y)}>{financialYearLabel(y)}</option>)}
          <option value="all">All years</option>
        </select>
      </label>
    </div>
    <div role="tabpanel" id="stock-tabpanel" aria-labelledby={`stock-tab-${tab}`}>
      {history.length ? <DataTable columns={columns} rows={pg.pageRows} rowOffset={pg.startIndex} rowKey={(r) => r.id} label={`${tab} history`} testIdPrefix={`stock-${tab}`} />
        : <div className="admin-empty"><strong>No {tab} in this period</strong><p>Choose All years to see the full sample history.</p></div>}
      <TablePagination {...pg} filtered={history.length} total={history.length} label={tab} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} testId="text-stock-history-count" />
    </div>
  </Dialog>;
}
