import { downloadBlob } from '../../services/downloads.js';
import { useMemo, useState } from 'react';
import { Eye, FileDown, FileText, Info } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import StockAllergenSelect from '../../components/admin/StockAllergenSelect.jsx';
import StockStatusDetail from '../../components/admin/StockStatusDetail.jsx';
import StockStatusReport from '../../components/admin/StockStatusReport.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { STOCK_DEMO_DISCLAIMER, createStockDemo, displayStockDate, exportStockCSV, filterStock, financialYearLabel, financialYearRange, formatStockPrice, snapshotScope, stockFilterOptions } from '../../services/stockStatusDemo.js';
import '../../stockStatus.css';

export default function StockStatus() {
  const [now] = useState(() => new Date());
  const demo = useMemo(() => createStockDemo(now), [now]);
  const year = demo.currentYear;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [productIds, setProductIds] = useState([]);
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scope = useMemo(() => snapshotScope(year, now), [year, now]);
  const rows = useMemo(() => filterStock(demo, year, { search, category, productIds }), [demo, year, search, category, productIds]);
  const pg = useTablePagination(rows);
  const options = useMemo(() => stockFilterOptions(demo), [demo]);
  const range = financialYearRange(year);
  const allergenLabels = options.allergens.filter((option) => productIds.includes(option.value)).map((option) => option.label);
  function changeFilter(setter, value) {
    setter(value); pg.resetPage(); setNotice(''); setError('');
  }
  const idOf = (r) => r.productId ?? r.id;

  async function exportCsv() {
    setNotice(''); setError('');
    if (!rows.length) { setError('There are no rows to export. Change the filters and try again.'); return; }
    try {
      const blob = new Blob([exportStockCSV(rows, { year, asOf: scope.asOf })], { type: 'text/csv;charset=utf-8' });
      await downloadBlob(blob, `stock-status-sample-${financialYearLabel(year)}.csv`, { source: 'stock_status', kind: 'export', format: 'CSV' });
      setNotice(`Initiated download of ${rows.length} sample row${rows.length === 1 ? '' : 's'}.`);
    } catch (e) { setError(e.message || 'The CSV could not be downloaded.'); }
  }
  function openReport() {
    setNotice(''); setError('');
    setReport({ generatedAt: new Date() });
  }
  const columns = [
    { key: 'sr', label: 'Sr No', render: (_row, index) => index + 1 },
    { key: 'p', label: 'Product', render: (r) => <><strong className="admin-table__name">{r.name}</strong><span className="stock-sub">{idOf(r)}</span></> },
    { key: 'c', label: 'Concentration', render: (r) => r.concentration },
    { key: 'k', label: 'Category', render: (r) => r.category },
    { key: 's', label: 'Selling Price', render: (r) => formatStockPrice(r.sellingPrice) },
    { key: 'q', label: 'Quantity', render: (r) => <strong>{r.quantity} {r.unit}</strong> },
    { key: 'v', label: 'View', render: (r) => <button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setDetail(r)} aria-label={`View ${r.name} ${r.concentration}`} data-testid={`button-view-stock-${idOf(r)}`}><Eye size={14} /> View</button> },
  ];
  return <AdminLayout title="Stock Status"><div className="stock-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Stock</p><h1>Stock status</h1><p className="admin-page-head__description">Current financial year's sample quantity snapshot. Not live inventory.</p></div>
      <div className="stock-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={exportCsv} data-testid="button-export-stock"><FileDown size={15} /> Export</button>
        <button type="button" className="admin-button" onClick={openReport} data-testid="button-inventory-report"><FileText size={15} /> Inventory Report</button>
      </div></div>
    <div className="admin-feedback stock-disclaimer" role="note" data-testid="text-stock-disclaimer"><Info size={14} aria-hidden="true" /> {STOCK_DEMO_DISCLAIMER}</div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-stock-notice">{notice}</div>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-stock-error">{error}</div>}
    <section className="admin-panel stock-panel">
      <div className="admin-toolbar stock-toolbar">
        <div className="admin-filter"><label htmlFor="stock-search">Search stock</label>
          <input id="stock-search" type="search" className="admin-input" value={search} placeholder="Name, concentration, ID or category"
            onChange={(event) => changeFilter(setSearch, event.target.value)} /></div>
        <div className="admin-filter"><label htmlFor="stock-category">Product Category</label>
          <select id="stock-category" className="admin-select" value={category} onChange={(event) => changeFilter(setCategory, event.target.value)}>
            <option value="">All categories</option>{options.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        <div className="admin-filter stock-product"><label htmlFor="stock-product">Allergens</label>
          <StockAllergenSelect values={productIds} options={options.allergens} onChange={(values) => changeFilter(setProductIds, values)} /></div>
      </div>
      <div className="stock-scope" id="stock-snapshot-context" data-testid="text-stock-scope">
        <p><strong>{scope.label}</strong> · As of {displayStockDate(scope.asOf)}</p>
        <p>Current financial year {financialYearLabel(year)}: {displayStockDate(range.from)} to {displayStockDate(range.to)}. Applies to all quantities, exports and reports.</p>
      </div>
      {rows.length ? <div className="stock-list-table" aria-describedby="stock-snapshot-context"><DataTable columns={columns} rows={pg.pageRows} rowOffset={pg.startIndex} rowKey={idOf} label="Stock status" testIdPrefix="stock" /></div>
        : <div className="admin-empty" role="status"><strong>No products match these filters</strong><p>Clear the search, choose All categories or remove selected allergens. All filters apply together.</p>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => { setSearch(''); setCategory(''); changeFilter(setProductIds, []); }}>Clear all filters</button></div>}
      <TablePagination {...pg} filtered={rows.length} total={rows.length} label={rows.length === 1 ? 'product' : 'products'} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} testId="text-stock-count" />
    </section>
    {detail && <StockStatusDetail row={detail} demo={demo} year={year} onClose={() => setDetail(null)} />}
    {report && <StockStatusReport rows={rows} year={year} scope={scope} search={search.trim()} category={category} allergenLabels={allergenLabels} generatedAt={report.generatedAt} onClose={() => setReport(null)} />}
  </div></AdminLayout>;
}
