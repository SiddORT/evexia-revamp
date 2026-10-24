import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Paperclip, X } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import KitsReferenceSelect from '../../components/admin/KitsReferenceSelect.jsx';
import MasterFilePicker from '../../components/admin/MasterFilePicker.jsx';
import { DownloadOrderFile, OrderFileList, OrderFileRow } from '../../components/orders/OrderFiles.jsx';
import { KIT_PRODUCTS, STATUSES, addressText, blankOrder, fileSize, productSummary, validateAttachments, request, orderInput, uploadAttachment, downloadAttachment } from '../../services/serverKits.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import KitsOrderEditor from './KitsOrderEditor.jsx';
import KitsPricingSummary from '../../components/orders/KitsPricingSummary.jsx';
import '../../kitsOrders.css';
import '../../orderEntry.css';

const LABELS = { orderFor: 'Order for', doctorId: 'Doctor', mrId: 'MR', products: 'Products', 'kit-product': 'Kit product', 'kit-custom': 'Custom value', 'kit-volume': 'Kit volume', 'kit-quantity': 'Kit quantity', lancets: 'Lancets', applicators: 'Applicators', tray: 'Tray', shipping: 'Shipping', 'other-name': 'Recipient name', 'other-phone': 'Recipient phone', 'other-line1': 'Address line 1', 'other-country': 'Country', 'other-state': 'State', 'other-city': 'City', 'other-pincode': 'Pincode', attachments: 'Attachments' };
const Err = ({ id, text }) => (text ? <p className="kits-error" id={id} role="alert">{text}</p> : null);

function Facts({ person, empty, testId }) {
  if (!person) return <p className="kits-unavailable" data-testid={testId}>{empty}</p>;
  const a = person.address || {};
  const rows = [['Name', person.name], ['Phone no.', person.phone], ['Address line 1', a.line1], ['Address line 2', a.line2], ['Landmark', a.landmark], ['Country', a.country], ['State', a.state], ['City', a.city], ['Pincode', a.pincode]];
  return <dl className="kits-facts" data-testid={testId}>{rows.map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '-'}</dd></div>)}</dl>;
}

export default function KitsOrderFormPage({ id, mode = 'view' }) {
  const BASE = useOrderBase('kits-consumables');
  const can = useOrderActions('kits');
  const [order, setOrder] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(Boolean(id)), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id || (mode === 'edit' && !can.protected)) return undefined;
    const controller = new AbortController();
    setLoading(true); setError(''); setOrder(null);
    request(`/${id}`, { signal: controller.signal }).then(setOrder).catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision, mode, can.protected]);
  if (mode === 'edit' && !can.protected) return <AdminLayout title="KITS & CONSUMABLES"><div className="kits"><section className="admin-panel kits-panel"><h1>Edit access denied</h1><p role="alert">Only the protected Super Admin can edit saved Kits orders and pricing.</p><Link href={BASE}>Back to orders</Link></section></div></AdminLayout>;
  if (id) {
    if (!order) return <AdminLayout title="KITS & CONSUMABLES"><div className="kits"><div className="admin-panel kits-panel kits-empty" data-testid="kits-missing">
      <h1>{loading ? 'Loading saved order…' : 'Order not available'}</h1>{error && <p role="alert">{error}</p>}
      {!loading && <button type="button" className="admin-button" onClick={() => setRevision((n) => n + 1)}>Retry</button>}
      <Link href={BASE} className="admin-button">Back to orders</Link></div></div></AdminLayout>;
    return mode === 'edit' ? <KitsOrderEditor order={order} /> : <Summary order={order} />;
  }
  return <Form />;
}

function Summary({ order }) {
  const can = useOrderActions('kits');
  const BASE = useOrderBase('kits-consumables');
  const { date } = useAdminDateFormatters();
  const doctor = order.doctor, mr = order.mr;
  const k = order.kit || {};
  const kitOn = k.product || k.custom || k.volume || k.quantity;
  const rec = order.recipient;
  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Kits &amp; Consumables</p><h1>Order {order.number}</h1>
      <p className="admin-page-head__description">Read-only saved order with historical billing, shipping and personal details.</p></div>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="kits-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div>
    <div className="kits-layout">
      <div className="kits-main">
        <section className="admin-panel kits-panel" aria-labelledby="kits-s-items"><h2 id="kits-s-items">Order details</h2>
          {can.protected && <><Link href={`${BASE}/${order.id}/edit`} className="admin-button admin-button--secondary">Edit order and pricing</Link><KitsPricingSummary order={order} /></>}
          <dl className="kits-facts" data-testid="kits-summary-items">
            <div><dt>Summary</dt><dd>{productSummary(order)}</dd></div>
            <div><dt>Order for</dt><dd>{order.orderFor === 'mr' ? `MR: ${mr?.name || '-'}` : `Doctor: ${doctor?.name || '-'}`}</dd></div>
            <div><dt>Doctor</dt><dd>{doctor?.name || '-'}</dd></div>
            <div><dt>MR</dt><dd>{mr?.name || 'Not selected'}</dd></div>
            <div><dt>Patient</dt><dd>{order.patient?.name || 'Not selected'}</dd></div>
            {kitOn && <><div><dt>Kit product</dt><dd>{k.product === 'Customized' ? `Customized (${k.custom})` : k.product || '-'}</dd></div><div><dt>Kit volume (ml)</dt><dd>{k.volume || '-'}</dd></div><div><dt>Kit quantity</dt><dd>{k.quantity || '-'}</dd></div></>}
            {order.lancets && <div><dt>Lancets</dt><dd>{order.lancets}</dd></div>}
            {order.applicators && <div><dt>Applicators</dt><dd>{order.applicators}</dd></div>}
            {order.tray && <div><dt>Tray</dt><dd>{order.tray}</dd></div>}
            <div><dt>Status</dt><dd data-testid="kits-summary-status">{order.status}</dd></div>
            <div><dt>Payment</dt><dd>{order.paymentStatus}</dd></div>
            <div><dt>Date</dt><dd>{date(order.date)}</dd></div>
            <div><dt>Remarks</dt><dd>{order.remarks || 'None'}</dd></div></dl>
          <h2 style={{ marginTop: 16 }}>Private attachments</h2>
          <OrderFileList>{(order.attachments || []).map((f) => <DownloadOrderFile key={f.id} file={f} allowed={can.read_attachment} download={downloadAttachment} status="Saved attachment" />)}</OrderFileList>
        </section></div>
      <div className="kits-side">
        <section className="admin-panel kits-panel"><h2>Shipping ({order.shipping})</h2><Facts person={rec} empty="Recipient unavailable." testId="kits-summary-shipping" /></section>
        <section className="admin-panel kits-panel"><h2>Billing doctor</h2><Facts person={order.billing || doctor} empty="Billing doctor unavailable." testId="kits-summary-billing" /></section>
        {order.patient && <section className="admin-panel kits-panel"><h2>Patient (historical)</h2><Facts person={order.patient} empty="Not selected." /></section>}
      </div>
    </div></div></AdminLayout>;
}

function Form() {
  const can = useOrderActions('kits');
  const BASE = useOrderBase('kits-consumables');
  const { portal, mr: authenticatedMR } = useOrderPortal();
  const [, navigate] = useLocation();
  const [v, setV] = useState(() => ({ ...blankOrder(), mrId: authenticatedMR?.id || '' }));
  const [errors, setErrors] = useState({});
  const [fileMsg, setFileMsg] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [doctor, setDoctor] = useState(null), [mr, setMr] = useState(authenticatedMR);
  const [policy, setPolicy] = useState(null), [policyError, setPolicyError] = useState('');
  const submission = useRef(null), saving = useRef(false), uploads = useRef(new Map());
  useEffect(() => {
    if (!can.upload_attachment) return undefined;
    const controller = new AbortController();
    request('/policy', { signal: controller.signal }).then(setPolicy).catch((e) => { if (!controller.signal.aborted) setPolicyError(e.message); });
    return () => controller.abort();
  }, [can.upload_attachment]);
  useEffect(() => setNavigationGuard(() => {
    if (!saving.current && !submission.current) return false;
    setErrors({ save: 'Keep this draft open and retry the unchanged submission to confirm its outcome.' });
    return true;
  }), []);
  const summaryRef = useRef(null);
  const set = (p) => setV((c) => ({ ...c, ...p }));
  const setKit = (p) => setV((c) => ({ ...c, kit: { ...c.kit, ...p } }));
  const setOther = (p) => setV((c) => ({ ...c, other: { ...c.other, ...p } }));
  const setOtherAddr = (p) => setV((c) => ({ ...c, other: { ...c.other, address: { ...c.other.address, ...p } } }));
  const focusId = (k) => requestAnimationFrame(() => { const el = document.getElementById(`kits-${k}`); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus(); } });
  const recipient = v.shipping === 'doctor' ? doctor : v.shipping === 'mr' ? mr : v.other;
  const e = errors;
  const inv = (k) => ({ id: `kits-${k}`, 'aria-invalid': Boolean(e[k]), 'aria-describedby': e[k] ? `kits-${k}-err` : undefined, 'data-testid': `kits-input-${k}` });

  function addFiles(list) {
    const files = [...list];
    const msg = validateAttachments(files, v.attachments);
    const sizeError = policy && files.some((f) => f.size > policy.maxBytes) ? `Each file must be at most ${fileSize(policy.maxBytes)}.` : '';
    setFileMsg(msg || sizeError);
    if (!msg && !sizeError) set({ attachments: [...v.attachments, ...files] });
  }
  async function save() {
    if (saving.current) return;
    if (fileMsg) {
      setErrors({ attachments: 'The rejected files were not attached. Choose valid files, or continue explicitly without them.' });
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    saving.current = true; setBusy(true); setErrors({});
    try {
      if (!submission.current) {
        const attachments = [];
        for (const file of v.attachments) {
          if (!uploads.current.has(file)) uploads.current.set(file, await uploadAttachment(file));
          attachments.push(uploads.current.get(file));
        }
        submission.current = { ...orderInput({ ...v, attachments }), idempotencyKey: crypto.randomUUID() };
      }
      const order = await request('', { body: submission.current });
      submission.current = null; saving.current = false; setUncertain(false);
      navigate(`${BASE}/${order.id}`);
    } catch (error) {
      setUncertain(Boolean(error.ambiguous));
      if (!error.ambiguous) submission.current = null;
      setErrors({ [error.stage || 'save']: error.message || 'Order was not saved. Your draft is preserved; retry.' });
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally { saving.current = false; setBusy(false); }
  }
  const errList = Object.entries(errors);
  const otherField = (k, label, addr, optional) => {
    const key = `other-${k}`;
    return <div className="kits-field"><label htmlFor={`kits-${key}`}>{label}{optional ? ' (optional)' : ''}</label>
      <input {...inv(key)} value={addr ? v.other.address[k] : v.other[k]} onChange={(ev) => (addr ? setOtherAddr({ [k]: ev.target.value }) : setOther({ [k]: ev.target.value }))} />
      <Err id={`kits-${key}-err`} text={e[key]} /></div>;
  };
  const consumable = (k, label) => <div className="kits-field"><label htmlFor={`kits-${k}`}>{label} - products</label>
    <input {...inv(k)} inputMode="numeric" value={v[k]} onChange={(ev) => set({ [k]: ev.target.value })} placeholder="Count, optional" /><Err id={`kits-${k}-err`} text={e[k]} /></div>;

  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits order-entry kits-entry">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Kits &amp; Consumables</p><h1>Add order</h1>
      <p className="admin-page-head__description">Choose who the order is for, configure the kit and consumables, then set shipping.</p></div>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="kits-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div>
    {policyError && <p role="alert">{policyError} <button type="button" className="kits-link" onClick={() => { setPolicyError(''); request('/policy').then(setPolicy).catch((e) => setPolicyError(e.message)); }}>Retry upload policy</button></p>}
    {errList.length > 0 && <div className="kits-errors" role="alert" tabIndex={-1} ref={summaryRef} data-testid="kits-error-summary"><strong>{e.upload ? 'Attachment upload needs attention' : e.save ? 'Order save needs attention' : e.validation ? 'Order validation needs attention' : `Fix ${errList.length} problem${errList.length > 1 ? 's' : ''} before saving`}</strong>
      <ul>{errList.map(([k, m]) => <li key={k}>{['upload', 'save', 'validation'].includes(k) ? <span data-testid={`kits-error-${k}`}>{m}</span> : <button type="button" className="kits-link" onClick={() => focusId(k === 'orderFor' ? `orderFor-${v.orderFor}` : k === 'shipping' ? `shipping-${v.shipping}` : k === 'products' ? 'kit-product' : k)} data-testid={`kits-error-${k}`}>{LABELS[k] || k}: {m}</button>}</li>)}</ul></div>}
    <fieldset className="kits-layout kits-form-fields" disabled={!can.add || busy || uncertain}>
      <div className="kits-main">
        <section className="admin-panel kits-panel" aria-labelledby="kits-h-order"><h2 id="kits-h-order">Order details</h2>
          <fieldset className="kits-radios" aria-describedby={e.orderFor ? 'kits-orderFor-err' : undefined}><legend>Order for</legend>
            {['doctor', 'mr'].map((o) => <label key={o}><input id={`kits-orderFor-${o}`} type="radio" name="orderFor" checked={v.orderFor === o} onChange={() => set({ orderFor: o })} data-testid={`kits-orderfor-${o}`} />{o === 'doctor' ? 'Doctor' : 'MR'}</label>)}</fieldset>
          <Err id="kits-orderFor-err" text={e.orderFor} />
          <Err id="kits-products-err" text={e.products} />
          <div className="kits-row"><strong>Stallergo Skin Prick Kit</strong>
            <div className="kits-grid">
              <div className="kits-field"><label htmlFor="kits-kit-product">Products</label>
                <select {...inv('kit-product')} value={v.kit.product} onChange={(ev) => setKit({ product: ev.target.value })}><option value="">Select</option>{KIT_PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select><Err id="kits-kit-product-err" text={e['kit-product']} /></div>
              {v.kit.product === 'Customized' && <div className="kits-field"><label htmlFor="kits-kit-custom">Custom value</label><input {...inv('kit-custom')} value={v.kit.custom} onChange={(ev) => setKit({ custom: ev.target.value })} /><Err id="kits-kit-custom-err" text={e['kit-custom']} /></div>}
              <div className="kits-field"><label htmlFor="kits-kit-volume">Volume (ml)</label><input {...inv('kit-volume')} inputMode="decimal" value={v.kit.volume} onChange={(ev) => setKit({ volume: ev.target.value })} /><Err id="kits-kit-volume-err" text={e['kit-volume']} /></div>
              <div className="kits-field"><label htmlFor="kits-kit-quantity">Quantity</label><input {...inv('kit-quantity')} inputMode="numeric" value={v.kit.quantity} onChange={(ev) => setKit({ quantity: ev.target.value })} /><Err id="kits-kit-quantity-err" text={e['kit-quantity']} /></div>
            </div><p className="kits-hint">Product, volume and quantity are configuration values, not prices.</p></div>
          <div className="kits-row"><div className="kits-grid">{consumable('lancets', 'Lancets')}{consumable('applicators', 'Applicators')}{consumable('tray', 'Tray')}</div>
            <p className="kits-hint">Leave a row blank to leave it out of the order. Consumables-only orders are fine.</p></div>
        </section>
        <section className="admin-panel kits-panel" aria-labelledby="kits-h-more"><h2 id="kits-h-more">Remarks and attachments</h2>
          <div className="kits-field"><label htmlFor="kits-remarks">Remarks</label><textarea id="kits-remarks" rows={3} value={v.remarks} onChange={(ev) => set({ remarks: ev.target.value })} data-testid="kits-input-remarks" /></div>
          <div className="kits-field" style={{ marginTop: 14 }}><span>Attachments (optional)</span>
            <MasterFilePicker id="kits-attachments" icon={Paperclip} disabled={!can.upload_attachment} multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" aria-label="Kits attachments (optional)" aria-invalid={Boolean(fileMsg || e.attachments)} aria-describedby="kits-files-hint kits-attachments-err" onChange={(ev) => { addFiles(ev.target.files); ev.target.value = ''; }} data-testid="kits-input-files">{v.attachments.length ? `${v.attachments.length} files selected — choose more` : 'Choose PDF or image files'}</MasterFilePicker>
            <p className="kits-hint" id="kits-files-hint">Up to 10 PDF, JPEG, PNG or WebP files, {policy ? fileSize(policy.maxBytes) : '10 MB'} each. Files upload privately when saving and must pass verification and scanning before attachment. Import/export excludes file contents.</p>
            <Err id="kits-attachments-err" text={fileMsg || e.attachments} />
            {fileMsg && <button type="button" className="kits-link kits-file-dismiss" onClick={() => { setFileMsg(''); setErrors((current) => ({ ...current, attachments: undefined })); }}>Continue without rejected files</button>}</div>
          <OrderFileList label="Selected attachments" empty="No files selected." data-testid="kits-file-list">{v.attachments.map((f, i) => <OrderFileRow key={`${f.name}-${i}`} name={f.name} size={f.size}
            status="Selected locally — uploads and verification occur when saving."
            actions={<button type="button" className="admin-icon-button" aria-label={`Remove ${f.name}`} onClick={() => set({ attachments: v.attachments.filter((_, j) => j !== i) })} data-testid={`kits-remove-file-${i}`}><X size={16} aria-hidden="true" /></button>} />)}</OrderFileList>
        </section>
      </div>
      <div className="kits-side">
        <section className="admin-panel kits-panel" aria-labelledby="kits-h-people"><h2 id="kits-h-people">Doctor details</h2>
          <div className="kits-grid">
            <KitsReferenceSelect showClearAction={false} disabled={busy || uncertain} id="kits-doctorId" kind="doctors" label="Doctor (billing)" value={v.doctorId} onChange={(x) => { set({ doctorId: x, patientId: '', mrId: authenticatedMR?.id || '' }); setMr(authenticatedMR); }} onPerson={setDoctor} />
            {portal === 'mr' ? <label className="kits-field" htmlFor="kits-mrId">MR (signed-in account)<input id="kits-mrId" readOnly value={authenticatedMR.name} /></label>
              : <KitsReferenceSelect showClearAction={false} disabled={busy || uncertain} id="kits-mrId" kind="mrs" label={`MR${v.orderFor === 'mr' || v.shipping === 'mr' ? '' : ' (optional)'}`} value={v.mrId} onChange={(x) => set({ mrId: x })} onPerson={setMr} />}
            <KitsReferenceSelect showClearAction={false} disabled={busy || uncertain} id="kits-patientId" kind="patients" label="Patient (optional)" value={v.patientId} onChange={(x) => set({ patientId: x })} />
            <p className="kits-hint">Patient is optional for supply orders. If selected, the Patient must belong to the billing Doctor. A selected MR must match that Doctor’s current assignment. No masters or clinical history are created.</p>
          </div></section>
        <section className="admin-panel kits-panel" aria-labelledby="kits-h-ship"><h2 id="kits-h-ship">Shipping details</h2>
          <fieldset className="kits-radios" aria-describedby={e.shipping ? 'kits-shipping-err' : undefined}><legend>Ship to</legend>
            {[['doctor', 'Doctor'], ['mr', 'MR'], ['other', 'Other']].map(([s, l]) => <label key={s}><input id={`kits-shipping-${s}`} type="radio" name="shipping" checked={v.shipping === s} onChange={() => set({ shipping: s })} data-testid={`kits-ship-${s}`} />{l}</label>)}</fieldset>
          <Err id="kits-shipping-err" text={e.shipping} />
          {v.shipping === 'other' ? <div className="kits-grid" data-testid="kits-other-form">
            {otherField('name', 'Name')}{otherField('phone', 'Phone no.')}{otherField('line1', 'Address line 1', true)}{otherField('line2', 'Address line 2', true, true)}{otherField('landmark', 'Landmark', true, true)}{otherField('country', 'Country', true)}{otherField('state', 'State', true)}{otherField('city', 'City', true)}{otherField('pincode', 'Pincode', true)}</div>
            : <Facts person={recipient} empty={`Choose a ${v.shipping === 'mr' ? 'MR' : 'doctor'} to see the shipping address. Address unavailable.`} testId="kits-shipping-facts" />}
        </section>
        <section className="admin-panel kits-panel" aria-labelledby="kits-h-bill"><h2 id="kits-h-bill">Billing details</h2>
          <p className="kits-hint">Always the selected doctor, independent of shipping.</p>
          <Facts person={doctor} empty="Choose a doctor to see billing details." testId="kits-billing-facts" />
          {doctor && <span className="kits-sub" hidden>{addressText(doctor.address)}</span>}
        </section>
      </div>
    </fieldset>
    {!can.upload_attachment && <p role="status">Upload Attachment permission is required for this form's mandatory attachment. Your draft remains in this tab.</p>}
    <div className="kits-actions"><button type="button" className="admin-button" disabled={!can.add || !can.upload_attachment || busy || !policy} onClick={save} data-testid="kits-save">{busy ? 'Saving…' : uncertain ? 'Retry unchanged save' : 'Save order'}</button>
      {!busy && !uncertain && <Link href={BASE} className="admin-button admin-button--secondary" data-testid="kits-cancel">Cancel</Link>}</div>
    </div></AdminLayout>;
}

export { STATUSES };
