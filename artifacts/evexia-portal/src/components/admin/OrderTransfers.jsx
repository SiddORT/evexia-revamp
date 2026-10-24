import { useEffect, useRef, useState } from 'react';
import { useOrderActions, useOrderPortal } from '../orders/OrderPortalContext.jsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, Upload } from 'lucide-react';
import { useAdminPreferences } from './adminPreferences.js';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';
import { captureExportPreferences } from '../../services/exportPreferences.js';
import { releaseBlob } from '../../services/downloadRelease.js';
import { ORDER_TRANSFER_TYPES, orderTemplate, orderTransferBlob, reviewOrderFile } from '../../services/orderTransfers.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import './orderTransfers.css';

export default function OrderTransfers(props) {
  const { portal } = useOrderPortal();
  // Presentation only: retain the listing header and Add Order, not transfers.
  if (portal === 'mr') return props.renderActions ? props.renderActions(null) : null;
  return <AdminOrderTransfers {...props} />;
}

function AdminOrderTransfers({ kind, rows, snapshot, store, adapter, total, renderActions }) {
  const can = useOrderActions(kind);
  const { theme, appearance } = useAdminPreferences();
  const [format, setFormat] = useState('csv');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const committing = useRef(false);
  const generation = useRef(0);
  const trigger = useRef(null);
  const summary = useRef(null);
  const title = ORDER_TRANSFER_TYPES[kind].title;
  const exportTestId = { kits: 'kits-export', lupin: 'button-lupin-export', immunotherapy: 'button-imm-export', spt: 'button-spt-export' }[kind];
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!adapter || !open) return undefined;
    return setNavigationGuard(() => {
      if (!committing.current && !uncertain) return false;
      setError('Keep this review open until the same import has a confirmed outcome. Retry the unchanged import safely.');
      return true;
    });
  }, [Boolean(adapter), open, uncertain]);
  useEffect(() => { if (review) summary.current?.focus(); }, [review]);
  const close = () => { if (committing.current || uncertain) return; generation.current++; setOpen(false); setBusy(false); setReview(null); setConfirmed(false); setError(''); setFileName(''); };
  async function download(template = false, selectedFormat = format) {
    if (!(template ? can.import : can.export)) { setError('Your saved role does not allow this transfer. The current review is preserved.'); return; }
    if (exportBusy.current) return;
    exportBusy.current = true;
    setExporting(true);
    setError(''); setMessage('');
    try {
      // Capture once, before generating any dates or workbook content.
      const preferences = captureExportPreferences();
      if (adapter) {
        const blob = await adapter.download(template, preferences, selectedFormat);
        const filename = `${kind}-orders${template ? '-template' : ''}.${selectedFormat}`;
        if (adapter.release) await adapter.release(blob, filename, template, selectedFormat);
        else releaseBlob(blob, filename);
        setMessage(adapter.downloadMessage?.(template) || (template ? 'Blank server-order template downloaded. Use real master IDs; attachment metadata does not restore files.' : 'All authoritative filtered saved orders downloaded, including historical snapshots. File contents excluded.'));
        return;
      }
      const source = template ? orderTemplate(kind) : snapshot;
      const orders = template ? source.orders : rows;
      const blob = orderTransferBlob(kind, orders, source, preferences, selectedFormat);
      releaseBlob(blob, `${kind}-orders${template ? '-template' : ''}.${selectedFormat}`);
      setMessage(`${template ? 'Template' : `${orders.length} filtered orders (all pages)`} handed to your browser as ${selectedFormat === 'xlsx' ? 'Excel' : 'CSV'}. Attachment metadata only; no file contents.`);
    } catch (e) { setError(e.message || 'Local download could not be started. Please retry.'); }
    finally { exportBusy.current = false; setExporting(false); }
  }
  async function read(file) {
    if (!can.import) { setError('Import is not allowed by your saved role. The current review is preserved.'); return; }
    const token = ++generation.current;
    setReview(null); setConfirmed(false); setError(''); setMessage(''); setFileName(file?.name || '');
    if (!file) { setBusy(false); return; }
    setBusy(true);
    try {
      const next = adapter ? await adapter.review(file) : await reviewOrderFile(kind, file, store.getSnapshot());
      if (generation.current === token) setReview(next);
    } catch (e) {
      if (generation.current === token) setError(e.message || 'The file could not be read. Use the template and try again.');
    } finally { if (generation.current === token) setBusy(false); }
  }
  async function commit() {
    if (!can.import) { setError('Import is not allowed by your saved role. The current review is preserved.'); return; }
    if (committing.current) return;
    try {
      committing.current = true; setBusy(true);
      if (adapter) await adapter.commit(review, confirmed);
      else store.importOrders(review, confirmed);
      const text = `${review.additions} added, ${review.updates} updated, ${review.unchanged} unchanged. No orders deleted. ${adapter ? (adapter.savedMessage || 'Saved atomically on the shared server. Attachment metadata did not restore files.') : 'Changes are in this session only.'}`;
      committing.current = false; setUncertain(false);
      // Close explicitly after a confirmed response, including a safe retry.
      generation.current++; setOpen(false); setBusy(false); setReview(null); setConfirmed(false); setError(''); setFileName('');
      setMessage(text);
    } catch (e) {
      const outcomeUnknown = Boolean(adapter && (e.ambiguous || (adapter.retainUncertain && uncertain)));
      committing.current = false; setBusy(false); setUncertain(outcomeUnknown);
      setError(`${e.message || 'Import was not applied. Review the file again.'}${outcomeUnknown ? ' Keep this review open and retry the identical confirmed import; do not create a new batch.' : ''}`);
    }
  }
  const actions = <div className="order-transfer-actions">
      <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(nextOpen) => { if (!nextOpen || !exportBusy.current) setExportMenuOpen(nextOpen); }}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="admin-button admin-button--secondary" disabled={!can.export || (adapter ? total === 0 : !rows.length)} aria-disabled={exporting || undefined} data-testid={exportTestId}><Download size={15} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export'}</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label={`${title} export format`}>
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting || !can.export} onSelect={() => { setFormat('csv'); void download(false, 'csv'); }}>CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting || !can.export} onSelect={() => { setFormat('xlsx'); void download(false, 'xlsx'); }}>Excel (.xlsx)</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button ref={trigger} type="button" disabled={!can.import} className="admin-button admin-button--secondary" onClick={() => { setError(''); setMessage(''); setOpen(true); }}><Upload size={15} aria-hidden="true" />Import</button>
    </div>;
  return <div className="order-transfers">
    {renderActions ? renderActions(actions) : actions}
    {kind !== 'immunotherapy' && kind !== 'kits' && <p className="order-transfer-scope">{adapter
      ? (adapter.scope || 'Export: saved server orders matching the currently applied filters across all pages, not only this section. Attachment metadata only; file contents are not included.')
      : `Export: all ${rows.length} filtered orders across all pages, not only the current page. Local session data; attachment metadata only, never file contents.`}</p>}
    {message && <p role="status" className="order-transfer-message">{message}</p>}
    {error && !open && <p role="alert" className="order-transfer-error">{error}</p>}
    {open && <ImmDialog title={`Import ${title} orders`} eyebrow={adapter ? 'Shared server transfer' : 'Local transfer'} description={adapter ? (adapter.description || 'Review validates real master references on the server. Explicit confirmation saves the entire batch atomically. External names and snapshots are not trusted; masters are never created.') : 'Review the file, then confirm additions and any updates. Nothing is uploaded or submitted. Cancelling leaves this session unchanged.'} onClose={close} returnFocusRef={trigger} className="order-transfer-dialog">
      <div className="order-transfer-dialog-fields">
        <p>{adapter?.instructions || <>Use the eight-column template. Order details and patient relationships are JSON; keep decimal values in quoted text. Preserve the declared date context, or use ISO YYYY-MM-DD. {adapter ? 'The template is blank; use real master UUIDs, supported dosage/results and nonempty bottles. Legacy PO numbers are ignored.' : 'The template contains one fictional example—replace or remove it.'}</>}</p>
        <p>{adapter?.matching || <>{adapter ? 'Keep original order ID, number and exported version for matching updates. For new orders, leave ID and number blank; numbering is server assigned. Legacy patient/snapshot columns are ignored, not used to create masters. Attachment metadata cannot restore uploads: existing saved file associations remain unchanged and new orders import without files.' : 'Keep the original order ID and number to update an order. Give a new order matching sequence identifiers. Patient directory conflicts are rejected, not overwritten. Saved recipient/billing snapshots are retained.'} No order is deleted because it is absent from the file.</>}</p>
        <label className="order-transfer-format">Template file format
          <select value={format} disabled={exporting} onChange={(e) => setFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select>
        </label>
        <button type="button" className="admin-button admin-button--secondary" disabled={exporting || !can.import} onClick={() => download(true)}>Download {format === 'xlsx' ? 'Excel' : 'CSV'} template</button>
        <label className="admin-dialog__field">CSV or Excel file ({adapter ? 'up to 8 MB / 500 orders; validated JSON up to 1 MiB' : 'up to 8 MB / 10,000 orders'})
          <input type="file" disabled={!can.import || (Boolean(adapter) && (busy || uncertain))} accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {fileName && <p className="order-transfer-filename">Selected: {fileName}</p>}
        {busy && <p role="status">Reading local file…</p>}
        {error && <p role="alert" className="order-transfer-error">{error}</p>}
        {review && <section aria-label="Import review">
          <h3 ref={summary} tabIndex={-1}>File review</h3>
          <p role="status">{review.additions} additions · {review.updates} updates · {review.unchanged} unchanged · {review.rejected} rejected · {adapter ? 'No masters created' : `${review.patientAdditions} new session patients`}</p>
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
          {review.updates > 0 && <label className="order-transfer-confirm"><input type="checkbox" disabled={busy || uncertain} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I confirm updating the {review.updates} matching existing orders with the reviewed values{adapter ? ', retaining historical snapshots unless relationships change.' : ', including any saved order snapshots.'}</label>}
        </section>}
      </div>
      <div className="admin-dialog__actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(adapter) && (busy || uncertain)} onClick={close}>Cancel</button>
        <button type="button" className="admin-button" disabled={!can.import || busy || !review?.valid || (review.updates > 0 && !confirmed)} onClick={commit}>Confirm import</button>
      </div>
    </ImmDialog>}
  </div>;
}
