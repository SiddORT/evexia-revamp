import { useState } from 'react';
import Dialog from './Dialog.jsx';
import ImmunotherapyTemplateDocument from './ImmunotherapyTemplateDocument.jsx';

export default function ImmunotherapyTemplatePreviewDialog({ template, document, onClose }) {
  const [zoom, setZoom] = useState(100);
  const [fullSheet, setFullSheet] = useState(false);
  const shipping = document.type === 'shipping-address';
  return <Dialog title={template.name} eyebrow="Sample · Preview only"
    className="label-tpl-dialog" onClose={onClose}
    description="Fictional sample only, not a patient document or an issued invoice. Reference layout inspection does not enable order printing, payment or downloads."
    footer={<button type="button" className="admin-button admin-button--secondary" onClick={onClose}>Close preview</button>}>
    <div className="label-tpl-dialog__tools">
      <label htmlFor="immunotherapy-preview-zoom">Preview zoom</label>
      <select id="immunotherapy-preview-zoom" className="admin-select" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
        <option value={75}>75%</option><option value={100}>100%</option><option value={150}>150%</option><option value={200}>200%</option>
      </select>
      {shipping && <label><input type="checkbox" checked={fullSheet} onChange={(event) => setFullSheet(event.target.checked)} /> Show full reference sheet framing</label>}
      <span>Scroll horizontally and vertically to inspect the entire sample.</span>
    </div>
    <div className="label-tpl-dialog__viewport" tabIndex={0} role="region" aria-label={`Enlarged ${template.name}; scroll to inspect`}>
      <div className="label-tpl-dialog__artwork" style={{ width: 1000 * zoom / 100 }}>
        <ImmunotherapyTemplateDocument document={document} fullSheet={fullSheet} />
      </div>
    </div>
    <p className="label-tpl-dialog__note">Reference {shipping ? 'sheet' : 'dimensions'}: {document.sourceSheet.width} × {document.sourceSheet.height} {document.sourceSheet.unit}.
      {shipping && ' Panel view excludes the blank sheet remainder; full sheet view retains its upper-left position.'}
      {' '}Reference wording is for sample layout inspection, not medical validation. Defaults apply only to Settings samples in this browser.</p>
  </Dialog>;
}
