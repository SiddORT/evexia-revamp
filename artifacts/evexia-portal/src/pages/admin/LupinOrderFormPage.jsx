import { useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Paperclip } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import { DOCTORS, MRS, demoStore, money, totalMinor, validateAttachments, validateOrder } from '../../services/lupinOrdersDemo.js';
import '../../lupinOrders.css';

const BASE = '/admin/orders/lupin';
const doctorOptions = DOCTORS.map((d) => ({ value: d.id, label: d.name }));
const mrOptions = MRS.map((m) => ({ value: m.id, label: m.name }));
const LABEL = { doctorId: 'Doctor', mrId: 'MR', patientCount: 'No. of Patients', price: 'Price (per Test)', attachments: 'Attachments' };
const TARGET = { doctorId: 'lupin-doctorId', mrId: 'lupin-mrId', patientCount: 'lupin-patientCount', price: 'lupin-price', attachments: 'lupin-files' };
const size = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const Err = ({ id, text }) => text ? <p className="lupin-error" id={id} role="alert">{text}</p> : null;

export default function LupinOrderFormPage({ id }) {
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const order = id ? snap.orders.find((o) => o.id === id) : null;
  if (id && !order) return <AdminLayout title="LUPIN"><div className="lupin"><div className="admin-panel lupin-empty" data-testid="empty-lupin-missing"><h1>Order not available</h1><p>This demo order does not exist. Demo data resets on reload.</p><Link href={BASE} className="admin-button">Back to orders</Link></div></div></AdminLayout>;
  return order ? <Review order={order} /> : <Form />;
}

function Review({ order }) {
  return <AdminLayout title="LUPIN"><div className="lupin">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Lupin</p><h1>Order {order.number}</h1><p className="admin-page-head__description">Read-only review of this demo order.</p></div>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="link-lupin-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div>
    <p className="lupin-notice">Fictional, session-only record. Attachment names are metadata only; nothing was uploaded.</p>
    <section className="admin-panel lupin-section" aria-labelledby="lupin-h-sum"><h2 id="lupin-h-sum">Summary</h2>
      <dl className="lupin-facts">
        <div><dt>Date</dt><dd>{order.date}</dd></div><div><dt>Doctor</dt><dd>{order.doctorName}</dd></div><div><dt>MR</dt><dd>{order.mrName}</dd></div>
        <div><dt>No. of Patients</dt><dd>{order.patientCount}</dd></div><div><dt>Price (per Test)</dt><dd>{money(totalMinor('1', order.price))}</dd></div>
        <div><dt>Total Amount</dt><dd data-testid="text-lupin-review-total">{money(totalMinor(order.patientCount, order.price))}</dd></div>
        <div><dt>Order status</dt><dd>{order.status}</dd></div><div><dt>Payment status</dt><dd>{order.paymentStatus}</dd></div></dl>
      <div><h2>Attachments</h2>{order.attachments?.length ? <ul className="lupin-files" aria-label="Attachment names">{order.attachments.map((f, i) => <li key={`${f.name}-${i}`}><span><Paperclip size={13} aria-hidden="true" /> {f.name} ({size(f.size)})</span></li>)}</ul> : <p className="lupin-hint">No attachments recorded.</p>}</div>
      <div><h2>Remarks</h2><p style={{ margin: 0, overflowWrap: 'anywhere' }}>{order.remarks || 'No remarks.'}</p></div>
    </section></div></AdminLayout>;
}

function Form() {
  const [, navigate] = useLocation();
  const [v, setV] = useState({ doctorId: '', mrId: '', patientCount: '', price: '1000', attachments: [], remarks: '' });
  const [errors, setErrors] = useState({});
  const [fileMsg, setFileMsg] = useState('');
  const summary = useRef(null);
  const set = (p) => setV((c) => ({ ...c, ...p }));
  const focusId = (t) => requestAnimationFrame(() => { const el = document.getElementById(t); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus(); } });
  const total = totalMinor(v.patientCount, v.price);
  const addFiles = (list) => {
    const files = [...list];
    const msg = validateAttachments(files, v.attachments);
    setFileMsg(msg);
    if (!msg) { set({ attachments: [...v.attachments, ...files.map((f) => ({ name: f.name, size: f.size, type: f.type }))] }); setErrors((e) => { const { attachments, ...r } = e; return r; }); }
  };
  const save = (e) => {
    e.preventDefault();
    const errs = validateOrder(v);
    if (Object.keys(errs).length) { setErrors(errs); requestAnimationFrame(() => summary.current?.focus()); return; }
    const { errors: se } = demoStore.saveOrder(v);
    if (se && Object.keys(se).length) { setErrors(se); requestAnimationFrame(() => summary.current?.focus()); return; }
    navigate(BASE);
  };
  const list = Object.entries(errors).filter(([, m]) => m);
  const num = (k, label, extra = {}) => <div className="lupin-field"><label htmlFor={`lupin-${k}`}>{label} <span aria-hidden="true">*</span></label>
    <input id={`lupin-${k}`} inputMode="decimal" value={v[k]} onChange={(e) => set({ [k]: e.target.value })} aria-required="true" aria-invalid={Boolean(errors[k])} aria-describedby={errors[k] ? `lupin-req lupin-${k}-err` : 'lupin-req'} data-testid={`input-lupin-${k}`} {...extra} /><Err id={`lupin-${k}-err`} text={errors[k]} /></div>;
  return <AdminLayout title="LUPIN"><form className="lupin" onSubmit={save} noValidate aria-label="Add Lupin Order">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Lupin</p><h1>Add Lupin Order</h1></div><span id="lupin-req" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Required field</span></div>
    <p className="lupin-notice">Fictional demo: the order is kept in browser memory only; a full reload resets it. Attachments are not uploaded; only file metadata is kept. New orders use illustrative Confirmed / unpaid status.</p>
    {list.length > 0 && <div className="lupin-errors" role="alert" tabIndex={-1} ref={summary} data-testid="lupin-errors"><strong>Fix {list.length} problem{list.length > 1 ? 's' : ''} before saving</strong>
      <ul>{list.map(([k, m]) => <li key={k}><button type="button" className="lupin-link" onClick={() => focusId(TARGET[k] || k)}>{LABEL[k] || k}: {m}</button></li>)}</ul></div>}
    <section className="admin-panel lupin-section" aria-labelledby="lupin-h-det"><h2 id="lupin-h-det">Order Details</h2>
      <div className="lupin-grid">
        <div className="lupin-field"><label htmlFor="lupin-doctorId">Doctor <span aria-hidden="true">*</span></label>
          <SearchableSelect viewportMenu id="lupin-doctorId" label="Doctor" value={v.doctorId} options={doctorOptions} onChange={(x) => set({ doctorId: x })} placeholder="Select doctor" invalid={errors.doctorId} describedBy={errors.doctorId ? 'lupin-req lupin-doctorId-err' : 'lupin-req'} /><Err id="lupin-doctorId-err" text={errors.doctorId} /></div>
        <div className="lupin-field"><label htmlFor="lupin-mrId">MR <span aria-hidden="true">*</span></label>
          <SearchableSelect viewportMenu id="lupin-mrId" label="MR" value={v.mrId} options={mrOptions} onChange={(x) => set({ mrId: x })} placeholder="Select MR" invalid={errors.mrId} describedBy={errors.mrId ? 'lupin-req lupin-mrId-err' : 'lupin-req'} /><Err id="lupin-mrId-err" text={errors.mrId} /></div>
        {num('patientCount', 'No. of Patients', { inputMode: 'numeric' })}
        {num('price', 'Price (per Test)')}
        <div className="lupin-field"><label htmlFor="lupin-total">Total Amount (₹)</label><input id="lupin-total" readOnly value={money(total)} aria-live="polite" data-testid="lupin-total" /></div>
      </div></section>
    <section className="admin-panel lupin-section" aria-labelledby="lupin-h-att"><h2 id="lupin-h-att">Attachments and remarks</h2>
      <div className="lupin-more-grid"><div>
      <div className="lupin-field"><label htmlFor="lupin-files">Attachments <span aria-hidden="true">*</span></label>
        <input id="lupin-files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" aria-required="true" aria-invalid={Boolean(fileMsg || errors.attachments)} aria-describedby={`lupin-req lupin-files-hint${fileMsg || errors.attachments ? ' lupin-files-err' : ''}`} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-testid="input-lupin-files" />
        <p className="lupin-hint" id="lupin-files-hint">Up to 10 PDF, JPEG, PNG or WebP files, 10 MB each. Files are not uploaded.</p>
        <Err id="lupin-files-err" text={fileMsg || errors.attachments} /></div>
      {v.attachments.length > 0 ? <ul className="lupin-files" aria-label="Selected files">{v.attachments.map((f, i) => <li key={`${f.name}-${i}`}><span><Paperclip size={13} aria-hidden="true" /> {f.name} ({size(f.size)})</span><button type="button" className="lupin-link" onClick={() => { set({ attachments: v.attachments.filter((_, j) => j !== i) }); setFileMsg(''); }} aria-label={`Remove ${f.name}`}>Remove</button></li>)}</ul> : <p className="lupin-hint">No files selected.</p>}
      </div>
      <label className="lupin-field">Remarks<textarea value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} data-testid="input-lupin-remarks" /></label>
      </div>
    </section>
    <div className="lupin-actions"><button type="submit" className="admin-button" data-testid="button-lupin-save">Save</button>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="link-lupin-cancel">Cancel</Link></div>
  </form></AdminLayout>;
}
