import { useState } from 'react';
import Dialog from './Dialog.jsx';
import MRInvoiceTemplateDocument from './MRInvoiceTemplateDocument.jsx';

export default function MRInvoiceTemplatePreviewDialog({ template, document, onClose }) {
  const [zoom, setZoom] = useState(100);
  return <Dialog title={template.name} eyebrow="Sample · Not an issued invoice" className="label-tpl-dialog" onClose={onClose}
    description="Fictional doctor, patient, order and product values with illustrative totals. The QR area is a non-scannable placeholder; no payment request, printing or download."
    footer={<button type="button" className="admin-button admin-button--secondary" data-testid="button-close-mr-invoice-preview" onClick={onClose}>Close preview</button>}>
    <div className="label-tpl-dialog__tools">
      <label htmlFor="mr-invoice-preview-zoom">Preview zoom</label>
      <select id="mr-invoice-preview-zoom" className="admin-select" value={zoom} data-testid="select-mr-invoice-zoom" onChange={(event) => setZoom(Number(event.target.value))}>
        <option value={75}>75%</option><option value={100}>100%</option><option value={150}>150%</option>
      </select>
      <span>Scroll to inspect the full A4 sample.</span>
    </div>
    <div className="label-tpl-dialog__viewport" tabIndex={0} role="region" aria-label={`Enlarged ${template.name}; scroll to inspect`}>
      <div className="mri-zoom" style={{ zoom: zoom / 100 }}>
        <MRInvoiceTemplateDocument document={document} />
      </div>
    </div>
    <p className="label-tpl-dialog__note">A4 portrait sample. {document.details ? `Uses saved Invoice Details version ${document.version}.` : 'No saved Invoice Details are shown.'} The style default applies to Settings samples in this browser only.</p>
  </Dialog>;
}
