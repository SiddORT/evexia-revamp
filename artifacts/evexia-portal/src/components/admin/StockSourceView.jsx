import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Eye } from 'lucide-react';
import Dialog from './Dialog.jsx';
import ComboProvenance from './ComboProvenance.jsx';
import { useAdminDateFormatters } from './adminPreferences.js';
import { getAssembly } from '../../services/productMaster.js';
import MovementDrawer from './MovementDrawer.jsx';
import OpeningDrawer from './OpeningDrawer.jsx';
import PRDocumentPreview from './PRDocumentPreview.jsx';
import { getAdminDisplayPreferences } from './adminPreferences.js';
import { getPR } from '../../services/serverPurchaseReceived.js';
import { makePRDocument } from '../../services/prDocuments.js';
import { getAdjustment, isSuperAdmin } from '../../services/serverInventory.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMES = { receipt: 'Purchase receipt', opening: 'Opening stock', movement: 'Transfer', assembly: 'Assembly', adjustment: 'Adjustment', po: 'Purchase order' };

/** Read-only source opener. Reuses existing authorized dialogs; otherwise shows a safe plain reference. */
export default function StockSourceView({ kind, id, available, reference, testId }) {
  const { timestamp } = useAdminDateFormatters();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState('');
  const [record, setRecord] = useState(null);
  const label = reference || NAMES[kind] || 'Source';
  const usable = available === true && UUID.test(String(id || ''));
  const supported = ['receipt', 'movement', 'assembly', 'adjustment', 'po'].includes(kind) || (kind === 'opening' && isSuperAdmin());
  useEffect(() => {
    if (!open || kind !== 'receipt') return undefined;
    const c = new AbortController(); let live = true; setErr('');
    getPR(id, c.signal).then((saved) => { if (live) setDoc(makePRDocument(saved, undefined, getAdminDisplayPreferences())); })
      .catch((e) => { if (live && !c.signal.aborted) { setErr(e.message || 'The receipt could not be opened.'); setOpen(false); } });
    return () => { live = false; c.abort(); };
  }, [open, kind, id]);
  useEffect(() => {
    if (!open || !['assembly', 'adjustment'].includes(kind)) return undefined;
    const c = new AbortController(); let live = true;
    setErr(''); setRecord(null);
    (kind === 'assembly' ? getAssembly : getAdjustment)(id, c.signal)
      .then((data) => { if (live) setRecord(data); })
      .catch((e) => { if (live && !c.signal.aborted) setErr(e.message || 'Source details could not be loaded.'); });
    return () => { live = false; c.abort(); };
  }, [open, kind, id]);
  if (!usable || !supported) return <span className="stock-sub" data-testid={`text-${testId}-unavailable`}>{label}{available === false ? ' (record no longer available)' : ''}</span>;
  if (kind === 'po') return <Link href={`/admin/inventory/purchase-orders/${id}`} className="stock-source-link" data-testid={`link-${testId}`}>{label}</Link>;
  return <>
    <button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setOpen(true)} data-testid={`button-${testId}`}><Eye size={13} /> {label}</button>
    {err && <span className="stock-sub" role="alert">{err}</span>}
    {open && kind === 'movement' && <MovementDrawer id={id} onClose={() => setOpen(false)} />}
    {open && kind === 'opening' && <OpeningDrawer id={id} onClose={() => setOpen(false)} />}
    {open && doc && <PRDocumentPreview document={doc} onClose={() => { setDoc(null); setOpen(false); }} />}
    {open && ['assembly', 'adjustment'].includes(kind) && <Dialog eyebrow="Recorded inventory source" title={label} onClose={() => setOpen(false)} description={`Reference ${id}`}>
      {err ? <div className="admin-feedback admin-feedback--error" role="alert">{err}</div> : !record ? <p role="status">Loading recorded source…</p> : <>
        <p>{record.productName} · Recorded {timestamp(record.createdAt)} · {record.actor || 'Actor unavailable'}</p>
        {kind === 'assembly' ? <ComboProvenance item={{ ...record, assemblyId: record.id, comboProductId: record.productId, recipe: { version: record.version, members: record.members } }} /> : <>
          <p>{record.direction === 'add' ? 'Add' : 'Reduce'} {record.quantity} {record.unit} at {record.locationName}.</p>
          <p>Affected lot/location: {record.before} → {record.after} (change {record.delta}).</p>
          <p>Reason: {record.reason}</p>
          {record.correctionOf && <p>Correction of {record.correctionOf}</p>}
          <p>Append-only. To correct this record, create a new compensating adjustment with this reference and a reason.</p>
        </>}
      </>}
    </Dialog>}
  </>;
}
