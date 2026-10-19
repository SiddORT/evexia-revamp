import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ArrowLeft, ClipboardCheck, Download, Eye, History, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminDateFormatters, getAdminDisplayPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import InfoDisclosure from '../../components/admin/InfoDisclosure.jsx';
import ReceiptReferenceSelect from '../../components/admin/ReceiptReferenceSelect.jsx';
import ReceiptRetryRecovery from '../../components/admin/ReceiptRetryRecovery.jsx';
import { setNavigationGuard, interceptNavigation } from '../../auth/navigationGuard.js';
import PRDocumentPreview from '../../components/admin/PRDocumentPreview.jsx';
import { getPOFulfillment, getPR, sourcePR, activityPR, reviewPR, savePR, removePR, validateDraftPR, inputPR, pendingPR, rememberPR, forgetPR, reconcilePR, ownerPR } from '../../services/serverPurchaseReceived.js';
import { downloadPRDocument, makePRDocument } from '../../services/prDocuments.js';
import '../../mr.css';
import '../../purchaseOrders.css';
import '../../purchaseReceived.css';

const BASE = '/admin/inventory/purchase-received';
const PO_BASE = '/admin/inventory/purchase-orders';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const q3 = (n) => String(Math.round(Number(n) * 1000) / 1000);
const num = (v) => (String(v).trim() === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const fclass = (f) => f === 'Closed' ? 'pr-tag pr-tag--closed' : f === 'Open' ? 'pr-tag pr-tag--open' : 'pr-tag';

function rowsFor(po, receipt) {
  return po.lines.map((line) => {
    const saved = receipt?.lines.find((l) => l.lineId === line.id);
    return { lineId: line.id, receivedQty: saved ? String(saved.receivedQty) : '', acceptedQty: saved ? String(saved.acceptedQty) : '', batchNo: saved?.batchNo || '', expiryDate: saved?.expiryDate || '' };
  });
}

function Editor({ snapshot, receipt, initialPoId, onSaved, onCancel, onRefresh, onDraftDirty, onSaveStateChange, saveBlocked }) {
  const { date: displayDate } = useAdminDateFormatters();
  const isNew = !receipt;
  const [orders, setOrders] = useState(snapshot.poRecord.orders);
  const receipts = snapshot.record.receipts;
  const activeReceipts = receipts.filter((r) => r.status === 'active');
  const eligible = (o) => o.status === 'open' && getPOFulfillment(o, activeReceipts) !== 'Closed';
  const requested = orders.find((o) => o.id === (receipt?.poId || initialPoId));
  const initialPo = receipt ? requested : requested && eligible(requested) ? requested : undefined;
  const poProblem = receipt || !initialPoId ? '' : !requested ? 'The purchase order in this link is unavailable. Choose another purchase order below.'
    : requested.status !== 'open' ? `${requested.number} is deleted and cannot receive goods. Choose another purchase order below.`
    : !eligible(requested) ? `${requested.number} is already fully received (Closed), so there is nothing left to receive. Choose another purchase order below.` : '';
  const makeInitial = () => ({ poId: initialPo?.id || '', receivedDate: receipt?.receivedDate || today(),
    receiverMode: receipt?.receiverMode || 'staff', staff: receipt?.staffId ? { id: receipt.staffId, name: receipt.receivedBy } : null,
    otherName: receipt?.receiverMode === 'other' ? receipt.receivedBy : '', rows: initialPo ? rowsFor(initialPo, receipt) : [] });
  const baseline = useRef(JSON.stringify(makeInitial()));
  const [values, setValues] = useState(makeInitial);
  const [errors, setErrors] = useState({});
  const [review, setReview] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [otherPending, setOtherPending] = useState(null);
  const attempt = useRef(null);
  const owner = useRef(ownerPR());
  const sourceSeq = useRef(0);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const po = orders.find((o) => o.id === values.poId);
  const vendorPhone = receipt ? receipt.vendorPhone : snapshot.refs.vendors.find((v) => v.id === po?.vendorId)?.phoneNo;
  const balances = po?.balances || {};
  const dirty = JSON.stringify(values) !== baseline.current;

  useEffect(() => { onDraftDirty(dirty || Boolean(review)); }, [dirty, review, onDraftDirty]);
  function clear(...keys) { setErrors((c) => { const n = { ...c, form: undefined }; keys.forEach((k) => { n[k] = undefined; }); return n; }); setSaveError(''); }
  async function choosePo(item) {
    if (busy || uncertain || otherPending) return;
    const seq = ++sourceSeq.current;
    setSourceLoading(true); setReview(null); setErrors({}); setSaveError('');
    setValues((c) => ({ ...c, poId: item?.id || '', rows: [] }));
    try {
      if (!item) return;
      const next = await sourcePR(item.id);
      if (seq !== sourceSeq.current) return;
      setOrders([next]);
      setValues((c) => ({ ...c, poId: next.id, rows: rowsFor(next, null) }));
    } catch (cause) { if (seq === sourceSeq.current) setSaveError(cause.message); }
    finally { if (seq === sourceSeq.current) setSourceLoading(false); }
  }
  const missingRows = po ? po.lines.filter((l) => !values.rows.some((r) => r.lineId === l.id)) : [];
  function restoreRows() {
    const fresh = rowsFor(po, receipt);
    setValues((c) => ({ ...c, rows: po.lines.map((l) => c.rows.find((r) => r.lineId === l.id) || fresh.find((r) => r.lineId === l.id)) }));
    setErrors({}); setSaveError('');
  }
  function setRow(i, field, value) {
    setValues((c) => ({ ...c, rows: c.rows.map((r, k) => k === i ? { ...r, [field]: value } : r) }));
    clear(`lines.${i}.${field}`, 'lines');
  }
  const payload = () => inputPR(values);
  async function prepare(e) {
    e.preventDefault();
    if (saveBlocked || busyRef.current || uncertain || otherPending || sourceLoading) return;
    const errors = validateDraftPR(values, po, receipt);
    setErrors(errors);
    if (Object.keys(errors).length) { document.getElementById('pr-form-errors')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busyRef.current = true; setBusy(true); onSaveStateChange(true);
    try {
      const result = await reviewPR(payload(), receipt?.id);
      setReview({ ...result.receipt, token: result.reviewToken }); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) { setSaveError(cause.message); }
    finally { busyRef.current = false; setBusy(false); onSaveStateChange(false); }
  }
  async function save() {
    if (busyRef.current || saveBlocked || !review) return;
    busyRef.current = true; setBusy(true); onSaveStateChange(true); setSaveError('');
    let journaled = uncertain;
    try {
      if (ownerPR() !== owner.current) throw new Error('The signed-in account changed. This draft cannot be saved by another account.');
      if (uncertain) {
        const outcome = await reconcilePR(attempt.current.key);
        await forgetPR(attempt.current.key); attempt.current = null; setUncertain(false);
        if (outcome.state === 'committed') { navigation.current = {}; onSaved(outcome.receipt); return; }
        setReview(null); setSaveError('The previous request did not commit and has been safely closed. Your draft is kept; review again.'); return;
      }
      attempt.current = attempt.current || { key: crypto.randomUUID(), id: receipt?.id || null, operation: receipt ? 'edit' : 'create' };
      await rememberPR(attempt.current);
      journaled = true;
      const next = await savePR(payload(), review.token, attempt.current.key, receipt);
      await forgetPR(attempt.current.key); attempt.current = null;
      navigation.current = {};
      onSaved(next);
    } catch (cause) {
      if (!journaled) {
        attempt.current = null; setSaveError(cause.message);
        try {
          const pending = pendingPR();
          if (pending) { setOtherPending(pending); setReview(null); }
        } catch { /* Nothing was sent; the explicit storage error stays visible. */ }
        return;
      }
      if (attempt.current) {
        if (cause.ambiguous || !cause.status || cause.status >= 500) {
          setUncertain(true); setSaveError('The server did not confirm the outcome. Check this same request before editing or leaving.');
        } else {
          try { await forgetPR(attempt.current.key); attempt.current = null; } catch { setUncertain(true); }
          if (!attempt.current) setReview(null);
          setSaveError(cause.message);
        }
      } else setSaveError(cause.message);
    }
    finally { busyRef.current = false; setBusy(false); onSaveStateChange(Boolean(attempt.current)); }
  }
  const navigation = useRef({});
  navigation.current = { busy, uncertain: uncertain || !!otherPending, dirty };
  useEffect(() => {
    const guard = () => navigation.current.busy || navigation.current.uncertain || (navigation.current.dirty && !window.confirm('Discard unsaved receipt changes?'));
    const release = setNavigationGuard(guard);
    const unload = (e) => { if (Object.values(navigation.current).some(Boolean)) { e.preventDefault(); e.returnValue = ''; } };
    const links = (e) => { if (e.target.closest?.('a[href]') && guard()) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', links, true);
    return () => { release(); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', links, true); sourceSeq.current++; };
  }, []);
  useEffect(() => { onSaveStateChange(busy || uncertain || !!otherPending); }, [busy, uncertain, otherPending]);
  function requestRefresh() { if (busy || uncertain || otherPending) return; if (dirty || review) setConfirmRefresh(true); else onRefresh(); }
  function cancel() {
    if (busy || uncertain || otherPending) return;
    if (dirty && !window.confirm('Discard unsaved receipt changes?')) return;
    navigation.current = {}; onCancel();
  }
  const err = (i, f) => errors[`lines.${i}.${f}`];
  const summary = review || null;
  async function resolvedOther() {
    setOtherPending(null); setReview(null);
    setSaveError('The other receipt request is resolved. Your draft is kept; review it again.');
    if (values.poId) {
      const seq = ++sourceSeq.current; setSourceLoading(true);
      try { const source = await sourcePR(values.poId, receipt?.id); if (seq === sourceSeq.current) setOrders([source]); }
      catch (error) { if (seq === sourceSeq.current) setSaveError(error.message); }
      finally { if (seq === sourceSeq.current) setSourceLoading(false); }
    }
  }

  return <section className="admin-panel" aria-label={isNew ? 'New purchase received' : 'Edit purchase received'}>
    {otherPending && <ReceiptRetryRecovery pending={otherPending} onResolved={resolvedOther} />}
    <div className="po-form-intro"><div><h2>{review ? 'Review before saving' : 'Receipt details'}</h2>{review && <p>Nothing has been saved yet. Check batches, quantities and balances.</p>}</div><ClipboardCheck size={21} color="var(--admin-accent)" aria-hidden="true" /></div>
    {saveError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ margin: 18 }}>{saveError} <button type="button" className="po-link" onClick={requestRefresh} data-testid="button-refresh-pr-draft">Refresh records</button></div>}
    {review ? <>
      <div className="po-review pr-lines-content"><p className="po-review__note">Server-reviewed receipt. Confirming saves receiving only; it does not update a stock ledger or notify a supplier.</p>
        <dl className="po-detail-grid"><div><dt>PO</dt><dd>{review.poNumber}</dd></div><div><dt>Vendor</dt><dd>{review.vendorName}</dd></div><div><dt>Destination</dt><dd>{review.locationName}</dd></div><div><dt>Received date</dt><dd>{displayDate(review.receivedDate)}</dd></div><div><dt>Received by</dt><dd>{review.receivedBy}</dd></div></dl>
        <h3 className="po-section-title">Lines <span>{summary.lines.length} to save</span></h3>
      <div className="pr-grid" tabIndex={0} role="region" aria-label="Receipt lines"><table><thead><tr><th>Sr. No.</th><th>Product</th><th>Ordered</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Batch No.</th><th>Expiry</th><th>Balance after</th></tr></thead>
         <tbody>{summary.lines.map((l, i) => <tr key={l.lineId}><td>{i + 1}</td><td><strong>{l.productName}</strong></td><td>{l.orderedQty}</td><td>{l.receivedQty}</td><td>{l.acceptedQty}</td><td>{l.rejectedQty}</td><td>{l.batchNo}</td><td>{displayDate(l.expiryDate)}</td><td>{l.balanceAfterQty ?? 'Unavailable'}</td></tr>)}</tbody></table></div>
      </div>
       <div className="po-form-footer"><span>Saved only after server confirmation.</span><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={() => { setReview(null); setSaveError(''); }} data-testid="button-back-pr-draft">Back to draft</button><button type="button" className="admin-button" disabled={busy || saveBlocked} onClick={save} data-testid="button-confirm-pr">{busy ? 'Checking…' : uncertain ? 'Check save outcome' : isNew ? 'Create receipt' : 'Save changes'}</button></div></div>
    </> : <form onSubmit={prepare} noValidate>
      <fieldset className="po-form-body pr-editor-fields" disabled={busy || uncertain || !!otherPending}>
        {(errors.form || errors.lines || Object.keys(errors).some((k) => errors[k] && k.startsWith('lines.'))) && <div id="pr-form-errors" className="admin-feedback admin-feedback--error" role="alert">{errors.form || errors.lines || 'Check the highlighted receipt rows before continuing.'}</div>}
        <h3 className="po-section-title">01 / Receipt information <span>Linked purchase order and receiver</span></h3>
        <div className="po-fields pr-receipt-fields">
          <div className="po-field"><label htmlFor="pr-po">Purchase order <span className="mr-form__required">*</span></label>
            {isNew ? <ReceiptReferenceSelect id="pr-po" kind="orders" label="Purchase order" selected={values.poId ? { id: values.poId, name: po?.number || 'Loading source…' } : null} onChange={choosePo} placeholder="Select purchase order" invalid={Boolean(errors.poId)} describedBy={errors.poId ? 'pr-po-error' : undefined} disabled={busy || uncertain} /> : <input id="pr-po" className="mr-form__control" value={po?.number || receipt.poNumber} readOnly aria-readonly="true" />}
            {errors.poId && <p id="pr-po-error" className="mr-form__error" role="alert">{errors.poId}</p>}{!isNew && <p className="mr-form__hint">The linked PO is fixed.</p>}</div>
          <div className="po-field"><label htmlFor="pr-date">Received date <span className="mr-form__required">*</span></label><input id="pr-date" type="date" className="mr-form__control" min={po?.poDate} value={values.receivedDate} onChange={(e) => { setValues((c) => ({ ...c, receivedDate: e.target.value })); clear('receivedDate'); }} aria-invalid={Boolean(errors.receivedDate)} aria-describedby={errors.receivedDate ? 'pr-date-error' : undefined} data-testid="input-pr-date" />{errors.receivedDate && <p id="pr-date-error" className="mr-form__error" role="alert">{errors.receivedDate}</p>}</div>
          <div className="po-field">
            <InfoDisclosure id="pr-receiver-info" title="Received by" text="Named receiver only. The authenticated person saving this receipt is recorded separately."><label htmlFor="pr-by">Received by <span className="mr-form__required">*</span></label></InfoDisclosure>
            <ReceiptReferenceSelect id="pr-by" kind="staff" label="Staff receiver or Others" selected={values.receiverMode === 'other' ? { id: 'other', name: 'Others' } : values.staff} placeholder="Search staff or select Others" disabled={busy || uncertain}
              invalid={values.receiverMode === 'staff' && Boolean(errors.receivedBy)} describedBy={values.receiverMode === 'staff' && errors.receivedBy ? 'pr-by-error' : undefined}
              onChange={(staff) => { setValues((c) => ({ ...c, receiverMode: staff?.id === 'other' ? 'other' : 'staff', staff: staff?.id === 'other' ? null : staff, otherName: '' })); clear('receivedBy'); }} />
            {values.receiverMode === 'staff' && errors.receivedBy && <p id="pr-by-error" className="mr-form__error" role="alert">{errors.receivedBy}</p>}</div>
          {values.receiverMode === 'other' && <div className="po-field"><label htmlFor="pr-other">Person’s name <span className="mr-form__required">*</span></label><input id="pr-other" className="mr-form__control" required maxLength={120} value={values.otherName} aria-invalid={Boolean(errors.receivedBy)} aria-describedby={errors.receivedBy ? 'pr-by-error' : undefined} onChange={(e) => { setValues((c) => ({ ...c, otherName: e.target.value, staff: null })); clear('receivedBy'); }} />
            {errors.receivedBy && <p id="pr-by-error" className="mr-form__error" role="alert">{errors.receivedBy}</p>}</div>}
        </div>
        {poProblem && !po && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="text-pr-po-problem">{poProblem}</div>}
        {po && <dl className="pr-ctx"><div><dt>Vendor</dt><dd>{receipt ? receipt.vendorName : po.vendorName}{(vendorPhone || !isNew) && <span className="po-secondary">{vendorPhone || 'No mobile on record'}</span>}</dd></div><div><dt>Deliver to</dt><dd>{receipt ? receipt.locationName : po.locationName}</dd></div><div><dt>PO date</dt><dd>{displayDate(po.poDate)} <span className={fclass(getPOFulfillment(po, activeReceipts))}>{getPOFulfillment(po, activeReceipts)}</span></dd></div></dl>}
        {sourceLoading && <p role="status">Loading server PO and available quantities…</p>}
        <hr className="po-divider" />
        <h3 className="po-section-title">02 / Product rows <span>Leave received blank or zero to skip a row</span></h3>
        {!isNew && <p className="mr-form__hint" role="note">If later receipts accepted previously rejected units, you can retain or reduce this receipt’s historical received quantity when correcting it. Accepted quantity still cannot exceed the balance after other active receipts; new or increased receiving remains limited by that balance.</p>}
        {missingRows.length > 0 && po && <button type="button" className="admin-button admin-button--secondary" style={{ marginBottom: 10 }} onClick={restoreRows} data-testid="button-restore-pr-rows">Restore removed rows ({missingRows.length})</button>}
        {!po ? <div className="admin-empty"><strong>Select a purchase order</strong><p>Its product rows will load here.</p></div> : values.rows.length === 0 ? <div className="admin-empty"><strong>No rows left</strong><p>Every row was removed. Use Restore removed rows to bring them back.</p></div> :
          <div className="pr-grid" role="region" aria-label="Receipt rows" tabIndex={0}><table><thead><tr><th>Sr. No.</th><th>Product name</th><th>Ordered</th><th>Balance</th><th>Batch No.</th><th>Received</th><th>Accepted</th><th>Expiry date</th><th>Rejected</th><th>Remove</th></tr></thead>
            <tbody>{values.rows.map((r, i) => {
              const line = po.lines.find((l) => l.id === r.lineId); const avail = balances[r.lineId] ?? 0;
              const rej = num(r.receivedQty) - num(r.acceptedQty);
              return <tr key={r.lineId}><td>{i + 1}</td><td><strong>{line?.productName}</strong>{err(i, 'lineId') && <p className="mr-form__error" role="alert">{err(i, 'lineId')}</p>}</td><td>{line?.quantity}</td>
                <td><strong>{q3(avail)}</strong><small>After: {q3(avail - num(r.acceptedQty))}</small></td>
                <td><input className="mr-form__control" value={r.batchNo} onChange={(e) => setRow(i, 'batchNo', e.target.value)} aria-label={`Batch number, row ${i + 1}`} aria-invalid={Boolean(err(i, 'batchNo'))} data-testid={`input-pr-batch-${i}`} />{err(i, 'batchNo') && <p className="mr-form__error" role="alert">{err(i, 'batchNo')}</p>}</td>
                <td><input className="mr-form__control" type="number" min="0" step="0.001" value={r.receivedQty} onChange={(e) => setRow(i, 'receivedQty', e.target.value)} aria-label={`Received quantity, row ${i + 1}`} aria-invalid={Boolean(err(i, 'receivedQty'))} data-testid={`input-pr-received-${i}`} />{err(i, 'receivedQty') && <p className="mr-form__error" role="alert">{err(i, 'receivedQty')}</p>}</td>
                <td><input className="mr-form__control" type="number" min="0" step="0.001" value={r.acceptedQty} onChange={(e) => setRow(i, 'acceptedQty', e.target.value)} aria-label={`Accepted quantity, row ${i + 1}`} aria-invalid={Boolean(err(i, 'acceptedQty'))} data-testid={`input-pr-accepted-${i}`} />{err(i, 'acceptedQty') && <p className="mr-form__error" role="alert">{err(i, 'acceptedQty')}</p>}</td>
                <td><input className="mr-form__control" type="date" value={r.expiryDate} min={values.receivedDate} onChange={(e) => setRow(i, 'expiryDate', e.target.value)} aria-label={`Expiry date, row ${i + 1}`} aria-invalid={Boolean(err(i, 'expiryDate'))} data-testid={`input-pr-expiry-${i}`} />{err(i, 'expiryDate') && <p className="mr-form__error" role="alert">{err(i, 'expiryDate')}</p>}</td>
                <td><strong>{q3(rej)}</strong><small>Stays outstanding</small></td>
                <td><button type="button" className="po-action po-action--danger" onClick={() => { setValues((c) => ({ ...c, rows: c.rows.filter((_, k) => k !== i) })); setErrors({}); }} aria-label={`Remove row ${i + 1}`} data-testid={`button-remove-pr-line-${i}`}><X size={14} /></button></td></tr>;
            })}</tbody></table></div>}
      </fieldset>
       <div className="po-form-footer"><span>Review the receipt before it is saved.</span><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={requestRefresh} data-testid="button-refresh-pr-form"><RefreshCw size={14} /> Refresh</button><button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={cancel} data-testid="button-cancel-pr">Cancel</button><button type="submit" className="admin-button" disabled={saveBlocked || busy || uncertain || sourceLoading} data-testid="button-review-pr">{busy ? 'Reviewing…' : 'Review receipt'}</button></div></div>
    </form>}
    {confirmRefresh && <ConfirmationDialog title="Discard this draft?" description="Refreshing reloads saved purchase orders and receipts and discards everything you have entered here. Use it only if the data is stale." actionLabel="Refresh and discard" destructive onConfirm={onRefresh} onClose={() => setConfirmRefresh(false)} />}
  </section>;
}

export default function PurchaseReceivedFormPage({ id }) {
  const { date: displayDate, timestamp: stamp } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const search = useSearch();
  const isNew = !id || id === 'new';
  const requestedPoId = new URLSearchParams(search).get('poId') || '';
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [showActivity, setShowActivity] = useState(false);
  const [doc, setDoc] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [draftPoId, setDraftPoId] = useState(requestedPoId);
  const [draftDirty, setDraftDirty] = useState(false);
  const [pendingPoId, setPendingPoId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingNotice, setSavingNotice] = useState(false);
  const savingRef = useRef(false);
  const sourceRestorePendingRef = useRef(false);
  const loadSeq = useRef(0);
  const [recovery, setRecovery] = useState(() => { try { return { pending: pendingPR() }; } catch (e) { return { error: e.message }; } });
  const [reloadTick, setReloadTick] = useState(0);
  const leaving = useRef({});
  leaving.current = { deleting, unresolved: !!recovery.pending || !!recovery.error };
  useEffect(() => {
    if (isNew || editing) return;
    const release = setNavigationGuard(() => leaving.current.deleting || leaving.current.unresolved);
    const unload = (e) => { if (leaving.current.deleting || leaving.current.unresolved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { release(); window.removeEventListener('beforeunload', unload); };
  }, [isNew, editing]);
  function go(path) { if (!interceptNavigation({ kind: 'href', href: path })) navigate(path); }

  useEffect(() => {
    if (!isNew) return;
    if (requestedPoId === draftPoId) {
      sourceRestorePendingRef.current = false;
      setPendingPoId(null);
    } else if (sourceRestorePendingRef.current) {
      setPendingPoId(null);
      navigate(`${BASE}/new${draftPoId ? `?poId=${encodeURIComponent(draftPoId)}` : ''}`, { replace: true });
    } else if (savingRef.current) {
      setSavingNotice(true);
      restoreDraftSource();
    } else if (draftDirty) {
      setPendingPoId(requestedPoId);
    } else {
      setDraftPoId(requestedPoId);
      setPendingPoId(null);
    }
  }, [isNew, requestedPoId, draftPoId, draftDirty, navigate]);

  async function refresh() {
    if (savingRef.current || deleting) return;
    const seq = ++loadSeq.current;
    try {
      const receipt = isNew ? null : await getPR(id);
      const poId = receipt?.poId || draftPoId;
      const source = poId ? await sourcePR(poId, receipt?.id) : null;
      const activity = receipt ? await activityPR({ receipt_id: receipt.id, status: 'all', limit: 100 }) : { items: [], filtered: 0 };
      if (seq !== loadSeq.current) return;
      setSnapshot({ record: { receipts: source?.receipts || [], events: activity.items, eventTotal: activity.filtered }, poRecord: { orders: source ? [source] : [] }, refs: { vendors: [] } });
      setLoadError(''); setActionError(''); setEditing(false); setConfirmDelete(false); setDraftDirty(false); setVersion((v) => v + 1);
    } catch (cause) { if (seq === loadSeq.current) { setSnapshot(null); setLoadError(cause.message || 'Purchase received could not be loaded.'); } }
  }
  useEffect(() => { refresh(); return () => { loadSeq.current++; }; }, [id, draftPoId, reloadTick]);
  const record = isNew ? null : snapshot?.record.receipts.find((r) => r.id === id);
  const sampleReceipt = false;
  const events = [...(snapshot?.record.events || [])].reverse().filter((e) => e.receiptId === id);
  const po = record && snapshot?.poRecord.orders.find((o) => o.id === record.poId);
  const fulfil = po ? getPOFulfillment(po, snapshot.record.receipts.filter((r) => r.status === 'active')) : '';

  function saved(next) {
    sourceRestorePendingRef.current = false;
    setSnapshot((s) => ({ ...s, record: { ...s.record, receipts: [next, ...s.record.receipts.filter((r) => r.id !== next.id)] } }));
    setEditing(false); setDraftDirty(false); setPendingPoId(null); setNotice(isNew ? 'Receipt created on the server.' : 'Receipt updated on the server.');
    savingRef.current = false;
    if (isNew) navigate(`${BASE}/${encodeURIComponent(next.id)}`); else refresh();
  }
  function saveStateChanged(nextSaving) {
    savingRef.current = nextSaving;
    setSaving(nextSaving);
    if (!nextSaving) setSavingNotice(false);
  }
  function restoreDraftSource() {
    sourceRestorePendingRef.current = true;
    setPendingPoId(null);
    navigate(`${BASE}/new${draftPoId ? `?poId=${encodeURIComponent(draftPoId)}` : ''}`, { replace: true });
  }
  function keepDraft() {
    restoreDraftSource();
  }
  function switchPo() {
    if (savingRef.current) {
      setSavingNotice(true);
      restoreDraftSource();
      return;
    }
    if (pendingPoId === null) return;
    setDraftPoId(pendingPoId);
    setDraftDirty(false);
    setPendingPoId(null);
  }
  async function remove() {
    if (deletingRef.current) return; deletingRef.current = true; setDeleting(true);
    const attempt = { key: crypto.randomUUID(), id, operation: 'delete' };
    let journaled = false;
    try {
      await rememberPR(attempt);
      journaled = true;
      const next = await removePR(record, attempt.key);
      await forgetPR(attempt.key);
      setSnapshot((s) => ({ ...s, record: { ...s.record, receipts: s.record.receipts.map((r) => r.id === id ? next : r) } }));
      setConfirmDelete(false); setActionError(''); setNotice('Receipt deleted. Accepted quantities are back on the PO balance; details and activity remain.');
      setReloadTick((n) => n + 1);
    } catch (cause) {
      if (!journaled) { setActionError(cause.message); return; }
      if (cause.ambiguous || !cause.status || cause.status >= 500) { setRecovery({ pending: attempt }); setConfirmDelete(false); }
      else { try { await forgetPR(attempt.key); } catch { setRecovery({ pending: attempt }); } setActionError(cause.message); }
    }
    finally { deletingRef.current = false; setDeleting(false); }
  }
  async function pdf() {
    if (pdfBusy) return; setPdfBusy(true); setActionError('');
    try { await downloadPRDocument(makePRDocument(record, undefined, getAdminDisplayPreferences()), `${record.number}.pdf`, `${import.meta.env.BASE_URL}images/evexia-logo.png`); }
    catch (cause) { setActionError(cause.message || 'Could not download this receipt.'); }
    finally { setPdfBusy(false); }
  }
  function preview() { setActionError(''); try { setDoc(makePRDocument(record, undefined, getAdminDisplayPreferences())); } catch (cause) { setActionError(cause.message || 'Could not preview this receipt.'); } }
  const title = isNew ? 'New purchase received' : editing ? 'Edit purchase received' : record?.number || 'Purchase received';

  return <AdminLayout title={title}><div className={`po-page${!isNew && !editing ? ' pr-page--detail' : ''}`}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Purchase received / {isNew ? 'New' : record?.number || 'Detail'}</p><h1>{title}</h1><p className="admin-page-head__description">{isNew ? 'Record goods received against a saved purchase order.' : 'Review received batches, balances and recorded changes.'}</p></div><div className="po-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => go(BASE)} data-testid="button-back-pr"><ArrowLeft size={16} /> All receipts</button>{!isNew && !editing && <button type="button" className="admin-button admin-button--secondary" disabled={deleting || !!recovery.pending || !!recovery.error} onClick={refresh} data-testid="button-refresh-pr-detail"><RefreshCw size={15} /> Refresh</button>}</div></div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-pr-feedback">{notice}</div>}
     {savingNotice && saving && <div className="admin-feedback" role="status">Saving receipt… Wait for the current save to finish before switching purchase orders.</div>}
    {actionError && !confirmDelete && <div className="admin-feedback admin-feedback--error" role="alert">{actionError} <button type="button" className="po-link" onClick={refresh}>Refresh records</button></div>}
    {recovery.pending || recovery.error ? <ReceiptRetryRecovery {...recovery} onResolved={(r) => { setRecovery({}); if (r && r.id !== id) navigate(`${BASE}/${r.id}`); else refresh(); }} />
    : loadError || (snapshot && !isNew && !record) ? <section className="admin-panel po-recovery" role="alert"><h2>{loadError ? 'Purchase received is unavailable' : 'Receipt not found'}</h2><p>{loadError || 'This receipt does not exist or the link is incorrect.'}</p><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)}>Back to receipts</button><button type="button" className="admin-button" onClick={refresh}>Try again</button></div></section>
    : !snapshot ? <section className="admin-panel" aria-label="Loading"><div className="po-skeleton" /><div className="po-skeleton" /><div className="po-skeleton" /></section>
     : isNew || editing ? <Editor key={`${id || 'new'}-${version}-${editing}-${isNew ? draftPoId : ''}`} snapshot={snapshot} receipt={record} initialPoId={isNew ? draftPoId : requestedPoId} onSaved={saved} onCancel={() => isNew ? navigate(BASE) : setEditing(false)} onRefresh={refresh} onDraftDirty={setDraftDirty} onSaveStateChange={saveStateChanged} saveBlocked={pendingPoId !== null} />
    : <>
       <div className="po-summary"><div className="po-summary__item po-summary__item--accent"><span>PR number</span><strong>{record.number}</strong>{sampleReceipt && <span className="pr-sample-badge">Sample</span>}<small>{record.status === 'deleted' ? 'Deleted, retained for reference' : 'Active receipt'}</small></div><div className="po-summary__item"><span>PO status</span><strong style={{ fontSize: 17 }}><span className={fclass(fulfil)}>{fulfil || '—'}</span></strong><small>Derived from active receipts</small></div><div className="po-summary__item"><span>Lines received</span><strong>{record.lines.length}</strong><small>{record.lines.filter((l) => Number(l.rejectedQty) > 0).length} with rejections</small></div><div className="po-summary__item"><span>Received</span><strong style={{ fontSize: 20 }}>{displayDate(record.receivedDate)}</strong><small>By {record.receivedBy} (recorded name)</small></div></div>
      <section className="admin-panel">
        <div className="po-form-intro"><div><h2>Receipt overview</h2><p>Created {stamp(record.createdAt)} · Last changed {stamp(record.updatedAt)}{record.deletedAt ? ` · Deleted ${stamp(record.deletedAt)}` : ''}</p></div>
          <div className="po-actions">
             <button type="button" className="admin-button admin-button--secondary" onClick={() => setShowActivity((v) => !v)} aria-expanded={showActivity} data-testid="button-pr-activity"><History size={15} /> Activity ({snapshot.record.eventTotal})</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={preview} data-testid="button-preview-pr"><Eye size={15} /> Preview</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={pdfBusy} onClick={pdf} data-testid="button-pdf-pr"><Download size={15} /> {pdfBusy ? 'Preparing…' : 'PDF'}</button>
            {record.status === 'active' && <><button type="button" className="admin-button admin-button--secondary" onClick={() => setEditing(true)} data-testid="button-edit-pr"><Pencil size={15} /> Edit</button><button type="button" className="admin-button admin-button--danger" onClick={() => { setActionError(''); setConfirmDelete(true); }} data-testid="button-delete-pr"><Trash2 size={15} /> Delete</button></>}
          </div></div>
        <div className="po-review pr-lines-content">
          {record.status === 'deleted' && <p className="pr-note pr-warn">This receipt is deleted. Its accepted quantities no longer count toward the PO balance.</p>}
          <dl className="po-detail-grid"><div><dt>Purchase order</dt><dd><button type="button" className="po-link" onClick={() => navigate(`${PO_BASE}/${encodeURIComponent(record.poId)}`)}>{record.poNumber}</button><span className="po-secondary">PO date {displayDate(record.poDate)}</span></dd></div><div><dt>Vendor</dt><dd>{record.vendorName}<span className="po-secondary">{record.vendorPhone || 'No mobile on record'}</span></dd></div><div><dt>Destination</dt><dd>{record.locationName}</dd></div><div><dt>Received by</dt><dd>{record.receivedBy}<span className="po-secondary">{record.receiverMode === 'staff' ? `Staff reference: ${record.staffId}` : 'Others'} · Named receiver, separate from saving actor</span></dd></div></dl>
          <h3 className="po-section-title">Received lines <span>Saved historic details</span></h3>
        <div className="pr-grid" tabIndex={0} role="region" aria-label="Received lines"><table><thead><tr><th>Sr. No.</th><th>Product</th><th>Ordered</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Batch No.</th><th>Expiry</th></tr></thead>
          <tbody>{record.lines.map((l, i) => <tr key={l.lineId}><td>{i + 1}</td><td><strong>{l.productName}</strong></td><td>{l.orderedQty}</td><td>{l.receivedQty}</td><td>{l.acceptedQty}</td><td>{l.rejectedQty}</td><td>{l.batchNo}</td><td>{displayDate(l.expiryDate)}</td></tr>)}</tbody></table></div>
        </div>
         {showActivity && <div className="po-activity"><p>Latest {events.length} of {snapshot.record.eventTotal} changes. <button type="button" className="po-link" onClick={() => navigate(`${BASE}?poId=${record.poId}`)}>Open the paged server Activity listing</button></p>{events.length ? events.map((e) => <article className="po-event" key={e.id}><div className="po-event__mark"><History size={14} /></div><div><strong>{e.action}</strong><p>{e.summary}</p><p className="po-event__attribution"><strong>{e.actor}</strong> · authenticated saving actor · <time dateTime={e.at}>{stamp(e.at)}</time></p></div></article>) : <div className="admin-empty"><strong>No activity recorded</strong></div>}</div>}
      </section>
    </>}
     {pendingPoId !== null && isNew && <ConfirmationDialog title="Switch purchase order?" description="The link changed to another purchase order while this receipt has unsaved changes. Switching discards this draft. Choose Cancel to keep the draft and return the URL to the purchase order it was started with." actionLabel="Switch PO and discard" destructive onConfirm={switchPo} onClose={keepDraft} />}
      {confirmDelete && record && <ConfirmationDialog title={`Delete ${record.number}?`} description="Its accepted quantities return to the PO balance. Details and activity remain on the server." actionLabel={deleting ? 'Deleting…' : 'Delete receipt'} destructive onConfirm={remove} onClose={() => { if (!deleting) { setConfirmDelete(false); setActionError(''); } }} error={actionError} />}
    {doc && <PRDocumentPreview document={doc} onClose={() => setDoc(null)} />}
  </div></AdminLayout>;
}
