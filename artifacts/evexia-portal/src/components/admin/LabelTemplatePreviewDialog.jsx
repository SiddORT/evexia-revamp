import { useState } from 'react';
import Dialog from './Dialog.jsx';
import LabelTemplateDocument from './LabelTemplateDocument.jsx';

export default function LabelTemplatePreviewDialog({ template, document, onClose }) {
  const [zoom, setZoom] = useState(100);
  // A natural-width sheet with explicit zoom stays readable on narrow screens by
  // scrolling within the dialog, not by shrinking its text to fit the viewport.
  const naturalWidth = document.type === 'bottle' ? 1600 : 900;
  return <Dialog title={template.name} eyebrow="Sample · Preview only"
    className="label-tpl-dialog" onClose={onClose}
    description="Fictional sample details, not for patient use. Inspect the reference layout only; no order print or download action is enabled."
    footer={<button type="button" className="admin-button admin-button--secondary" data-testid="button-close-label-preview" onClick={onClose}>Close preview</button>}>
    <div className="label-tpl-dialog__tools">
      <label htmlFor="label-preview-zoom">Preview zoom</label>
      <select id="label-preview-zoom" className="admin-select" value={zoom} data-testid="select-label-preview-zoom" onChange={(event) => setZoom(Number(event.target.value))}>
        <option value={75}>75%</option><option value={100}>100%</option><option value={150}>150%</option><option value={200}>200%</option>
      </select>
      <span>Scroll horizontally and vertically to inspect every panel.</span>
    </div>
    <div className="label-tpl-dialog__viewport" tabIndex={0} role="region" aria-label="Enlarged sample label; scroll to inspect all panels" data-testid="region-label-preview">
      <div className="label-tpl-dialog__artwork" style={{ width: naturalWidth * zoom / 100 }}>
        <LabelTemplateDocument document={document} />
      </div>
    </div>
    <p className="label-tpl-dialog__note">Source sheet: {document.sourceSheet.width} × {document.sourceSheet.height} pt. Blank sheet remainder is excluded from this preview. Reference wording is reproduced for layout review, not medically validated.</p>
  </Dialog>;
}
