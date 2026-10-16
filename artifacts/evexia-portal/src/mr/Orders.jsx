import { Fragment, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Plus, Trash2 } from 'lucide-react';
import { PRODUCTS, calculateOrderTotal, money, orderBalance, orderPaymentStatus, saveOrder } from '../services/mrWorkspaceDemo.js';
import { Empty, Field, Head, PatientLock, statusPill, useDate, useDirtyGuard, useWs } from './common.jsx';

export function OrderList() {
  const { state } = useWs();
  const date = useDate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const name = (id) => state.doctors.find((d) => d.id === id)?.name || 'Unknown doctor';
  const rows = state.orders.filter((o) => (status === 'all' || o.status === status) && `${o.id} ${name(o.doctorId)}`.toLowerCase().includes(q.trim().toLowerCase()));
  return <>
    <Head eyebrow="Orders" title="Orders" text="Only placed, non-cancelled orders count toward sales. Drafts do not."><Link href="/mr/orders/new" className="admin-button" data-testid="link-new-order"><Plus size={16} aria-hidden="true" /> New order</Link></Head>
    <div className="mrw-bar"><input type="search" aria-label="Search orders" placeholder="Search order or doctor" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-orders" />
      <select className="admin-select" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-order-status"><option value="all">All statuses</option><option value="draft">Draft</option><option value="placed">Placed</option><option value="cancelled">Cancelled</option></select></div>
    <div className="mrw-card">{rows.length === 0 ? <Empty title="No orders match" text="Start a new demo order." to="/mr/orders/new" action="New order" /> :
      <div className="mrw-scroll" tabIndex={0} role="region" aria-label="Orders table, scrolls horizontally"><table className="mrw-table"><thead><tr><th>Order</th><th>Doctor</th><th>Date</th><th className="num">Total</th><th>Status</th><th>Payment</th></tr></thead><tbody>
        {rows.map((o) => <tr key={o.id} data-testid={`row-order-${o.id}`}><td><Link href={`/mr/orders/${encodeURIComponent(o.id)}`}>{o.id}</Link></td><td>{name(o.doctorId)}</td><td>{date(o.date)}</td><td className="num">{money(o.total)}</td><td>{statusPill(o.status)}</td><td>{o.status === 'placed' ? statusPill(orderPaymentStatus(state, o)) : '—'}</td></tr>)}</tbody></table></div>}</div>
  </>;
}

export function OrderDetail({ id }) {
  const { state, apply, setFlash } = useWs();
  const date = useDate();
  const busy = useRef(false);
  const [message, setMessage] = useState('');
  const o = state.orders.find((x) => x.id === id);
  if (!o) return <div className="mrw-card"><Empty title="Order not found" text="This demo order is not in your workspace." to="/mr/orders" action="Back to orders" /></div>;
  const doc = state.doctors.find((d) => d.id === o.doctorId);
  function place() {
    if (busy.current) return;
    busy.current = true;
    const r = apply((s) => saveOrder(s, { doctorId: o.doctorId, items: o.items }, true, o.id));
    busy.current = false;
    if (!r.ok) { setMessage(r.message); return; }
    setFlash(`Order ${o.id} placed in the demo workspace. It now counts toward sales.`, `/mr/orders/${o.id}`);
  }
  return <>
    <Head eyebrow="Orders" title={`Order ${o.id}`} text={`${doc?.name || 'Unknown doctor'} · ${date(o.date)}`}>
      {o.status === 'draft' && <><Link href={`/mr/orders/${encodeURIComponent(o.id)}/edit`} className="admin-button admin-button--secondary">Edit draft</Link><button type="button" className="admin-button" onClick={place} data-testid="button-place-draft">Place order</button></>}
      {o.status === 'placed' && orderBalance(state, o) > 0 && <Link href={`/mr/payments/new?doctor=${encodeURIComponent(o.doctorId)}&order=${encodeURIComponent(o.id)}`} className="admin-button">Add payment</Link>}</Head>
    {message && <div className="mrw-alert" role="alert">{message}</div>}
    <div className="mrw-split"><div className="mrw-card"><h2>Items</h2><div className="mrw-scroll" tabIndex={0} role="region" aria-label="Order items"><table className="mrw-table"><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Line total</th></tr></thead><tbody>
      {o.items.map((i) => { const p = PRODUCTS.find((x) => x.id === i.productId); return <tr key={i.productId}><td>{p?.name}<div className="mrw-notice">{p?.category}</div></td><td className="num">{i.quantity}</td><td className="num">{money(p?.price || 0)}</td><td className="num">{money((p?.price || 0) * i.quantity)}</td></tr>; })}
      <tr><td colSpan={3}><strong>Order total</strong></td><td className="num"><strong data-testid="text-order-total">{money(o.total)}</strong></td></tr></tbody></table></div></div>
      <div className="mrw-card"><h2>Status</h2><p>{statusPill(o.status)} {o.status === 'placed' && statusPill(orderPaymentStatus(state, o))}</p>{o.status === 'placed' && <p>Balance due: <strong>{money(orderBalance(state, o))}</strong></p>}<p className="mrw-notice">{o.status === 'draft' ? 'Draft: not counted in sales.' : ''}</p><PatientLock /></div></div>
  </>;
}

const STEPS = ['Doctor', 'Products', 'Review'];
export function OrderForm({ id }) {
  const { state, apply, setFlash } = useWs();
  const [, navigate] = useLocation();
  const search = new URLSearchParams(useSearch());
  const existing = id ? state.orders.find((o) => o.id === id) : null;
  const [doctorId, setDoctorId] = useState(existing?.doctorId || (state.doctors.some((d) => d.id === search.get('doctor')) ? search.get('doctor') : ''));
  const [items, setItems] = useState(existing ? existing.items.map((i) => ({ ...i })) : []);
  const [step, setStep] = useState(0);
  const [cat, setCat] = useState('all');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const done = useRef(false);
  const dirty = !done.current && (items.length > 0 || (!existing && Boolean(doctorId)));
  useDirtyGuard(dirty);
  if (id && (!existing || existing.status !== 'draft')) return <div className="mrw-card"><Empty title="Draft not found" text="Only draft orders can be edited." to="/mr/orders" action="Back to orders" /></div>;
  const cats = [...new Set(PRODUCTS.map((p) => p.category))];
  const choices = PRODUCTS.filter((p) => cat === 'all' || p.category === cat);
  const doc = state.doctors.find((d) => d.id === doctorId);
  function add() {
    if (!product) { setError('Choose a product.'); return; }
    if (!/^[1-9]\d{0,3}$/.test(qty.trim())) { setError('Quantity must be a positive whole number up to 9999.'); return; }
    const combined = (items.find((i) => i.productId === product)?.quantity || 0) + Number(qty);
    if (combined > 9999) { setError('Combined product quantity must not exceed 9999.'); return; }
    setError('');
    setItems((cur) => cur.some((i) => i.productId === product) ? cur.map((i) => i.productId === product ? { ...i, quantity: i.quantity + Number(qty) } : i) : [...cur, { productId: product, quantity: Number(qty) }]);
    setQty('1');
  }
  function submit(place) {
    if (busy.current) return;
    busy.current = true;
    const before = new Set(state.orders.map((o) => o.id));
    const r = apply((s) => saveOrder(s, { doctorId, items }, place, existing?.id || null));
    busy.current = false;
    if (!r.ok) { setError(r.message); return; }
    done.current = true;
    const oid = existing?.id || r.state.orders.find((o) => !before.has(o.id))?.id;
    setFlash(place ? `Order ${oid} placed in the demo workspace.` : `Draft ${oid} saved. It does not count toward sales yet.`, `/mr/orders/${oid}`);
    navigate(`/mr/orders/${encodeURIComponent(oid)}`);
  }
  function next() {
    if (step === 0 && !doctorId) { setError('Select one of your demo doctors.'); return; }
    if (step === 1 && items.length === 0) { setError('Add at least one product.'); return; }
    if (step === 1) {
      try { calculateOrderTotal(items); } catch (e) { setError(e.message); return; }
    }
    setError(''); setStep(step + 1);
  }
  let total = 0; try { total = calculateOrderTotal(items); } catch { total = 0; }
  return <>
    <Head eyebrow="Orders" title={existing ? `Edit draft ${existing.id}` : 'New order'} text="Fictional products only. No patient details are collected." />
    <div className="mrw-card">
      <ol className="mrw-steps">{STEPS.map((n, i) => <li key={n} aria-current={i === step ? 'step' : undefined}>{i + 1}. {n}</li>)}</ol>
      {error && <div className="mrw-alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
        {step === 0 && (state.doctors.length === 0 ? <Empty title="No doctors yet" text="Onboard a doctor before placing an order." to="/mr/doctors/new" action="Onboard doctor" /> :
          <Field id="ord-doctor" label="Doctor"><select className="admin-select" id="ord-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} data-testid="select-order-doctor"><option value="">Select a doctor</option>{state.doctors.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.clinic}</option>)}</select></Field>)}
        {step === 1 && <>
          <div className="mrw-form"><Field id="ord-cat" label="Category"><select className="admin-select" id="ord-cat" value={cat} onChange={(e) => { setCat(e.target.value); setProduct(''); }}><option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field id="ord-product" label="Product"><select className="admin-select" id="ord-product" value={product} onChange={(e) => setProduct(e.target.value)} data-testid="select-order-product"><option value="">Select a product</option>{choices.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price)}</option>)}</select></Field>
            <Field id="ord-qty" label="Quantity" hint="Positive whole number"><input className="mrw-input" id="ord-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="input-order-quantity" /></Field>
            <div style={{ alignSelf: 'end' }}><button type="button" className="admin-button" onClick={add} data-testid="button-add-item">Add item</button></div></div>
          {items.length === 0 ? <p className="mrw-notice">No items added yet.</p> : <ul className="mrw-list">{items.map((i) => { const p = PRODUCTS.find((x) => x.id === i.productId); return <li key={i.productId} className="mrw-line"><span>{p?.name} × {i.quantity}<br /><small>{money((p?.price || 0) * i.quantity)}</small></span><button type="button" className="admin-button admin-button--secondary" aria-label={`Remove ${p?.name}`} onClick={() => setItems(items.filter((x) => x !== i))}><Trash2 size={16} aria-hidden="true" /></button></li>; })}</ul>}
          <strong>Running total: {money(total)}</strong></>}
        {step === 2 && <><dl className="mrw-dl"><dt>Doctor</dt><dd>{doc?.name}</dd>{items.map((i) => { const p = PRODUCTS.find((x) => x.id === i.productId); return <Fragment key={i.productId}><dt>{p?.name}</dt><dd>{i.quantity} × {money(p?.price || 0)} = {money((p?.price || 0) * i.quantity)}</dd></Fragment>; })}<dt>Total</dt><dd><strong data-testid="text-review-total">{money(total)}</strong></dd></dl><PatientLock /></>}
      </div>
      <div className="mrw-actions" style={{ marginTop: 20 }}>
        {step > 0 && <button type="button" className="admin-button admin-button--secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 2 ? <button type="button" className="admin-button" onClick={next} data-testid="button-order-next">Continue</button> : <><button type="button" className="admin-button admin-button--secondary" onClick={() => submit(false)} data-testid="button-save-draft">Save draft</button><button type="button" className="admin-button" onClick={() => submit(true)} data-testid="button-place-order">Place order</button></>}
        <Link href="/mr/orders" className="admin-button admin-button--secondary" data-testid="link-order-cancel">Cancel</Link>
      </div>
    </div>
  </>;
}
