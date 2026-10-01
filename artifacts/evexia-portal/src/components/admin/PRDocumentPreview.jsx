import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { downloadPRDocument } from '../../services/prDocuments.js';
import '../../prDocument.css';

const logoUrl = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

export default function PRDocumentPreview({ document, onClose }) {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    openerRef.current = window.document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      const opener = openerRef.current;
      if (opener?.isConnected && typeof opener.focus === 'function') {
        try {
          opener.focus({ preventScroll: true });
        } catch {
          opener.focus();
        }
      }
    };
  }, []);

  function closePreview() {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose?.();
    const opener = openerRef.current;
    if (opener?.isConnected && typeof opener.focus === 'function') {
      try {
        opener.focus({ preventScroll: true });
      } catch {
        opener.focus();
      }
    }
  }

  async function download() {
    setBusy(true);
    setError('');
    try {
      await downloadPRDocument(document, `${document.number}.pdf`, logoUrl);
    } catch (cause) {
      setError(cause?.message || 'Could not download this Purchase Received document. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const model = document.model || {};
  const lines = Array.isArray(model.lines) ? model.lines : [];
  return <dialog
    ref={dialogRef}
    className="pr-document-dialog"
    onCancel={(event) => { event.preventDefault(); closePreview(); }}
    aria-labelledby="pr-document-title"
  >
    <header className="pr-document-dialog__header">
      <div>
        <h2 id="pr-document-title">Purchase Received · {document.number}</h2>
        <p>{document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'} · Browser-local document</p>
      </div>
      <div className="pr-document-dialog__actions">
        <button
          type="button"
          className="admin-button"
          onClick={download}
          disabled={busy}
          data-testid="button-download-pr-document"
        >
          <Download size={16} aria-hidden="true" />
          {busy ? 'Preparing PDF…' : 'Download PDF'}
        </button>
        <button
          type="button"
          className="admin-button admin-button--secondary"
          onClick={closePreview}
          title="Close Purchase Received preview"
          aria-label="Close Purchase Received preview"
          data-testid="button-close-pr-document"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </header>
    <div className="pr-document-dialog__body">
      <p className="pr-document-dialog__note">
        Purchase Received record from saved receipt details only. This is not a financial invoice and does not post inventory quantities or create a stock-ledger entry.
      </p>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
      <section className="pr-document-dialog__accessible" aria-label="Purchase Received details">
        <h3>Purchase Received {document.number}</h3>
        <p>Received date: {model.receivedDate || 'Not recorded'}. Received by: {model.receivedBy || 'Not recorded'}.</p>
        <p>Purchase order: {model.poNumber || 'Not recorded'}, dated {model.poDate || 'Not recorded'}. Vendor: {model.vendorName || 'Not recorded'}, phone: {model.vendorPhone || 'Not recorded'}. Destination: {model.locationName || 'Not recorded'}.</p>
        {model.status === 'deleted' && <p>Deleted receipt, for reference only.</p>}
        {model.isDemo && <p>Sample document, preview only.</p>}
        <table>
          <caption>Received product and batch details</caption>
          <thead><tr>{['Sr. no.', 'Product', 'Ordered quantity', 'Received quantity', 'Accepted quantity', 'Rejected quantity', 'Batch number', 'Expiry date'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{lines.map((line, index) => <tr key={line.lineId || `${line.productId}-${index}`}>
            <td>{index + 1}</td>
            <th scope="row">{line.productName}</th>
            <td>{line.orderedQty}</td>
            <td>{line.receivedQty}</td>
            <td>{line.acceptedQty}</td>
            <td>{line.rejectedQty}</td>
            <td>{line.batchNo}</td>
            <td>{line.expiryDate}</td>
          </tr>)}</tbody>
        </table>
      </section>
      <div className="pr-document-pages">
        {document.pages.map((page, index) => <div
          key={index}
          className="pr-document-pages__page"
          role="img"
          aria-label={`Purchase Received ${document.number || ''}, page ${index + 1}`}
          dangerouslySetInnerHTML={{ __html: page.replaceAll('__EVEXIA_LOGO__', logoUrl) }}
        />)}
      </div>
    </div>
  </dialog>;
}