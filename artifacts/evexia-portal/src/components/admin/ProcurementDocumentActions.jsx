import { useEffect, useRef, useState } from 'react';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { FileDown, FileSearch, History } from 'lucide-react';
import { getDocumentHistory, getSavedDocument, downloadSavedDocument } from '../../services/savedProcurementDocuments.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import POInvoicePreview from './POInvoicePreview.jsx';
import PRDocumentPreview from './PRDocumentPreview.jsx';
import '../../poActivityDrawer.css';
import '../../procurementHistory.css';

const labels = {
  poDate: 'PO date', expectedDate: 'Expected delivery', receivedDate: 'Received date',
  vendorName: 'Vendor', locationName: 'Storage location', receivedBy: 'Recorded receiver (not editor)',
  receiverMode: 'Receiver type', status: 'Record status', subtotal: 'Taxable subtotal',
  gstAmount: 'GST amount', total: 'Total', productName: 'Product', quantity: 'Quantity',
  unitPrice: 'Unit price', gst: 'GST %', orderedQty: 'Ordered quantity', receivedQty: 'Received quantity',
  acceptedQty: 'Accepted quantity', rejectedQty: 'Rejected quantity', balanceAfterQty: 'Historical balance after receipt',
  batchNo: 'Batch', expiryDate: 'Expiry', placeOfSupplyName: 'Place of supply',
  supplierGstin: 'Supplier GSTIN', treatment: 'Tax treatment', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', utgst: 'UTGST',
  vendorId: 'Vendor reference', locationId: 'Storage location reference', productId: 'Product reference', staffId: 'Recorded receiver staff reference',
};
const omit = new Set(['id', 'version', 'createdAt', 'updatedAt', 'deletedAt', 'activeReceiptCount', 'source',
  'fulfillment', 'lineId', 'poId', 'documentRevision',
  'supplierStateCode', 'placeOfSupplyCode', 'supplierStateName', 'componentRates']);
function FieldChange({ name, before, after }) {
  return <li className="procurement-history__change">
    <strong>{name}</strong>
    <dl className="procurement-history__values">
      <div><dt>Before</dt><dd>{before}</dd></div>
      <div><dt>After</dt><dd>{after}</dd></div>
    </dl>
  </li>;
}

function Changes({ before, after, action }) {
  const { date } = useAdminDateFormatters();
  if (!after) return <p>Previous and current values unavailable for this legacy event.</p>;
  const text = (key, value) => {
    if (value == null) return 'Unavailable / not recorded';
    if (['poDate', 'expectedDate', 'receivedDate', 'expiryDate'].includes(key)) return date(value);
    if (['subtotal', 'gstAmount', 'total', 'cgst', 'sgst', 'utgst', 'igst'].includes(key) && typeof value === 'number') {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
    }
    return String(value);
  };
  const changes = [];
  function fields(old, next, prefix = '', keyPrefix = '') {
    for (const key of new Set([...Object.keys(old || {}), ...Object.keys(next || {})])) {
      if (omit.has(key) || key === 'lines') continue;
      const a = old?.[key], b = next?.[key];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const name = `${prefix}${labels[key] || key.replace(/([A-Z])/g, ' $1')}`;
      if ((a && typeof a === 'object') || (b && typeof b === 'object')) fields(a, b, `${name} / `, `${keyPrefix}${key}/`);
      else changes.push(<FieldChange key={`${keyPrefix}${prefix}${key}`} name={name} before={text(key, a)} after={text(key, b)} />);
    }
  }
  fields(before, after);
  const oldLines = before?.lines || [], nextLines = after.lines || [];
  const identity = (line) => line.lineId || line.id;
  for (const line of oldLines) {
    const next = nextLines.find((item) => identity(item) === identity(line));
    if (!next) {
      changes.push(<li className="procurement-history__line procurement-history__line--removed" key={`removed-${identity(line)}`}><strong>− Removed line: {line.productName}</strong></li>);
      fields(line, {}, `Removed ${line.productName} / `, `${identity(line)}/`);
    } else {
      fields(line, next, `${line.productName} / `, `${identity(line)}/`);
      const oldPosition = oldLines.indexOf(line) + 1, newPosition = nextLines.indexOf(next) + 1;
      if (oldPosition !== newPosition) changes.push(<FieldChange key={`position-${identity(line)}`} name={`${line.productName} / Line position`} before={oldPosition} after={newPosition} />);
    }
  }
  for (const line of nextLines) {
    if (!oldLines.some((item) => identity(item) === identity(line))) {
      changes.push(<li className="procurement-history__line procurement-history__line--added" key={`added-${identity(line)}`}><strong>+ Added line: {line.productName}</strong></li>);
      fields({}, line, `${line.productName} / `, `${identity(line)}/`);
    }
  }
  return <>{!before && action !== 'created' && <p className="procurement-history__notice">Prior values were not reliably saved. The following are known current values, not proof of every historical change.</p>}
    {changes.length ? <ul className="procurement-history__changes">{changes}</ul> : <p>No business-field differences recorded.</p>}</>;
}

function ChangesDrawer({ kind, record, onClose, openDocument, actionError, actionBusy }) {
  const can = useResourceActions(kind === 'po' ? 'purchase_order' : 'purchase_received');
  const { timestamp } = useAdminDateFormatters();
  const dialog = useRef(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const element = dialog.current, opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => { element.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError('');
    getDocumentHistory(kind, record.id, offset, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPage(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [kind, record.id, offset, nonce]);
  return <dialog ref={dialog} className="po-activity-drawer procurement-history" aria-labelledby="saved-changes-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="po-activity-drawer__header"><div><p className="po-activity-drawer__number">{record.number}</p><h2 id="saved-changes-title">Changes history</h2></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={onClose} autoFocus aria-label="Close changes history" data-testid="button-close-procurement-history">Close</button></header>
    <div className="po-activity-drawer__body">
      <p className="procurement-history__notice">Server audit history · oldest first. Editors are authenticated accounts; the PR receiver is a separate recorded person. Older documents may be unavailable.</p>
      {actionBusy && <p role="status">Loading saved document…</p>}
      {actionError && <p role="alert">{actionError} Use the same document link to retry.</p>}
      {error ? <p role="alert">{error} <button type="button" className="admin-button admin-button--secondary" data-testid="button-retry-procurement-history" onClick={() => setNonce((n) => n + 1)}>Retry history</button></p>
        : !page ? <p role="status">Loading changes…</p>
          : <>{page.items.map((event) => <article className="procurement-history__event" key={event.id} data-testid={`card-procurement-history-${event.id}`}>
            <header className="procurement-history__event-header">
              <h3><span className="procurement-history__action">{event.action}</span><span className="procurement-history__revision">{event.revision ? `Revision ${event.revision}` : 'Legacy / lifecycle event'}</span></h3>
              <p className="procurement-history__metadata"><time dateTime={event.at}>{timestamp(event.at, true)}</time><span>Authenticated editor: <strong>{event.actor || 'Unavailable'}</strong></span></p>
            </header>
            <p className="procurement-history__summary">{event.summary}</p>
            <section className="procurement-history__details" aria-label="Recorded field changes">
              <h4>Field changes</h4><Changes before={event.before} after={event.after} action={event.action} />
            </section>
            <div className="procurement-history__documents">
              <div role="group" aria-label="Previous document"><h4>Previous document</h4>
                {event.previousRevision ? <><button type="button" disabled={!can.print} className="po-link" data-testid={`button-view-previous-${event.id}`} onClick={(e) => openDocument(event.previousRevision, false, e.currentTarget)}>View previous document</button>
                  <button type="button" disabled={!can.print} className="po-link" data-testid={`button-download-previous-${event.id}`} onClick={(e) => openDocument(event.previousRevision, true, e.currentTarget)}>Download previous PDF</button></> : <p>Previous document unavailable</p>}
              </div>
              <div role="group" aria-label="Saved document"><h4>Saved document</h4>
                {event.revision ? <><button type="button" disabled={!can.print} className="po-link" data-testid={`button-view-saved-${event.id}`} onClick={(e) => openDocument(event.revision, false, e.currentTarget)}>View saved document</button>
                  <button type="button" disabled={!can.print} className="po-link" data-testid={`button-download-saved-${event.id}`} onClick={(e) => openDocument(event.revision, true, e.currentTarget)}>Download saved PDF</button></> : <p>Document unavailable; no historical layout was saved</p>}
              </div>
            </div>
          </article>)}
            {!page.items.length && <p>No changes recorded.</p>}
            <nav className="procurement-history__pagination" aria-label="Changes history pages"><button type="button" className="admin-button admin-button--secondary" data-testid="button-previous-procurement-history" disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 10))}>Previous changes</button>
              <span data-testid="text-procurement-history-count">{page.total} events</span><button type="button" className="admin-button admin-button--secondary" data-testid="button-next-procurement-history" disabled={offset + page.items.length >= page.total} onClick={() => setOffset((n) => n + 10)}>Next changes</button></nav></>}
    </div>
  </dialog>;
}

/** Shared entry points used in listing Actions and saved record detail pages. */
export default function ProcurementDocumentActions({ kind, record, iconOnly = false }) {
  const can = useResourceActions(kind === 'po' ? 'purchase_order' : 'purchase_received');
  const [history, setHistory] = useState(false);
  const [document, setDocument] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(null);
  const sequence = useRef(0);
  const documentOpener = useRef(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; sequence.current++; };
  }, [record.id]);
  async function open(revision, download = false, focusElement) {
    if (!can.print || (revision !== undefined && !can.history)) {
      setError('Print / Download PDF permission is required. Archived revisions also require View History.');
      return;
    }
    if (busy) return;
    if (focusElement) documentOpener.current = focusElement;
    const seq = ++sequence.current;
    setBusy(true); setError(''); setRetry({ revision, download });
    try {
      const saved = await getSavedDocument(kind, record.id, revision);
      if (!active.current || sequence.current !== seq) return;
      if (download) await downloadSavedDocument(saved);
      else setDocument(saved);
    } catch (cause) {
      if (active.current && sequence.current === seq) setError(`${cause.message} The business record remains saved. Retry reading/rendering; do not save another edit.`);
    } finally { if (active.current && sequence.current === seq) setBusy(false); }
  }
  const Preview = kind === 'po' ? POInvoicePreview : PRDocumentPreview;
  const actionClass = iconOnly ? 'po-icon-action' : 'po-link';
  return <span className={`po-document-actions${iconOnly ? ' po-document-actions--icons' : ''}`}>
    <span className="po-actions" role="group" aria-label={`${record.number} document actions`}>
      <button type="button" className={actionClass} aria-label={`View document for ${record.number}`} title={iconOnly ? `View document for ${record.number}` : undefined} disabled={busy || !can.print} onClick={(e) => open(undefined, false, e.currentTarget)}>{iconOnly ? <FileSearch size={17} aria-hidden="true" /> : 'View document'}</button>
      <button type="button" className={actionClass} aria-label={`Download PDF for ${record.number}`} title={iconOnly ? `Download PDF for ${record.number}` : undefined} disabled={busy || !can.print} onClick={(e) => open(undefined, true, e.currentTarget)}>{iconOnly ? <FileDown size={17} aria-hidden="true" /> : 'Download PDF'}</button>
      <button type="button" className={actionClass} aria-label={`Changes history for ${record.number}`} title={iconOnly ? `Changes history for ${record.number}` : undefined} disabled={!can.history} onClick={() => setHistory(true)}>{iconOnly ? <History size={17} aria-hidden="true" /> : 'Changes history'}</button>
    </span>
    {busy && <span role="status">Loading saved document…</span>}
    {error && <span role="alert">{error} <button type="button" className="po-link" disabled={busy} onClick={(e) => open(retry?.revision, retry?.download, e.currentTarget)}>Retry document</button></span>}
    {history && can.history && <ChangesDrawer kind={kind} record={record} onClose={() => { sequence.current++; setBusy(false); setHistory(false); }} openDocument={open} actionError={error} actionBusy={busy} />}
    {document && can.print && <Preview document={document} returnFocusElement={documentOpener.current} onClose={() => setDocument(null)} />}
  </span>;
}
