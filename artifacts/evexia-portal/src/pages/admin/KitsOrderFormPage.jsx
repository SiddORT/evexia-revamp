import { useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Paperclip } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import { DOCTORS, KIT_PRODUCTS, MRS, STATUSES, addressText, blankOrder, demoStore, fileSize, productSummary, shippingRecipient, validateAttachments } from '../../services/kitsOrdersDemo.js';
import '../../kitsOrders.css';

const BASE = '/admin/orders/kits-consumables';
const LABELS = { orderFor: 'Order for', doctorId: 'Doctor', mrId: 'MR', products: 'Products', 'kit-product': 'Kit product', 'kit-custom': 'Custom value', 'kit-volume': 'Kit volume', 'kit-quantity': 'Kit quantity', lancets: 'Lancets', applicators: 'Applicators', tray: 'Tray', shipping: 'Shipping', 'other-name': 'Recipient name', 'other-phone': 'Recipient phone', 'other-line1': 'Address line 1', 'other-country': 'Country', 'other-state': 'State', 'other-city': 'City', 'other-pincode': 'Pincode', attachments: 'Attachments' };
const Err = ({ id, text }) => (text ? <p className="kits-error" id={id} role="alert">{text}</p> : null);

function Facts({ person, empty, testId }) {
  if (!person) return <p className="kits-unavailable" data-testid={testId}>{empty}</p>;
  const a = person.address || {};
  const rows = [['Name', person.name], ['Phone no.', person.phone], ['Address line 1', a.line1], ['Address line 2', a.line2], ['Landmark', a.landmark], ['Country', a.country], ['State', a.state], ['City', a.city], ['Pincode', a.pincode]];
  return <dl className="kits-facts" data-testid={testId}>{rows.map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '-'}</dd></div>)}</dl>;
}

export default function KitsOrderFormPage({ id }) {
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  if (id) {
    const order = snap.orders.find((o) => o.id === id);
    if (!order) return <AdminLayout title="KITS & CONSUMABLES"><div className="kits"><div className="admin-panel kits-panel kits-empty" data-testid="kits-missing">
      <h1>Order not available</h1><p>This demo order does not exist. Demo data resets when the page reloads.</p>
      <Link href={BASE} className="admin-button">Back to orders</Link></div></div></AdminLayout>;
    return <Summary order={order} />;
  }
  return <Form />;
}

function Summary({ order }) {
  const doctor = DOCTORS.find((d) => d.id === order.doctorId);
  const mr = MRS.find((m) => m.id === order.mrId);
  const k = order.kit || {};
  const kitOn = k.product || k.custom || k.volume || k.quantity;
  const rec = order.recipient || shippingRecipient(order);
  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Kits &amp; Consumables</p><h1>Order {order.number}</h1>
      <p className="admin-page-head__description">Read-only summary of this demo order.</p></div>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="kits-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div>
    <p className="kits-boundary">Fictional demo data kept in browser memory. Files were never uploaded.</p>
    <div className="kits-layout">
      <div className="kits-main">
        <section className="admin-panel kits-panel" aria-labelledby="kits-s-items"><h2 id="kits-s-items">Order details</h2>
          <dl className="kits-facts" data-testid="kits-summary-items">
            <div><dt>Summary</dt><dd>{productSummary(order)}</dd></div>
            <div><dt>Order for</dt><dd>{order.orderFor === 'mr' ? `MR: ${mr?.name || '-'}` : `Doctor: ${doctor?.name || '-'}`}</dd></div>
            <div><dt>Doctor</dt><dd>{doctor?.name || '-'}</dd></div>
            <div><dt>MR</dt><dd>{mr?.name || 'Not selected'}</dd></div>
            {kitOn && <><div><dt>Kit product</dt><dd>{k.product === 'Customized' ? `Customized (${k.custom})` : k.product || '-'}</dd></div><div><dt>Kit volume (ml)</dt><dd>{k.volume || '-'}</dd></div><div><dt>Kit quantity</dt><dd>{k.quantity || '-'}</dd></div></>}
            {order.lancets && <div><dt>Lancets</dt><dd>{order.lancets}</dd></div>}
            {order.applicators && <div><dt>Applicators</dt><dd>{order.applicators}</dd></div>}
            {order.tray && <div><dt>Tray</dt><dd>{order.tray}</dd></div>}
            <div><dt>Status</dt><dd data-testid="kits-summary-status">{order.status}</dd></div>
            <div><dt>Payment</dt><dd>{order.paymentStatus}</dd></div>
            <div><dt>Date</dt><dd>{order.date}</dd></div>
            <div><dt>Remarks</dt><dd>{order.remarks || 'None'}</dd></div></dl>
          <h2 style={{ marginTop: 16 }}>Attachments (names only)</h2>
          {order.attachments?.length ? <ul className="kits-files">{order.attachments.map((f, i) => <li key={i}><span><Paperclip size={13} aria-hidden="true" /> {f.name} ({fileSize(f.size)})</span></li>)}</ul> : <p className="kits-hint">No files attached.</p>}
        </section></div>
      <div className="kits-side">
        <section className="admin-panel kits-panel"><h2>Shipping ({order.shipping})</h2><Facts person={rec} empty="Recipient unavailable." testId="kits-summary-shipping" /></section>
        <section className="admin-panel kits-panel"><h2>Billing doctor</h2><Facts person={order.billing || doctor} empty="Billing doctor unavailable." testId="kits-summary-billing" /></section>
      </div>
    </div></div></AdminLayout>;
}

function Form() {
  const [, navigate] = useLocation();
  const [v, setV] = useState(blankOrder);
  const [errors, setErrors] = useState({});
  const [fileMsg, setFileMsg] = useState('');
  const summaryRef = useRef(null);
  const set = (p) => setV((c) => ({ ...c, ...p }));
  const setKit = (p) => setV((c) => ({ ...c, kit: { ...c.kit, ...p } }));
  const setOther = (p) => setV((c) => ({ ...c, other: { ...c.other, ...p } }));
  const setOtherAddr = (p) => setV((c) => ({ ...c, other: { ...c.other, address: { ...c.other.address, ...p } } }));
  const focusId = (k) => requestAnimationFrame(() => { const el = document.getElementById(`kits-${k}`); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus(); } });
  const doctorOptions = DOCTORS.map((d) => ({ value: d.id, label: d.name }));
  const mrOptions = MRS.map((m) => ({ value: m.id, label: m.name }));
  const doctor = DOCTORS.find((d) => d.id === v.doctorId);
  const recipient = shippingRecipient(v);
  const e = errors;
  const inv = (k) => ({ id: `kits-${k}`, 'aria-invalid': Boolean(e[k]), 'aria-describedby': e[k] ? `kits-${k}-err` : undefined, 'data-testid': `kits-input-${k}` });

  function addFiles(list) {
    const files = [...list];
    const msg = validateAttachments(files, v.attachments);
    setFileMsg(msg || '');
    if (!msg) set({ attachments: [...v.attachments, ...files.map((f) => ({ name: f.name, size: f.size, type: f.type }))] });
  }
  function save() {
    if (fileMsg) {
      setErrors({ attachments: 'The rejected files were not attached. Choose valid files, or continue explicitly without them.' });
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const { order, errors: errs } = demoStore.saveOrder(v);
    if (errs && Object.keys(errs).length) { setErrors(errs); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    setErrors({});
    demoStore.setNotice(`Demo order ${order.number} saved for this session only. Status Confirmed, payment Mock unpaid.`);
    navigate(BASE);
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

  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Kits &amp; Consumables</p><h1>Add order</h1>
      <p className="admin-page-head__description">Choose who the order is for, configure the kit and consumables, then set shipping.</p></div>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="kits-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div>
    <p className="kits-boundary">Fictional demo data in browser memory only; a reload resets everything. Files are not uploaded.</p>
    {errList.length > 0 && <div className="kits-errors" role="alert" tabIndex={-1} ref={summaryRef} data-testid="kits-error-summary"><strong>Fix {errList.length} problem{errList.length > 1 ? 's' : ''} before saving</strong>
      <ul>{errList.map(([k, m]) => <li key={k}><button type="button" className="kits-link" onClick={() => focusId(k === 'orderFor' ? `orderFor-${v.orderFor}` : k === 'shipping' ? `shipping-${v.shipping}` : k === 'products' ? 'kit-product' : k)} data-testid={`kits-error-${k}`}>{LABELS[k] || k}: {m}</button></li>)}</ul></div>}
    <div className="kits-layout">
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
          <div className="kits-field" style={{ marginTop: 14 }}><label htmlFor="kits-attachments">Attachments (optional)</label>
            <input id="kits-attachments" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" aria-describedby="kits-files-hint kits-attachments-err" onChange={(ev) => { addFiles(ev.target.files); ev.target.value = ''; }} data-testid="kits-input-files" />
            <p className="kits-hint" id="kits-files-hint">Up to 10 PDF, JPEG, PNG or WebP files, 10 MB each. Only names and sizes are kept; nothing is uploaded.</p>
            <Err id="kits-attachments-err" text={fileMsg || e.attachments} />
            {fileMsg && <button type="button" className="kits-link kits-file-dismiss" onClick={() => { setFileMsg(''); setErrors((current) => ({ ...current, attachments: undefined })); }}>Continue without rejected files</button>}</div>
          {v.attachments.length > 0 ? <ul className="kits-files" aria-label="Attached files" data-testid="kits-file-list">{v.attachments.map((f, i) => <li key={`${f.name}-${i}`}><span><Paperclip size={13} aria-hidden="true" /> {f.name} ({fileSize(f.size)})</span>
            <button type="button" className="kits-link" aria-label={`Remove ${f.name}`} onClick={() => set({ attachments: v.attachments.filter((_, j) => j !== i) })} data-testid={`kits-remove-file-${i}`}>Remove</button></li>)}</ul> : <p className="kits-hint">No files attached.</p>}
        </section>
        <div className="kits-actions"><button type="button" className="admin-button" onClick={save} data-testid="kits-save">Save order</button>
          <Link href={BASE} className="admin-button admin-button--secondary" data-testid="kits-cancel">Cancel</Link></div>
      </div>
      <div className="kits-side">
        <section className="admin-panel kits-panel" aria-labelledby="kits-h-people"><h2 id="kits-h-people">Doctor details</h2>
          <div className="kits-grid">
            <div className="kits-field"><label htmlFor="kits-doctorId">Doctor (billing)</label>
              <SearchableSelect id="kits-doctorId" label="Doctor" value={v.doctorId} options={doctorOptions} onChange={(x) => set({ doctorId: x })} placeholder="Select doctor" invalid={e.doctorId} describedBy={e.doctorId ? 'kits-doctorId-err' : undefined} /><Err id="kits-doctorId-err" text={e.doctorId} /></div>
            <div className="kits-field"><label htmlFor="kits-mrId">MR{v.orderFor === 'mr' || v.shipping === 'mr' ? '' : ' (optional)'}</label>
              <SearchableSelect id="kits-mrId" label="MR" value={v.mrId} options={mrOptions} onChange={(x) => set({ mrId: x })} placeholder="Select MR" invalid={e.mrId} describedBy={e.mrId ? 'kits-mrId-err' : undefined} /><Err id="kits-mrId-err" text={e.mrId} /></div>
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
    </div></div></AdminLayout>;
}

export { STATUSES };
