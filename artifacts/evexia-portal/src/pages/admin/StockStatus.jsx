import { useMemo, useState } from 'react';
import { Eye, FileDown, FileText, Info } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import StockStatusDetail from '../../components/admin/StockStatusDetail.jsx';
import StockStatusReport from '../../components/admin/StockStatusReport.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { STOCK_DEMO_DISCLAIMER, createStockDemo, displayStockDate, exportStockCSV, filterStock, financialYearLabel, financialYearRange, formatStockPrice, snapshotScope } from '../../services/stockStatusDemo.js';
import '../../stockStatus.css';

export default function StockStatus() {
  const [now] = useState(() => new Date());
  const demo = useMemo(() => createStockDemo(now), [now]);
  const [year, setYear] = useState(demo.currentYear);
  const [productId, setProductId] = useState('');
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scope = useMemo(() => snapshotScope(year, now), [year, now]);
  const rows = useMemo(() => filterStock(demo, year, productId), [demo, year, productId]);
  const pg = useTablePagination(rows);
  const options = useMemo(() => [{ value: '', label: 'All allergens' }, ...demo.products.map((p) => ({ value: p.id, label: `${p.name} - ${p.concentration} (${p.id})` }))], [demo]);
  const range = financialYearRange(year);
  const allergenLabel = options.find((o) => o.value === productId)?.label || 'All allergens';
  const idOf = (r) => r.productId ?? r.id;

  function exportCsv() {
    setNotice(''); setError('');
    if (!rows.length) { setError('There are no rows to export. Change the filters and try again.'); return; }
    let url;
    try {
      const blob = new Blob([exportStockCSV(rows, { year, asOf: scope.asOf })], { type: 'text/csv;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `stock-status-sample-${financialYearLabel(year)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setNotice(`Downloaded ${rows.length} sample row${rows.length === 1 ? '' : 's'}.`);
    } catch (e) { setError(e.message || 'The CSV could not be downloaded.'); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function openReport() {
    setNotice(''); setError('');
    setReport({ generatedAt: new Date() });
  }
  const columns = [
    { key: 'p', label: 'Product', render: (r) => <><strong className="admin-table__name">{r.name}</strong><span className="stock-sub">{idOf(r)}</span></> },
    { key: 'c', label: 'Concentration', render: (r) => r.concentration },
    { key: 'k', label: 'Category', render: (r) => r.category },
    { key: 's', label: 'Selling Price', render: (r) => formatStockPrice(r.sellingPrice) },
    { key: 'q', label: 'Quantity', render: (r) => <><strong>{r.quantity} {r.unit}</strong><span className="stock-sub">{scope.label}</span></> },
    { key: 'v', label: 'View', render: (r) => <button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setDetail(r)} aria-label={`View ${r.name} ${r.concentration}`} data-testid={`button-view-stock-${idOf(r)}`}><Eye size={14} /> View</button> },
  ];
  return <AdminLayout title="Stock Status"><div className="stock-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Stock</p><h1>Stock status</h1><p className="admin-page-head__description">Sample quantity snapshots by financial year. Not live inventory.</p></div>
      <div className="stock-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={exportCsv} data-testid="button-export-stock"><FileDown size={15} /> Export</button>
        <button type="button" className="admin-button" onClick={openReport} data-testid="button-inventory-report"><FileText size={15} /> Inventory Report</button>
      </div></div>
    <div className="admin-feedback stock-disclaimer" role="note" data-testid="text-stock-disclaimer"><Info size={14} aria-hidden="true" /> {STOCK_DEMO_DISCLAIMER}</div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-stock-notice">{notice}</div>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-stock-error">{error}</div>}
    <section className="admin-panel">
      <div className="admin-toolbar stock-toolbar">
        <div className="admin-filter"><label htmlFor="stock-year">Financial year</label>
          <select id="stock-year" className="admin-select" value={year} onChange={(e) => { setYear(Number(e.target.value)); pg.resetPage(); setNotice(''); setError(''); }} data-testid="select-stock-year">
            {demo.years.map((y) => <option key={y} value={y}>{financialYearLabel(y)}</option>)}</select></div>
        <div className="admin-filter stock-product"><label htmlFor="stock-product">Allergens</label>
          <SearchableSelect id="stock-product" label="Allergens" value={productId} options={options} placeholder="All allergens" onChange={(v) => { setProductId(v); pg.resetPage(); setNotice(''); setError(''); }} /></div>
        <p className="stock-scope" data-testid="text-stock-scope"><strong>{scope.label}</strong> as of {displayStockDate(scope.asOf)}. Year runs {displayStockDate(range.from)} to {displayStockDate(range.to)}.</p>
      </div>
      {rows.length ? <><DataTable columns={columns} rows={pg.pageRows} rowOffset={pg.startIndex} rowKey={idOf} label="Stock status" testIdPrefix="stock" /></>
        : <div className="admin-empty" role="status"><strong>No products match these filters</strong><p>Choose All allergens or another financial year.</p></div>}
      <TablePagination {...pg} filtered={rows.length} total={rows.length} label={rows.length === 1 ? 'product' : 'products'} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} testId="text-stock-count" />
    </section>
    {detail && <StockStatusDetail row={detail} demo={demo} year={year} onClose={() => setDetail(null)} />}
    {report && <StockStatusReport rows={rows} year={year} scope={scope} allergenLabel={allergenLabel} generatedAt={report.generatedAt} onClose={() => setReport(null)} />}
  </div></AdminLayout>;
}
