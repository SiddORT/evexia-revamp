import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';
import { captureExportPreferences } from '../../services/exportPreferences.js';
import { releaseBlob } from '../../services/downloadRelease.js';
import { ORDER_TRANSFER_TYPES, orderTemplate, orderTransferBlob, reviewOrderFile } from '../../services/orderTransfers.js';
import './orderTransfers.css';

export default function OrderTransfers({ kind, rows, snapshot, store }) {
  const [format, setFormat] = useState('csv');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const trigger = useRef(null);
  const summary = useRef(null);
  const title = ORDER_TRANSFER_TYPES[kind].title;
  const exportTestId = { kits: 'kits-export', lupin: 'button-lupin-export', immunotherapy: 'button-imm-export', spt: 'button-spt-export' }[kind];
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (review) summary.current?.focus(); }, [review]);
  const close = () => { generation.current++; setOpen(false); setBusy(false); setReview(null); setConfirmed(false); setError(''); setFileName(''); };
  function download(template = false) {
    setError(''); setMessage('');
    try {
      // Capture once, before generating any dates or workbook content.
      const preferences = captureExportPreferences();
      const source = template ? orderTemplate(kind) : snapshot;
      const orders = template ? source.orders : rows;
      const blob = orderTransferBlob(kind, orders, source, preferences, format);
      releaseBlob(blob, `${kind}-orders${template ? '-template' : ''}.${format}`);
      setMessage(`${template ? 'Template' : `${orders.length} filtered orders (all pages)`} handed to your browser as ${format === 'xlsx' ? 'Excel' : 'CSV'}. Attachment metadata only; no file contents.`);
    } catch (e) { setError(e.message || 'Local download could not be started. Please retry.'); }
  }
  async function read(file) {
    const token = ++generation.current;
    setReview(null); setConfirmed(false); setError(''); setMessage(''); setFileName(file?.name || '');
    if (!file) { setBusy(false); return; }
    setBusy(true);
    try {
      const next = await reviewOrderFile(kind, file, store.getSnapshot());
      if (generation.current === token) setReview(next);
    } catch (e) {
      if (generation.current === token) setError(e.message || 'The file could not be read. Use the template and try again.');
    } finally { if (generation.current === token) setBusy(false); }
  }
  function commit() {
    try {
      store.importOrders(review, confirmed);
      const text = `${review.additions} added, ${review.updates} updated, ${review.unchanged} unchanged. No orders deleted. Changes are in this session only.`;
      close(); setMessage(text);
    } catch (e) { setError(e.message || 'Import was not applied. Review the file again.'); }
  }
  return <div className="order-transfers">
    <div className="order-transfer-actions">
      <label className="order-transfer-format">File format
        <select value={format} onChange={(e) => setFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select>
      </label>
      <button type="button" className="admin-button admin-button--secondary" disabled={!rows.length} onClick={() => download()} data-testid={exportTestId}><Download size={15} aria-hidden="true" />Export</button>
      <button ref={trigger} type="button" className="admin-button admin-button--secondary" onClick={() => { setError(''); setMessage(''); setOpen(true); }}><Upload size={15} aria-hidden="true" />Import</button>
    </div>
    <p className="order-transfer-scope">Export: all {rows.length} filtered orders across all pages, not only the current page. Local session data; attachment metadata only, never file contents.</p>
    {message && <p role="status" className="order-transfer-message">{message}</p>}
    {error && !open && <p role="alert" className="order-transfer-error">{error}</p>}
    {open && <ImmDialog title={`Import ${title} orders`} eyebrow="Local transfer" description="Review the file, then confirm additions and any updates. Nothing is uploaded or submitted. Cancelling leaves this session unchanged." onClose={close} returnFocusRef={trigger} className="order-transfer-dialog">
      <div className="order-transfer-dialog-fields">
        <p>Use the eight-column template. Order details and patient relationships are JSON; keep decimal values in quoted text. Preserve the declared date context, or use ISO YYYY-MM-DD. The template contains one fictional example—replace or remove it.</p>
        <p>Keep the original order ID and number to update an order. Give a new order matching sequence identifiers. Patient directory conflicts are rejected, not overwritten. Saved recipient/billing snapshots are retained. No order is deleted because it is absent from the file.</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => download(true)}>Download {format === 'xlsx' ? 'Excel' : 'CSV'} template</button>
        <label className="admin-dialog__field">CSV or Excel file (up to 8 MB / 10,000 orders)
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {fileName && <p className="order-transfer-filename">Selected: {fileName}</p>}
        {busy && <p role="status">Reading local file…</p>}
        {error && <p role="alert" className="order-transfer-error">{error}</p>}
        {review && <section aria-label="Import review">
          <h3 ref={summary} tabIndex={-1}>File review</h3>
          <p role="status">{review.additions} additions · {review.updates} updates · {review.unchanged} unchanged · {review.rejected} rejected · {review.patientAdditions} new session patients</p>
          {!review.valid && <p role="alert" className="order-transfer-error">Nothing can be imported until every row error is corrected. Correct the file and select it again.</p>}
          <ol className="order-transfer-review">
            {review.entries.map((e, i) => <li key={`${e.line}-${i}`}>
              <strong>Row {e.line}: {e.order?.number || 'Invalid order'} — {e.errors.length ? 'Rejected' : e.action}</strong>
              {e.errors.length > 0 && <ul>{e.errors.map((s, j) => <li key={j} className="order-transfer-error">{s}</li>)}</ul>}
              {e.changed.length > 0 && <p>Changed fields: {e.changed.join(', ')}</p>}
              {e.order && <details><summary>Review full {e.previous ? 'before / after' : 'order'} details</summary>
                {e.previous && <><h4>Current order</h4><pre>{JSON.stringify(e.previous, null, 2)}</pre></>}
                <h4>Incoming order</h4><pre>{JSON.stringify(e.order, null, 2)}</pre>
                {e.patients.length > 0 && <><h4>Required session patients (including explicit history, if present)</h4><pre>{JSON.stringify(e.patients, null, 2)}</pre></>}
              </details>}
            </li>)}
          </ol>
          {review.updates > 0 && <label className="order-transfer-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I confirm replacing the {review.updates} matching existing orders with the reviewed values, including any saved order snapshots.</label>}
        </section>}
      </div>
      <div className="admin-dialog__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={close}>Cancel</button>
        <button type="button" className="admin-button" disabled={busy || !review?.valid || (review.updates > 0 && !confirmed)} onClick={commit}>Confirm import</button>
      </div>
    </ImmDialog>}
  </div>;
}
