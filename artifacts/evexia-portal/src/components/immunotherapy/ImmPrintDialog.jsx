import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import ImmDialog from './ImmDialog.jsx';
import { ALLERGENS, DOCTORS, MRS, money, shippingRecipient, totalMinor } from '../../services/immunotherapyDemo.js';

export const PRINT_KINDS = [
  { key: 'bottle', label: 'Bottle labels' },
  { key: 'newbox', label: 'New box labels' },
  { key: 'oldbox', label: 'Old box labels' },
  { key: 'shipping', label: 'Shipping address' },
];

const addressText = (a) => typeof a === 'string' ? a : a ? [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';

export default function ImmPrintDialog({ kind, orders, snap, onClose, returnFocusRef }) {
  // This portal is outside the Admin shell. Copy its current semantic tokens,
  // rather than duplicating the palette or losing the selected appearance.
  const shell = document.querySelector('.admin-shell');
  const computed = shell && getComputedStyle(shell);
  const palette = {};
  if (computed) for (const key of computed) {
    if (key.startsWith('--')) palette[key] = computed.getPropertyValue(key);
  }
  const title = PRINT_KINDS.find((k) => k.key === kind)?.label || 'Labels';
  useEffect(() => { document.body.classList.add('imm-printing'); return () => document.body.classList.remove('imm-printing'); }, []);
  const byId = (list, id) => list.find((x) => x.id === id);
  const names = (list, id) => byId(list, id)?.name || 'Not recorded';
  const doctors = DOCTORS; const mrs = MRS; const allergens = ALLERGENS;
  const labels = [];
  orders.forEach((o) => {
    const patient = byId(snap.patients, o.patientId);
    if (kind === 'bottle') {
      o.groups.forEach((g, i) => labels.push({ key: `${o.id}-${g.id}`, cls: '', lines: [
        <b key="a">{o.number} - Bottle {i + 1} of {o.groups.length}</b>,
        <span key="b">{patient?.name}</span>, <br key="br1" />,
        <span key="c">Dosage {o.dosage}</span>, <br key="br2" />,
        <span key="d">{g.items.map((it) => names(allergens, it.allergenId)).join(', ') || 'No allergens'}</span>, <br key="br3" />,
        <span key="id">Suborder {g.id}</span>, <br key="br4" />,
        <span key="e">MRP INR {g.mrp || '0'}</span>] }));
    } else if (kind === 'shipping') {
      const r = shippingRecipient(o, snap.patients) || {};
      labels.push({ key: o.id, cls: 'imm-label--ship', lines: [<b key="a">Ship to: {r.name}</b>, <span key="b">{r.phone}</span>, <br key="b2" />, <span key="c">{addressText(r.address)}</span>, <br key="c2" />, <span key="d">Ref {o.number}</span>] });
    } else if (kind === 'newbox') {
      labels.push({ key: o.id, cls: '', lines: [<b key="a">{o.number}</b>, <span key="b">{patient?.name}, {patient?.age} / {patient?.gender}</span>, <br key="b2" />, <span key="c">{names(doctors, o.doctorId)} | MR {names(mrs, o.mrId)}</span>, <br key="c2" />, <span key="d">Dosage {o.dosage} | {o.groups.length} bottle(s) | {money(totalMinor(o.groups))}</span>] });
    } else {
      labels.push({ key: o.id, cls: 'imm-label--old', lines: [<b key="a">{o.number} ({o.date})</b>, <span key="b">{patient?.name}</span>, <br key="b2" />, <span key="c">Dosage {o.dosage} | {o.groups.length} bottle(s)</span>] });
    }
  });
  return createPortal(<div className="imm-print-portal" style={palette} data-admin-theme={shell?.dataset.adminTheme} data-admin-appearance={shell?.dataset.adminAppearance}>
    <ImmDialog title={`${title} preview`} eyebrow="Demo print" className="imm-dialog" onClose={onClose} returnFocusRef={returnFocusRef} testId="dialog-imm-print"
      description={`${orders.length} In process order${orders.length === 1 ? '' : 's'} selected, ${labels.length} label${labels.length === 1 ? '' : 's'}. Reference layouts only; no production dimensions or barcode compliance.`}>
      <div className="imm-labels" data-testid="imm-print-labels">
        {labels.map((l) => <div className={`imm-label ${l.cls}`} key={l.key}>{l.lines}<em>Demo - not for dispensing</em></div>)}
      </div>
      <div className="admin-dialog__actions imm-noprint">
        <button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-imm-print-close">Close</button>
        <button type="button" className="admin-button" onClick={() => window.print()} data-testid="button-imm-print-now"><Printer size={15} aria-hidden="true" />Print</button>
      </div>
    </ImmDialog>
  </div>, document.body);
}
