import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import POInvoiceDocument from './POInvoiceDocument.jsx';
import { PO_TEMPLATES } from '../../services/poInvoiceTemplates.js';
import { downloadInvoiceDocument } from '../../services/poInvoicePdf.js';
import '../../poInvoice.css';

export default function POInvoicePreview({ document, onClose }) {
  const dialogRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { dialog.close(); };
  }, []);
  async function download() {
    setBusy(true);
    setError('');
    try {
      await downloadInvoiceDocument(document, `${document.number}.pdf`, `${import.meta.env.BASE_URL}images/evexia-logo.png`);
    } catch (cause) { setError(cause.message || 'Could not download this PO invoice. Please try again.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialogRef} className="po-invoice-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="po-invoice-title">
    <header className="po-invoice-dialog__header">
      <div><h2 id="po-invoice-title">PO invoice · {document.number}</h2>
        <p>{PO_TEMPLATES.find((template) => template.id === document.templateId)?.name} · {document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'}</p></div>
      <div className="po-actions"><button type="button" className="admin-button" onClick={download} disabled={busy} data-testid="button-download-po-invoice"><Download size={16} aria-hidden="true" />{busy ? 'Preparing PDF…' : 'Download PDF'}</button>
        <button type="button" className="po-action" onClick={onClose} title="Close invoice preview" aria-label="Close invoice preview" data-testid="button-close-po-invoice"><X size={20} aria-hidden="true" /></button></div>
    </header>
    <div className="po-invoice-dialog__body">
      <p className="po-invoice-dialog__note">Purchase order document, not a supplier tax invoice. Address, GST number and HSN codes use current saved masters; amounts use this saved PO.</p>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
      <POInvoiceDocument document={document} />
    </div>
  </dialog>;
}