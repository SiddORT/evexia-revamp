import { useState } from 'react';
import { Printer } from 'lucide-react';
import Dialog from './Dialog.jsx';
import { formatPrice, STOCK_STATUSES } from '../../services/serverInventory.js';
import { useAdminPreferences } from './adminPreferences.js';
import { exportDisplayPreferences, formatTimestamp, effectiveTimeZone } from '../../services/datePresentation.js';

export default function StockStatusReport({ rows, asOf, coverage, search, stockStatus, category, allergenLabels, generatedAt, onClose }) {
  const preferences = exportDisplayPreferences(useAdminPreferences());
  const timestamp = (value) => formatTimestamp(value, preferences, true);
  const [error, setError] = useState('');
  function print() {
    setError('');
    try { if (typeof window.print !== 'function') throw new Error('Printing is not available'); window.print(); }
    catch (e) { setError(`${e.message || 'Printing failed'}. Try your browser menu to print or save as PDF.`); }
  }
  return <Dialog className="stock-report-dialog" eyebrow="Receipt-backed report" title="Inventory Report" onClose={onClose}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-stock-report">Close</button>
      <button type="button" className="admin-button" onClick={print} disabled={!rows.length} data-testid="button-print-stock-report"><Printer size={15} /> Print / Save as PDF</button></>}>
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    <article className="stock-report" data-testid="stock-report">
      <h1>Inventory Report - Stock Status</h1>
      <dl className="stock-report__meta">
        <div><dt>Snapshot as of ({effectiveTimeZone(preferences)})</dt><dd>{timestamp(asOf)}</dd></div>
        <div><dt>Search</dt><dd>{search || 'No search filter'}</dd></div>
        <div><dt>Stock Status</dt><dd>{STOCK_STATUSES.find((status) => status.value === stockStatus)?.label || 'All statuses'}</dd></div>
        <div><dt>Product Category</dt><dd>{category || 'All categories'}</dd></div>
        <div><dt>Allergen scope (any selected)</dt><dd>{allergenLabels.length ? allergenLabels.join('; ') : 'All allergens'}</dd></div>
        <div><dt>Sales</dt><dd>{coverage?.sales || 'unavailable: no server sales backend'}</dd></div>
        <div><dt>Openings</dt><dd>{coverage?.openings || 'outside coverage'}</dd></div>
        <div><dt>Generated ({effectiveTimeZone(preferences)})</dt><dd>{timestamp(generatedAt)}</dd></div>
      </dl>
      {!rows.length ? <div className="admin-empty" role="status"><strong>Nothing to report</strong><p>No products match the filters saved with this snapshot.</p></div> :
      <div className="stock-report-scroll" role="region" aria-label="Inventory report table" tabIndex={0}>
        <table><thead><tr><th>Sr.</th><th>Product</th><th>Concentration</th><th>Category</th><th>Selling price</th><th>Quantity on hand</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.productId}><td>{i + 1}</td><td>{r.name}<span className="stock-sub">{r.productId}</span></td><td>{r.concentration}</td><td>{r.category}</td><td>{formatPrice(r.sellingPrice)}</td><td className="inv-mono">{r.quantity} {r.unit}</td></tr>)}</tbody></table>
      </div>}
      <p className="stock-report__note">{coverage?.contract}</p>
    </article>
  </Dialog>;
}
