import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ArrowLeft, ClipboardCheck, Download, Eye, History, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import PRDocumentPreview from '../../components/admin/PRDocumentPreview.jsx';
import { createPR, deletePR, getPOBalances, getPOFulfillment, isSamplePR, loadPRSnapshot, updatePR, validatePR } from '../../services/purchaseReceived.js';
import { downloadPRDocument, makePRDocument } from '../../services/prDocuments.js';
import '../../mr.css';
import '../../purchaseOrders.css';
import '../../purchaseReceived.css';

const BASE = '/admin/inventory/purchase-received';
const PO_BASE = '/admin/inventory/purchase-orders';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const displayDate = (d) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const stamp = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
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
  const isNew = !receipt;
  const sample = isSamplePR(receipt);
  const orders = snapshot.poRecord.orders;
  const receipts = snapshot.record.receipts;
  const activeReceipts = receipts.filter((r) => r.status === 'active');
  const eligible = (o) => o.status === 'open' && getPOFulfillment(o, activeReceipts) !== 'Closed';
  const requested = orders.find((o) => o.id === (receipt?.poId || initialPoId));
  const initialPo = receipt ? requested : requested && eligible(requested) ? requested : undefined;
  const poProblem = receipt || !initialPoId ? '' : !requested ? 'The purchase order in this link was not found in this browser. Choose another purchase order below.'
    : requested.status !== 'open' ? `${requested.number} is deleted and cannot receive goods. Choose another purchase order below.`
    : !eligible(requested) ? `${requested.number} is already fully received (Closed), so there is nothing left to receive. Choose another purchase order below.` : '';
  const makeInitial = () => ({ poId: initialPo?.id || '', receivedDate: receipt?.receivedDate || today(), receivedBy: receipt?.receivedBy || 'Local demo operator (unverified record)', rows: initialPo ? rowsFor(initialPo, receipt) : [] });
  const baseline = useRef(JSON.stringify(makeInitial()));
  const [values, setValues] = useState(makeInitial);
  const [errors, setErrors] = useState({});
  const [review, setReview] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const po = orders.find((o) => o.id === values.poId);
  const balances = useMemo(() => po ? getPOBalances(po, activeReceipts, receipt?.id || null) : {}, [po, activeReceipts, receipt]);
  const poChoices = orders.filter((o) => o.id === receipt?.poId || eligible(o))
    .map((o) => ({ value: o.id, label: `${o.number} · ${o.vendorName} · ${getPOFulfillment(o, activeReceipts)}` }));
  const dirty = JSON.stringify(values) !== baseline.current;

  useEffect(() => { onDraftDirty(dirty || Boolean(review)); }, [dirty, review, onDraftDirty]);
  function clear(...keys) { setErrors((c) => { const n = { ...c, form: undefined }; keys.forEach((k) => { n[k] = undefined; }); return n; }); setSaveError(''); }
  function choosePo(id) {
    const next = orders.find((o) => o.id === id);
    setValues((c) => ({ ...c, poId: id, rows: next ? rowsFor(next, null) : [] })); setErrors({}); setSaveError('');
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
  const payload = () => ({ poId: values.poId, receivedDate: values.receivedDate, receivedBy: values.receivedBy, lines: values.rows });
  function prepare(e) {
    e.preventDefault();
    if (saveBlocked) return;
    const result = validatePR(payload(), snapshot, receipt);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) { document.getElementById('pr-form-errors')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    setReview(result.receipt); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function save() {
    if (busy || saveBlocked) return;
    const result = validatePR(payload(), snapshot, receipt);
    if (Object.keys(result.errors).length) { setErrors(result.errors); setReview(null); return; }
    setBusy(true); onSaveStateChange(true); setSaveError('');
    try {
      const next = isNew ? await createPR(snapshot, payload()) : await updatePR(snapshot, receipt.id, payload());
      const id = isNew ? next.record.receipts.find((r) => !snapshot.record.receipts.some((o) => o.id === r.id))?.id : receipt.id;
      onSaved(next, id);
    } catch (cause) { setSaveError(cause.message || 'Could not save this receipt. Refresh records and review again.'); }
    finally { setBusy(false); onSaveStateChange(false); }
  }
  function requestRefresh() { if (dirty || review) setConfirmRefresh(true); else onRefresh(); }
  const err = (i, f) => errors[`lines.${i}.${f}`];
  const summary = review || null;

  return <section className="admin-panel" aria-label={isNew ? 'New purchase received' : 'Edit purchase received'}>
    <div className="po-form-intro"><div><h2>{sample && <span className="pr-sample-badge">Sample receipt</span>} {review ? 'Review before saving' : 'Receipt details'}</h2><p>{review ? 'Nothing has been saved yet. Check batches, quantities and balances.' : 'Required fields are marked *. Receipts are recorded in this browser only.'}</p></div><ClipboardCheck size={21} color="var(--admin-accent)" aria-hidden="true" /></div>
    {sample && <p className="pr-note pr-sample-note" role="note">Fictional browser-local sample receipt. It counts in activity and analytics, affects sample PO fulfillment while active, and prevents editing or deleting its source PO while active. No inventory or vendor records are updated.</p>}
    {saveError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ margin: 18 }}>{saveError} <button type="button" className="po-link" onClick={requestRefresh} data-testid="button-refresh-pr-draft">Refresh records</button></div>}
    {review ? <>
      <div className="po-review"><p className="po-review__note">Browser-local preview. Confirming saves this receipt here; it does not update a stock ledger or notify a supplier.</p>
        <dl className="po-detail-grid"><div><dt>PO</dt><dd>{review.poNumber}</dd></div><div><dt>Vendor</dt><dd>{review.vendorName}</dd></div><div><dt>Destination</dt><dd>{review.locationName}</dd></div><div><dt>Received date</dt><dd>{displayDate(review.receivedDate)}</dd></div><div><dt>Received by</dt><dd>{review.receivedBy}</dd></div></dl>
        <h3 className="po-section-title">Lines <span>{summary.lines.length} to save</span></h3></div>
      <div className="pr-grid" tabIndex={0} role="region" aria-label="Receipt lines"><table><thead><tr><th>Sr. No.</th><th>Product</th><th>Ordered</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Batch No.</th><th>Expiry</th><th>Balance after</th></tr></thead>
        <tbody>{summary.lines.map((l, i) => <tr key={l.lineId}><td>{i + 1}</td><td><strong>{l.productName}</strong></td><td>{l.orderedQty}</td><td>{l.receivedQty}</td><td>{l.acceptedQty}</td><td>{l.rejectedQty}</td><td>{l.batchNo}</td><td>{displayDate(l.expiryDate)}</td><td>{q3((balances[l.lineId] ?? 0) - Number(l.acceptedQty))}</td></tr>)}</tbody></table></div>
       <div className="po-form-footer"><span>Saved locally on confirmation.</span><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => { setReview(null); setSaveError(''); }} data-testid="button-back-pr-draft">Back to draft</button><button type="button" className="admin-button" disabled={busy || saveBlocked} onClick={save} data-testid="button-confirm-pr">{busy ? 'Saving…' : isNew ? 'Create receipt' : 'Save changes'}</button></div></div>
    </> : <form onSubmit={prepare} noValidate>
      <div className="po-form-body">
        {(errors.form || errors.lines || Object.keys(errors).some((k) => errors[k] && k.startsWith('lines.'))) && <div id="pr-form-errors" className="admin-feedback admin-feedback--error" role="alert">{errors.form || errors.lines || 'Check the highlighted receipt rows before continuing.'}</div>}
        <h3 className="po-section-title">01 / Receipt information <span>Linked purchase order and receiver</span></h3>
        <div className="po-fields">
          <div className="po-field"><label htmlFor="pr-po">Purchase order <span className="mr-form__required">*</span></label>
            {isNew ? <SearchableSelect id="pr-po" label="Purchase order" value={values.poId} options={poChoices} onChange={choosePo} placeholder="Select purchase order" invalid={Boolean(errors.poId)} describedBy={errors.poId ? 'pr-po-error' : undefined} /> : <input id="pr-po" className="mr-form__control" value={po?.number || receipt.poNumber} readOnly aria-readonly="true" />}
            {errors.poId && <p id="pr-po-error" className="mr-form__error" role="alert">{errors.poId}</p>}{!isNew && <p className="mr-form__hint">The linked PO is fixed.</p>}{isNew && !poChoices.length && <p className="mr-form__hint" role="status" data-testid="text-pr-no-eligible">No purchase orders are available to receive. Open POs that are not fully received appear here; create one first.</p>}</div>
          <div className="po-field"><label htmlFor="pr-date">Received date <span className="mr-form__required">*</span></label><input id="pr-date" type="date" className="mr-form__control" min={po?.poDate} value={values.receivedDate} onChange={(e) => { setValues((c) => ({ ...c, receivedDate: e.target.value })); clear('receivedDate'); }} aria-invalid={Boolean(errors.receivedDate)} aria-describedby={errors.receivedDate ? 'pr-date-error' : undefined} data-testid="input-pr-date" />{errors.receivedDate && <p id="pr-date-error" className="mr-form__error" role="alert">{errors.receivedDate}</p>}</div>
          <div className="po-field"><label htmlFor="pr-by">Received by <span className="mr-form__required">*</span></label><input id="pr-by" className="mr-form__control" value={values.receivedBy} maxLength={80} onChange={(e) => { setValues((c) => ({ ...c, receivedBy: e.target.value })); clear('receivedBy'); }} aria-invalid={Boolean(errors.receivedBy)} aria-describedby={errors.receivedBy ? 'pr-by-error' : 'pr-by-hint'} data-testid="input-pr-received-by" />{errors.receivedBy ? <p id="pr-by-error" className="mr-form__error" role="alert">{errors.receivedBy}</p> : <p id="pr-by-hint" className="mr-form__hint">Recorded name only. The default is a local demo name; no one is signed in.</p>}</div>
        </div>
        {poProblem && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="text-pr-po-problem">{poProblem}</div>}
        {po && <dl className="pr-ctx"><div><dt>Vendor</dt><dd>{receipt ? receipt.vendorName : po.vendorName}<span className="po-secondary">{(receipt ? receipt.vendorPhone : snapshot.refs.vendors.find((v) => v.id === po.vendorId)?.phoneNo) || 'No mobile on record'}</span></dd></div><div><dt>Deliver to</dt><dd>{receipt ? receipt.locationName : po.locationName}</dd></div><div><dt>PO date</dt><dd>{displayDate(po.poDate)} <span className={fclass(getPOFulfillment(po, activeReceipts))}>{getPOFulfillment(po, activeReceipts)}</span></dd></div></dl>}
        <p className="mr-form__footer-note">Receipt destinations come from browser-local purchase orders and their separate location IDs. Shared Storage Location Master edits do not change these destinations.</p>
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
      </div>
       <div className="po-form-footer"><span>Review the receipt before it is saved.</span><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" onClick={requestRefresh} data-testid="button-refresh-pr-form"><RefreshCw size={14} /> Refresh</button><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-pr">Cancel</button><button type="submit" className="admin-button" disabled={saveBlocked} data-testid="button-review-pr">Review receipt</button></div></div>
    </form>}
    {confirmRefresh && <ConfirmationDialog title="Discard this draft?" description="Refreshing reloads saved purchase orders and receipts and discards everything you have entered here. Use it only if the data is stale." actionLabel="Refresh and discard" destructive onConfirm={onRefresh} onClose={() => setConfirmRefresh(false)} />}
  </section>;
}

export default function PurchaseReceivedFormPage({ id }) {
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

  function refresh() {
    try { setSnapshot(loadPRSnapshot()); setLoadError(''); setActionError(''); setEditing(false); setConfirmDelete(false); setDraftDirty(false); setVersion((v) => v + 1); }
    catch (cause) { setSnapshot(null); setLoadError(cause.message || 'Purchase received could not be loaded.'); }
  }
  useEffect(() => { refresh(); }, [id]);
  const record = isNew ? null : snapshot?.record.receipts.find((r) => r.id === id);
  const sampleReceipt = isSamplePR(record);
  const events = [...(snapshot?.record.events || [])].reverse().filter((e) => e.receiptId === id);
  const po = record && snapshot?.poRecord.orders.find((o) => o.id === record.poId);
  const fulfil = po ? getPOFulfillment(po, snapshot.record.receipts.filter((r) => r.status === 'active')) : '';

  function saved(next, savedId) {
    sourceRestorePendingRef.current = false;
    setSnapshot(next); setEditing(false); setDraftDirty(false); setPendingPoId(null); setNotice(isNew ? 'Receipt created in this browser.' : 'Receipt updated in this browser.');
    if (isNew && savedId) navigate(`${BASE}/${encodeURIComponent(savedId)}`);
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
    if (deleting) return; setDeleting(true);
    try { const next = await deletePR(snapshot, id); setSnapshot(next); setConfirmDelete(false); setActionError(''); setNotice('Receipt deleted. Accepted quantities are back on the PO balance; details and activity remain.'); }
    catch (cause) { setActionError(cause.message || 'Could not delete this receipt. Refresh and try again.'); }
    finally { setDeleting(false); }
  }
  async function pdf() {
    if (pdfBusy) return; setPdfBusy(true); setActionError('');
    try { await downloadPRDocument(makePRDocument(record), `${record.number}.pdf`, `${import.meta.env.BASE_URL}images/evexia-logo.png`); }
    catch (cause) { setActionError(cause.message || 'Could not download this receipt.'); }
    finally { setPdfBusy(false); }
  }
  function preview() { setActionError(''); try { setDoc(makePRDocument(record)); } catch (cause) { setActionError(cause.message || 'Could not preview this receipt.'); } }
  const title = isNew ? 'New purchase received' : editing ? 'Edit purchase received' : record?.number || 'Purchase received';

  return <AdminLayout title={title}><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Purchase received / {isNew ? 'New' : record?.number || 'Detail'}</p><h1>{title} {sampleReceipt && <span className="pr-sample-badge">Sample receipt</span>}</h1><p className="admin-page-head__description">{isNew ? 'Record goods received against a saved purchase order.' : 'Review received batches, balances and recorded changes.'}</p></div><div className="po-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} data-testid="button-back-pr"><ArrowLeft size={16} /> All receipts</button>{!isNew && !editing && <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-pr-detail"><RefreshCw size={15} /> Refresh</button>}</div></div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-pr-feedback">{notice}</div>}
     {savingNotice && saving && <div className="admin-feedback" role="status">Saving receipt… Wait for the current save to finish before switching purchase orders.</div>}
    {actionError && !confirmDelete && <div className="admin-feedback admin-feedback--error" role="alert">{actionError} <button type="button" className="po-link" onClick={refresh}>Refresh records</button></div>}
    {sampleReceipt && !editing && <div className="admin-feedback pr-sample-note" role="note">Fictional browser-local sample receipt. It counts in activity and analytics and affects sample PO fulfillment while active. While active, it prevents editing or deleting its source PO. No inventory or vendor records are updated.</div>}
    {loadError || (snapshot && !isNew && !record) ? <section className="admin-panel po-recovery" role="alert"><h2>{loadError ? 'Purchase received is unavailable' : 'Receipt not found'}</h2><p>{loadError || 'This receipt may not exist in this browser, or its link is incorrect.'}</p><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)}>Back to receipts</button><button type="button" className="admin-button" onClick={refresh}>Try again</button></div></section>
    : !snapshot ? <section className="admin-panel" aria-label="Loading"><div className="po-skeleton" /><div className="po-skeleton" /><div className="po-skeleton" /></section>
     : isNew || editing ? <Editor key={`${id || 'new'}-${version}-${editing}-${isNew ? draftPoId : ''}`} snapshot={snapshot} receipt={record} initialPoId={isNew ? draftPoId : requestedPoId} onSaved={saved} onCancel={() => isNew ? navigate(BASE) : setEditing(false)} onRefresh={refresh} onDraftDirty={setDraftDirty} onSaveStateChange={saveStateChanged} saveBlocked={pendingPoId !== null} />
    : <>
       <div className="po-summary"><div className="po-summary__item po-summary__item--accent"><span>PR number</span><strong>{record.number}</strong>{sampleReceipt && <span className="pr-sample-badge">Sample</span>}<small>{record.status === 'deleted' ? 'Deleted, retained for reference' : 'Active receipt'}</small></div><div className="po-summary__item"><span>PO status</span><strong style={{ fontSize: 17 }}><span className={fclass(fulfil)}>{fulfil || '—'}</span></strong><small>Derived from active receipts</small></div><div className="po-summary__item"><span>Lines received</span><strong>{record.lines.length}</strong><small>{record.lines.filter((l) => Number(l.rejectedQty) > 0).length} with rejections</small></div><div className="po-summary__item"><span>Received</span><strong style={{ fontSize: 20 }}>{displayDate(record.receivedDate)}</strong><small>By {record.receivedBy} (recorded name)</small></div></div>
      <section className="admin-panel">
        <div className="po-form-intro"><div><h2>Receipt overview</h2><p>Created {stamp(record.createdAt)} · Last changed {stamp(record.updatedAt)}{record.deletedAt ? ` · Deleted ${stamp(record.deletedAt)}` : ''}</p></div>
          <div className="po-actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={() => setShowActivity((v) => !v)} aria-expanded={showActivity} data-testid="button-pr-activity"><History size={15} /> Activity ({events.length})</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={preview} data-testid="button-preview-pr"><Eye size={15} /> Preview</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={pdfBusy} onClick={pdf} data-testid="button-pdf-pr"><Download size={15} /> {pdfBusy ? 'Preparing…' : 'PDF'}</button>
            {record.status === 'active' && <><button type="button" className="admin-button admin-button--secondary" onClick={() => setEditing(true)} data-testid="button-edit-pr"><Pencil size={15} /> Edit</button><button type="button" className="admin-button admin-button--danger" onClick={() => { setActionError(''); setConfirmDelete(true); }} data-testid="button-delete-pr"><Trash2 size={15} /> Delete</button></>}
          </div></div>
        <div className="po-review">
          {record.status === 'deleted' && <p className="pr-note pr-warn">This receipt is deleted. Its accepted quantities no longer count toward the PO balance.</p>}
          <dl className="po-detail-grid"><div><dt>Purchase order</dt><dd><button type="button" className="po-link" onClick={() => navigate(`${PO_BASE}/${encodeURIComponent(record.poId)}`)}>{record.poNumber}</button><span className="po-secondary">PO date {displayDate(record.poDate)}</span></dd></div><div><dt>Vendor</dt><dd>{record.vendorName}<span className="po-secondary">{record.vendorPhone || 'No mobile on record'}</span></dd></div><div><dt>Destination</dt><dd>{record.locationName}</dd></div><div><dt>Received by</dt><dd>{record.receivedBy}<span className="po-secondary">Local demo name, not verified</span></dd></div></dl>
          <h3 className="po-section-title">Received lines <span>Saved historic details</span></h3>
        </div>
        <div className="pr-grid" tabIndex={0} role="region" aria-label="Received lines"><table><thead><tr><th>Sr. No.</th><th>Product</th><th>Ordered</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Batch No.</th><th>Expiry</th></tr></thead>
          <tbody>{record.lines.map((l, i) => <tr key={l.lineId}><td>{i + 1}</td><td><strong>{l.productName}</strong></td><td>{l.orderedQty}</td><td>{l.receivedQty}</td><td>{l.acceptedQty}</td><td>{l.rejectedQty}</td><td>{l.batchNo}</td><td>{displayDate(l.expiryDate)}</td></tr>)}</tbody></table></div>
        {showActivity && <div className="po-activity">{events.length ? events.map((e) => <article className="po-event" key={e.id}><div className="po-event__mark"><History size={14} /></div><div><strong>{e.action}</strong><p>{e.summary}</p><p className="po-event__attribution"><strong>{e.actor || 'Demo Admin'}</strong> (local demo) · <time dateTime={e.at}>{stamp(e.at)}</time></p></div></article>) : <div className="admin-empty"><strong>No activity recorded</strong></div>}</div>}
      </section>
    </>}
     {pendingPoId !== null && isNew && <ConfirmationDialog title="Switch purchase order?" description="The link changed to another purchase order while this receipt has unsaved changes. Switching discards this draft. Choose Cancel to keep the draft and return the URL to the purchase order it was started with." actionLabel="Switch PO and discard" destructive onConfirm={switchPo} onClose={keepDraft} />}
     {confirmDelete && record && <ConfirmationDialog title={`Delete ${record.number}?`} description="Its accepted quantities return to the PO balance. Details and activity stay available in this browser." actionLabel={deleting ? 'Deleting…' : 'Delete receipt'} destructive onConfirm={remove} onClose={() => { if (!deleting) { setConfirmDelete(false); setActionError(''); } }} error={actionError} />}
    {doc && <PRDocumentPreview document={doc} onClose={() => setDoc(null)} />}
  </div></AdminLayout>;
}
