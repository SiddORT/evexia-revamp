import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Paperclip } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import KitsReferenceSelect from '../../components/admin/KitsReferenceSelect.jsx';
import MasterFilePicker from '../../components/admin/MasterFilePicker.jsx';
import ImmDialog from '../../components/immunotherapy/ImmDialog.jsx';
import PrescriptionViewer from '../../components/immunotherapy/PrescriptionViewer.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { continueNavigation, setNavigationGuard } from '../../auth/navigationGuard.js';
import { request, blankOrder, totalMinor, money, amountMoney, validateAttachments, fileSize, orderInput, uploadAttachment, downloadAttachment, attachmentBlob, removeUpload } from '../../services/serverLupin.js';
import '../../lupinOrders.css';
import '../../orderEntry.css';
import OrderApproval from '../../components/orders/OrderApproval.jsx';

const Err = ({ id, text }) => text ? <p className="lupin-error" id={id} role="alert">{text}</p> : null;

export default function LupinOrderFormPage({ id, mode = 'view' }) {
  const BASE = useOrderBase('lupin');
  const [order, setOrder] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    setOrder(null); setError('');
    request(`/${id}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setOrder(data); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, revision]);
  if (id && !order) return <AdminLayout title="LUPIN"><div className="lupin"><div className="admin-panel lupin-empty" data-testid="empty-lupin-missing">
    <h1>{error ? 'Order not available' : 'Loading saved order…'}</h1>
    {error && <><p role="alert">{error}</p><button type="button" className="admin-button" onClick={() => setRevision((n) => n + 1)}>Retry</button></>}
    <Link href={BASE} className="admin-button">Back to orders</Link>
  </div></div></AdminLayout>;
  return order ? mode === 'edit' ? <Form key={`${order.id}-edit`} order={order} /> : <Review key={order.id} order={order} /> : <Form />;
}

function Review({ order: initialOrder }) {
  const [order, setOrder] = useState(initialOrder);
  const can = useOrderActions('lupin');
  const { portal } = useOrderPortal();
  const canPreview = portal === 'mr' && can.read_attachment;
  const [viewing, setViewing] = useState(null);
  const viewerOpener = useRef(null);
  const BASE = useOrderBase('lupin');
  const { date } = useAdminDateFormatters();
  const [error, setError] = useState(''), [downloading, setDownloading] = useState(false);
  return <AdminLayout title="LUPIN"><div className="lupin lupin-review">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Lupin</p><h1>Order {order.number}</h1></div>
      <div className="lupin-actions">{can.edit && order.mrEditable && <Link href={`${BASE}/${order.id}/edit`} className="admin-button">Edit order</Link>}
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="link-lupin-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div></div>
    {error && <p role="alert" className="lupin-error">{error}</p>}
    <section className="admin-panel lupin-section" aria-labelledby="lupin-h-sum"><h2 id="lupin-h-sum">Order details</h2>
      <dl className="lupin-facts">
        <div><dt>Date</dt><dd>{date(order.date)}</dd></div>
        <div><dt>Doctor</dt><dd>{order.doctor.name}</dd></div>
        <div><dt>MR</dt><dd>{order.mr.name}</dd></div>
        <div><dt>Order status</dt><dd>{order.status}</dd></div><div><dt>Payment status</dt><dd>{order.paymentStatus}</dd></div>
      </dl>
      <OrderApproval kind="lupin" order={order} request={request} onApproved={setOrder} />
    </section>
    <section className="admin-panel lupin-section" aria-labelledby="lupin-pricing"><h2 id="lupin-pricing">Pricing</h2>
      <dl className="lupin-facts lupin-review-pricing">
        <div><dt>No. of Patients</dt><dd>{order.patientCount}</dd></div>
        <div><dt>Price per test</dt><dd>{amountMoney(order.price)}</dd></div>
        <div className="lupin-review-total"><dt>Total amount</dt><dd data-testid="text-lupin-review-total">{amountMoney(order.total)}</dd></div>
      </dl>
    </section>
    {order.patients.length > 0 && <section className="admin-panel lupin-section"><h2>Linked Patients</h2>
      <ul className="lupin-files">{order.patients.map((p) => <li key={p.id}>{p.name}</li>)}</ul></section>}
    <section className="admin-panel lupin-section" aria-labelledby="lupin-saved-files"><h2 id="lupin-saved-files">Saved attachments</h2>{order.attachments.length ? <ul className="lupin-files" aria-label="Saved attachments">{order.attachments.map((f) => <li key={f.id}><span><Paperclip size={16} aria-hidden="true" /> {f.name}{!f.restricted && <span className="lupin-sub">{fileSize(f.size)}</span>}</span>
        <div className="lupin-file-actions">
          {canPreview && !f.restricted && f.state === 'verified' && <button type="button" className="lupin-link" aria-label={`View ${f.name}`} onClick={(event) => { viewerOpener.current = event.currentTarget; setViewing(f); }}>View</button>}
          <button type="button" className="lupin-link" disabled={downloading || !can.read_attachment || f.restricted} onClick={async () => { setError(''); setDownloading(true); try { await downloadAttachment(f); } catch (e) { setError(e.message); } finally { setDownloading(false); } }}>Download</button>
         </div></li>)}</ul> : <p>No files attached.</p>}
    </section>
    {order.remarks?.trim() && <section className="admin-panel lupin-section"><h2>Remarks</h2><p className="lupin-remarks">{order.remarks}</p></section>}
    {canPreview && viewing && <PrescriptionViewer file={viewing} load={attachmentBlob} download={downloadAttachment} allowed={can.read_attachment} documentLabel="Attachment" returnFocusRef={viewerOpener} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}

function Form({ order }) {
  const can = useOrderActions('lupin');
  const BASE = useOrderBase('lupin');
  const { mr, portal } = useOrderPortal();
  const [, navigate] = useLocation();
  const [v, setV] = useState(() => order ? { ...order, patientCount: String(order.patientCount) } : { ...blankOrder(), mrId: mr?.id || '' }), [linked, setLinked] = useState(order?.patients || []), [patientChoice, setPatientChoice] = useState('');
  const [errors, setErrors] = useState({}), [fileMsg, setFileMsg] = useState(''), [progress, setProgress] = useState('');
  const [policy, setPolicy] = useState(null), [policyError, setPolicyError] = useState(''), [policyRevision, setPolicyRevision] = useState(0);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [leave, setLeave] = useState(null);
  const [ownerChanged, setOwnerChanged] = useState(false);
  const summary = useRef(null), saveButton = useRef(null), alive = useRef(true), dirty = useRef(false);
  const owner = useRef(getSession().user?.id), submission = useRef(null), saving = useRef(false);
  const uploads = useRef(new Map()), failedUploads = useRef(new Set());
  const uploadKeys = useRef(new Map());
  const initial = useRef(JSON.stringify(v));
  dirty.current = JSON.stringify(v) !== initial.current || uploads.current.size > 0 || failedUploads.current.size > 0 || busy || uncertain;
  const eligible = order ? can.edit && order.mrEditable : can.add;
  const locked = busy || uncertain || ownerChanged || !eligible;
  const set = (patch) => setV((current) => ({ ...current, ...patch }));
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id && getSession().user.id !== owner.current) {
        setOwnerChanged(true); setV(blankOrder()); setLinked([]); submission.current = null;
        uploads.current.clear(); failedUploads.current.clear(); uploadKeys.current.clear();
        setErrors({ save: 'Session owner changed. Return to orders before continuing.' });
      }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!can.upload_attachment) return undefined;
    const controller = new AbortController();
    setPolicyError('');
    request('/policy', { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setPolicy(data); })
      .catch((e) => { if (!controller.signal.aborted) setPolicyError(e.message); });
    return () => controller.abort();
  }, [policyRevision, can.upload_attachment]);
  useEffect(() => setNavigationGuard((target) => {
    if (!dirty.current) return false;
    if (saving.current || submission.current) {
      setErrors({ save: 'Keep this draft open and retry the unchanged submission to confirm its outcome.' });
      return true;
    }
    setLeave(target);
    return true;
  }), []);
  function addFiles(list) {
    if (!policy || locked) return;
    const files = [...list];
    const msg = validateAttachments(files, v.attachments)
      || (files.length + v.attachments.length > policy.maxFiles ? `Select at most ${policy.maxFiles} files.` : '')
      || (files.some((f) => !policy.types.includes(f.type) || f.size > policy.maxBytes) ? `Choose a supported file no larger than ${fileSize(policy.maxBytes)}.` : '');
    setFileMsg(msg);
    if (!msg) set({ attachments: [...v.attachments, ...files] });
  }
  async function cleanup(ids) {
    for (const id of new Set(ids)) await removeUpload(id);
  }
  async function removeFile(file) {
    if (locked || order?.attachments.some((f) => f.id === file.id)) return;
    saving.current = true; setBusy(true);
    try {
      const id = uploads.current.get(file)?.id || uploadKeys.current.get(file);
      if (id) { await cleanup([id]); uploads.current.delete(file); uploadKeys.current.delete(file); failedUploads.current.delete(id); }
      setV((current) => ({ ...current, attachments: current.attachments.filter((f) => f !== file) }));
      setFileMsg('');
    } catch (e) { setErrors({ attachments: `File removal was not confirmed. ${e.message} Retry removal before leaving.` }); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function discard() {
    if (saving.current || uncertain || submission.current) return;
    saving.current = true; setBusy(true);
    try {
      await cleanup([...uploadKeys.current.values(), ...failedUploads.current]);
      uploads.current.clear(); failedUploads.current.clear(); uploadKeys.current.clear(); dirty.current = false;
      const target = leave || { kind: 'href', href: BASE };
      setLeave(null); continueNavigation(target, navigate);
    } catch (e) { setErrors({ attachments: `Private upload cleanup was not confirmed. Keep this draft open and retry. ${e.message}` }); setLeave(null); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (saving.current || ownerChanged || !policy) return;
    const errs = {};
    if (!submission.current) {
      if (!v.doctorId) errs.doctorId = 'Choose a real eligible Doctor.';
      if (!v.mrId) errs.mrId = 'Choose the Doctor’s assigned MR.';
      if (!/^\d{1,7}$/.test(v.patientCount) || Number(v.patientCount) < 1 || Number(v.patientCount) > 1000000) errs.patientCount = 'Enter a whole count from 1 to 1,000,000.';
      if (totalMinor(v.patientCount, v.price) === null && !errs.patientCount) errs.price = 'Enter positive INR text with up to nine whole digits and two decimal places.';
      if (!v.attachments.length) errs.attachments = 'Select at least one private attachment.';
      if (fileMsg) errs.attachments = 'Rejected files were not selected. Dismiss the file error or choose valid files before saving.';
      if (v.remarks.length > 4000) errs.remarks = 'Use at most 4,000 characters.';
    }
    if (Object.keys(errs).length) { setErrors(errs); requestAnimationFrame(() => summary.current?.focus()); return; }
    const guard = reportingIdentityGuard();
    saving.current = true; setBusy(true); setErrors({});
    try {
      if (!submission.current) {
        if (failedUploads.current.size) {
          await cleanup([...failedUploads.current]); failedUploads.current.clear();
        }
        const attachments = [];
        for (const [i, file] of v.attachments.entries()) {
          if (file.id) { attachments.push(file); continue; }
          setProgress(`Uploading and verifying file ${i + 1} of ${v.attachments.length}: ${file.name}`);
          if (!uploads.current.has(file)) {
            if (!uploadKeys.current.has(file)) uploadKeys.current.set(file, crypto.randomUUID());
            try { const saved = await uploadAttachment(file, uploadKeys.current.get(file)); guard(); uploads.current.set(file, saved); }
            catch (e) {
              if (e.fileId && !e.ambiguous) { failedUploads.current.add(e.fileId); uploadKeys.current.delete(file); }
              throw e;
            }
          }
          attachments.push(uploads.current.get(file));
        }
        submission.current = { ...orderInput({ ...v, attachments }), ...(order ? { expected_version: order.version } : {}), idempotencyKey: crypto.randomUUID() };
      }
      setProgress('Saving order…');
      const saved = await request(order ? `/${order.id}/edit` : '', { body: submission.current });
      guard();
      if (!alive.current) return;
      submission.current = null; uploads.current.clear(); failedUploads.current.clear(); uploadKeys.current.clear();
      dirty.current = false; initial.current = JSON.stringify(v); saving.current = false;
      navigate(`${BASE}/${saved.id}`);
    } catch (e) {
      try { guard(); } catch { return; }
      if (alive.current) {
        // Once an order outcome is uncertain, never unlock or replace its key.
        const keep = Boolean(submission.current && (uncertain || e.ambiguous));
        setUncertain(keep);
        if (!keep) submission.current = null;
        setErrors({ save: e.message || 'Save was not confirmed. Your draft is preserved; retry.' });
        requestAnimationFrame(() => summary.current?.focus());
      }
    } finally { saving.current = false; if (alive.current) { setBusy(false); setProgress(''); } }
  }
  const chooseDoctor = (id) => { set({ doctorId: id, mrId: mr?.id || '', patientIds: [] }); setLinked([]); setPatientChoice(''); };
  const addPatient = (person) => {
    if (!person || v.patientIds.includes(person.id)) return;
    if (v.patientIds.length >= 200) { setErrors({ patients: 'Link at most 200 existing Patients.' }); return; }
    set({ patientIds: [...v.patientIds, person.id] });
    setLinked((current) => [...current, person]); setPatientChoice('');
  };
  const field = (key, label, props = {}) => <div className="lupin-field"><label htmlFor={`lupin-${key}`}>{label} <span aria-hidden="true">*</span></label>
    <input id={`lupin-${key}`} value={v[key]} onChange={(e) => set({ [key]: e.target.value })} required aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `lupin-${key}-err` : undefined} data-testid={`input-lupin-${key}`} {...props} />
    <Err id={`lupin-${key}-err`} text={errors[key]} /></div>;
  return <AdminLayout title="LUPIN"><form className="lupin order-entry lupin-entry" onSubmit={save} noValidate aria-label={order ? 'Edit Lupin Order' : 'Add Lupin Order'}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Lupin</p><h1>{order ? `Edit ${order.number}` : 'Add Lupin Order'}</h1></div></div>
    {!eligible && <p role="alert">This order cannot be edited. Saved details remain viewable; any mounted draft is preserved.</p>}
    {policyError && <p role="alert">{policyError} <button type="button" className="lupin-link" onClick={() => setPolicyRevision((n) => n + 1)}>Retry upload policy</button></p>}
    {uncertain && <p className="lupin-notice" role="alert">Order outcome is unconfirmed. Editing is locked. Retry the unchanged save to recover the same order without a duplicate.</p>}
    {Object.keys(errors).length > 0 && <div className="lupin-errors" role="alert" tabIndex={-1} ref={summary} data-testid="lupin-errors"><strong>Unable to save</strong><ul>{Object.entries(errors).map(([key, text]) => <li key={key}>{text}</li>)}</ul></div>}
    <fieldset disabled={locked} className="lupin-form-fields">
      <section className="admin-panel lupin-section" aria-labelledby="lupin-h-det"><h2 id="lupin-h-det">Order details</h2>
        <div className="lupin-entry__identity">
          <KitsReferenceSelect historicalPerson={order?.doctor} requester={request} fieldClass="lupin-field" id="lupin-doctorId" kind="doctors" label="Doctor (required)" value={v.doctorId} onChange={chooseDoctor} onPerson={(p) => { if (!mr && p?.mrId) set({ mrId: p.mrId }); }} disabled={locked} />
          {mr ? <div className="lupin-field"><label htmlFor="lupin-mrId">MR (required)</label><input id="lupin-mrId" readOnly value={mr.name} /><p className="lupin-hint">Your verified saved MR identity. Assignment cannot be changed.</p></div> : <KitsReferenceSelect requester={request} fieldClass="lupin-field" id="lupin-mrId" kind="mrs" label="MR (required)" value={v.mrId} onChange={(id) => set({ mrId: id })} disabled={locked} />}
        </div>
        <p className="lupin-hint">The MR must match this Doctor’s current assignment. No master or account is created.</p>
        <div className="lupin-entry__amounts">
          {field('patientCount', 'No. of Patients', { inputMode: 'numeric', maxLength: 7 })}
          {field('price', 'Price (per Test, INR)', { inputMode: 'decimal', maxLength: 32 })}
          <div className="lupin-field"><label htmlFor="lupin-total">Total Amount (₹)</label><input id="lupin-total" readOnly value={money(totalMinor(v.patientCount, v.price))} aria-live="polite" data-testid="lupin-total" /></div>
        </div>
        <p className="lupin-hint">Enter the patient count manually for pricing. Optional links never calculate, restrict or replace it. The server calculates the saved total.</p>
      </section>
      <section className="admin-panel lupin-section"><h2>Linked Patients (optional)</h2>
        <KitsReferenceSelect requester={request} fieldClass="lupin-field" id="lupin-patient" kind="patients" label="Find an existing Patient" value={patientChoice} onChange={setPatientChoice} onPerson={addPatient} disabled={locked || !v.doctorId} />
        <p className="lupin-hint">Zero links is valid, even with a positive patient count. Linked Patients must belong to the selected Doctor. Only explicitly selected identities are saved as historical context.</p>
        <Err text={errors.patients} />
        {linked.length > 0 && <ul className="lupin-files" aria-label="Selected Patients">{linked.map((p) => <li key={p.id}><span>{p.name}{portal !== 'mr' && <span className="lupin-sub">{p.id}</span>}</span>
          <button type="button" className="lupin-link" aria-label={`Remove Patient ${p.name}`} onClick={() => { setLinked((current) => current.filter((x) => x.id !== p.id)); set({ patientIds: v.patientIds.filter((id) => id !== p.id) }); }}>Remove</button></li>)}</ul>}
      </section>
      <section className="admin-panel lupin-section" aria-labelledby="lupin-h-att"><h2 id="lupin-h-att">Attachments and remarks</h2>
        <div className="lupin-more-grid"><div>
          <div className="lupin-field"><span>Attachments (required)</span>
            <MasterFilePicker id="lupin-files" icon={Paperclip} multiple disabled={!can.upload_attachment || locked || !policy} aria-label="Lupin private attachments" aria-required="true" aria-invalid={Boolean(fileMsg || errors.attachments)} aria-describedby="lupin-files-hint lupin-files-err"
              accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-testid="input-lupin-files">{v.attachments.length ? `${v.attachments.length} files selected — choose more` : 'Choose PDF or image files'}</MasterFilePicker>
            <p className="lupin-hint" id="lupin-files-hint">{policy ? `Up to ${policy.maxFiles} files, ${fileSize(policy.maxBytes)} each.` : 'Loading authoritative upload policy…'} Files upload privately on save and must pass type verification and a clean scan. PDF, JPEG, PNG and WebP only.</p>
            <Err id="lupin-files-err" text={fileMsg || errors.attachments} />
            {fileMsg && <button type="button" className="lupin-link" onClick={() => setFileMsg('')}>Dismiss rejected files</button>}
          </div>
          {v.attachments.length > 0 ? <ul className="lupin-files" aria-label="Selected files">{v.attachments.map((f, i) => <li key={`${f.name}-${i}`}><span><Paperclip size={13} aria-hidden="true" /> {f.name} ({fileSize(f.size)})</span>{f.id ? <span>Retained</span> : <button type="button" className="lupin-link" onClick={() => removeFile(f)} aria-label={`Remove ${f.name}`}>Remove</button>}</li>)}</ul> : <p className="lupin-hint">No files selected.</p>}
        </div>
          <label className="lupin-field">Remarks<textarea id="lupin-remarks" maxLength={4000} value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} data-testid="input-lupin-remarks" /></label>
        </div>
      </section>
    </fieldset>
    {progress && <p className="lupin-hint" role="status" aria-live="polite">{progress}</p>}
    {!can.upload_attachment && <p role="status">Upload Attachment permission is required for this form's mandatory attachment. Your draft remains in this tab.</p>}
    <div className="lupin-actions"><button ref={saveButton} type="submit" className="admin-button" disabled={!eligible || !can.upload_attachment || busy || ownerChanged || !policy} data-testid="button-lupin-save">{busy ? 'Saving…' : uncertain ? 'Retry unchanged save' : order ? 'Save changes' : 'Save order'}</button>
      {!busy && !uncertain && <button type="button" className="admin-button admin-button--secondary" onClick={() => dirty.current ? setLeave({ kind: 'href', href: BASE }) : navigate(BASE)} data-testid="link-lupin-cancel">Cancel</button>}
    </div>
    {leave && <ImmDialog title="Discard this Lupin draft?" description="Selected files and unsaved details will be discarded. Known private uploads will be removed before leaving." onClose={() => { if (!busy) setLeave(null); }} returnFocusRef={saveButton}>
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => setLeave(null)}>Keep editing</button><button type="button" className="admin-button" disabled={busy} onClick={discard}>{busy ? 'Removing uploads…' : 'Discard draft'}</button></div>
    </ImmDialog>}
  </form></AdminLayout>;
}
