import { useState } from 'react';
import { Printer } from 'lucide-react';
import Dialog from './Dialog.jsx';
import { STOCK_DEMO_DISCLAIMER, displayStockDate, financialYearLabel, financialYearRange, formatStockPrice } from '../../services/stockStatusDemo.js';

export default function StockStatusReport({ rows, year, scope, search, category, allergenLabels, generatedAt, onClose }) {
  const [error, setError] = useState('');
  const range = financialYearRange(year);
  function print() {
    setError('');
    try { if (typeof window.print !== 'function') throw new Error('Printing is not available'); window.print(); }
    catch (e) { setError(`${e.message || 'Printing failed'}. Try your browser menu to print or save as PDF.`); }
  }
  return <Dialog className="stock-report-dialog" eyebrow="Sample report" title="Inventory Report" onClose={onClose}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-stock-report">Close</button>
      <button type="button" className="admin-button" onClick={print} disabled={!rows.length} data-testid="button-print-stock-report"><Printer size={15} /> Print / Save as PDF</button></>}>
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {!rows.length ? <div className="admin-empty" role="status"><strong>Nothing to report</strong><p>No products match the current filters.</p></div> :
    <article className="stock-report" data-testid="stock-report">
      <h1>Inventory Report - Stock Status (Sample)</h1>
      <dl className="stock-report__meta">
        <div><dt>Financial year</dt><dd>{financialYearLabel(year)} ({displayStockDate(range.from)} to {displayStockDate(range.to)})</dd></div>
        <div><dt>Search</dt><dd>{search || 'No search filter'}</dd></div>
        <div><dt>Product Category</dt><dd>{category || 'All categories'}</dd></div>
        <div><dt>Allergen scope (any selected)</dt><dd>{allergenLabels.length ? allergenLabels.join('; ') : 'All allergens'}</dd></div>
        <div><dt>{scope.label}</dt><dd>As of {displayStockDate(scope.asOf)}</dd></div>
        <div><dt>Generated</dt><dd>{generatedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
      </dl>
      <div className="stock-report-scroll" role="region" aria-label="Sample inventory report table" tabIndex={0}>
        <table><thead><tr><th>Sr.</th><th>Product</th><th>Concentration</th><th>Category</th><th>Selling price</th><th>Quantity ({scope.label})</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.productId ?? r.id}><td>{i + 1}</td><td>{r.name}<span className="stock-sub">{r.productId ?? r.id}</span></td><td>{r.concentration}</td><td>{r.category}</td><td>{formatStockPrice(r.sellingPrice)}</td><td>{r.quantity} {r.unit}</td></tr>)}</tbody></table>
      </div>
      <p className="stock-report__note">{STOCK_DEMO_DISCLAIMER}</p>
    </article>}
  </Dialog>;
}
