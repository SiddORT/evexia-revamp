import { useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { Plus, Search, Printer, Trash2 } from 'lucide-react';
import Dialog from '../components/admin/Dialog.jsx';
import { usePlatformConfirm } from '../components/PlatformConfirmation.jsx';
import SearchableSelect from '../components/admin/SearchableSelect.jsx';
import * as store from './doctorStore.js';
import { pname, patientOptions } from './Care.jsx';
import { A, Badge, Empty, Field, Head, Notice, Row, Steps, RecordList, PrintPageStyle, describe, msg, uid, useDemo, useDirty, useFmt, useGuard } from './ui.jsx';

const { money, orderBalance, paymentStatus, products } = store;

export function Orders() {
  const S = useDemo();
  const fd = useFmt();
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const rows = S.orders.filter((o) => (!st || o.status === st) && `${o.id} ${pname(S, o.patientId)}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Head eyebrow="Commerce" title="Orders" description="Fictional allergy-care product orders. Order status is not evidence of administered doses." actions={<A to="/doctor/orders/new" className="admin-button"><Plus size={15} /> Place order</A>} />
      <div className="admin-panel">
        <div className="admin-toolbar"><div className="admin-toolbar__fields">
          <div className="admin-search"><Search size={15} aria-hidden="true" /><input aria-label="Search orders" placeholder="Search order or patient" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="os">Status</label><select id="os" className="admin-select" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option>{['Draft', 'Placed', 'Shipped', 'Delivered'].map((s) => <option key={s}>{s}</option>)}</select></div>
        </div></div>
        {!rows.length ? <Empty title="No orders match" action={<A to="/doctor/orders/new" className="admin-button">Place order</A>}>Adjust filters or place a demo order.</Empty> :
          <RecordList rows={rows} label="orders" render={(o) => <Row key={o.id} to={`/doctor/orders/${o.id}`} title={`Order ${o.id} · ${pname(S, o.patientId)}`} sub={`${fd(o.date)} · ${money(o.totalMinor)} · Payment: ${paymentStatus(o, S)}`} badge={<Badge status={o.status} />} />} />}
      </div>
    </>
  );
}

export function OrderForm({ go }) {
  const S = useDemo();
  const guard = useGuard();
  const pre = new URLSearchParams(useSearch()).get('patient') || '';
  const [step, setStep] = useState(0);
  const [patientId, setPatientId] = useState(S.patients.some((p) => p.id === pre) ? pre : '');
  const [items, setItems] = useState([{ productId: '', quantity: '1' }]);
  const [errors, setErrors] = useState({});
  const [fail, setFail] = useState('');
  const [saved, setSaved] = useState(false);
  const reqId = useRef(uid());
  const lines = items.map((i) => ({ ...i, product: products.find((p) => p.id === i.productId), qty: Number(i.quantity) }));
  const total = lines.reduce((s, l) => s + (l.product ? l.product.priceMinor * l.qty : 0), 0);
  useDirty((patientId || items.length > 1 || items.some((i) => i.productId || i.quantity !== '1')) && !saved);
  const setItem = (n, patch) => setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  function next() {
    const n = {};
    if (!patientId) n.patientId = 'Choose a patient.';
    lines.forEach((l, i) => {
      if (!l.product) n[`p${i}`] = 'Choose a product.';
      else if (lines.findIndex((x) => x.productId === l.productId) !== i) n[`p${i}`] = 'Product already added. Change its quantity instead.';
      if (!/^[1-9]\d{0,2}$/.test(l.quantity.trim())) n[`q${i}`] = 'Enter a positive whole number up to 999.';
    });
    setErrors(n);
    if (!Object.keys(n).length) setStep(1);
  }
  function save(status) {
    if (saved) return;
    try {
      setSaved(true);
      const o = store.addOrder({ patientId, items: lines.map((l) => ({ productId: l.productId, quantity: l.qty })), status, requestId: reqId.current });
      guard.dirtyRef.current = false;
      go(`/doctor/orders/${o.id}`);
    } catch (err) { setSaved(false); setFail(msg(err)); }
  }
  return (
    <>
      <Head eyebrow="Orders / New" title="Place order" description="Choose your own fictional patient and sample products. Drafts are not submitted." />
      <Steps steps={['Patient and items', 'Review and confirm']} current={step} />
      <div className="admin-panel dr-formpanel dr-form">
        {fail && <Notice tone="error">{fail}</Notice>}
        {step === 0 ? <>
          <Field id="of-patient" label="Patient" error={errors.patientId}><SearchableSelect id="of-patient" label="Patient" value={patientId} options={patientOptions(S)} onChange={setPatientId} placeholder="Choose a patient" invalid={Boolean(errors.patientId)} describedBy={describe('of-patient', errors.patientId)} viewportMenu /></Field>
          {items.map((it, i) => (
            <div className="dr-line" key={i}>
              <Field id={`of-p${i}`} label={`Product ${i + 1}`} error={errors[`p${i}`]}><SearchableSelect id={`of-p${i}`} label={`Product ${i + 1}`} value={it.productId} options={products.map((p) => ({ value: p.id, label: `${p.name} - ${money(p.priceMinor)}` }))} onChange={(x) => setItem(i, { productId: x })} placeholder="Choose a product" invalid={Boolean(errors[`p${i}`])} describedBy={describe(`of-p${i}`, errors[`p${i}`])} viewportMenu /></Field>
              <Field id={`of-q${i}`} label="Quantity" error={errors[`q${i}`]}><input id={`of-q${i}`} inputMode="numeric" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} aria-invalid={Boolean(errors[`q${i}`])} aria-describedby={describe(`of-q${i}`, errors[`q${i}`])} /></Field>
              {items.length > 1 && <button type="button" className="admin-icon-button" aria-label={`Remove product ${i + 1}`} onClick={() => setItems(items.filter((_, n) => n !== i))}><Trash2 size={16} /></button>}
            </div>
          ))}
          <button type="button" className="admin-button admin-button--secondary dr-self" disabled={items.length >= products.length} onClick={() => setItems([...items, { productId: '', quantity: '1' }])}><Plus size={15} /> Add another product</button>
          <p className="dr-fine">Prices shown are per unit as listed in each product name or sample catalogue.</p></> : <>
          <dl className="dr-review"><div><dt>Patient</dt><dd>{pname(S, patientId)}</dd></div>
            {lines.map((l, i) => <div key={i}><dt>{l.product?.name}</dt><dd>{l.qty} x {money(l.product?.priceMinor || 0)} = {money((l.product?.priceMinor || 0) * l.qty)}</dd></div>)}
            <div><dt>Total</dt><dd><strong>{money(total)}</strong></dd></div></dl>
          <p className="dr-fine">Demo only. A placed order is a sample record: nothing is shipped or billed.</p></>}
        <div className="dr-actions">
          {step === 0 ? <A to="/doctor/orders" className="admin-button admin-button--secondary">Cancel</A> : <button type="button" className="admin-button admin-button--secondary" onClick={() => setStep(0)}>Back</button>}
          {step === 0 ? <button type="button" className="admin-button" onClick={next}>Review order</button> : <>
            <button type="button" className="admin-button admin-button--secondary" disabled={saved} onClick={() => save('Draft')}>Save draft</button>
            <button type="button" className="admin-button" disabled={saved} onClick={() => save('Placed')}>Place demo order</button></>}
        </div>
      </div>
    </>
  );
}

export function OrderDetail({ id }) {
  const S = useDemo();
  const fd = useFmt();
  const o = S.orders.find((x) => x.id === id);
  const [fail, setFail] = useState('');
  useDirty(false);
  if (!o) return <Empty title="Order not found" action={<A to="/doctor/orders" className="admin-button admin-button--secondary">Back to orders</A>}>This order does not exist in the current demo workspace.</Empty>;
  const pay = paymentStatus(o, S);
  return (
    <>
      <Head eyebrow="Orders / Detail" title={`Order ${o.id}`} description={`${pname(S, o.patientId)} · ${fd(o.date)}`} actions={<><Badge status={o.status} />{o.status === 'Draft' && <button type="button" className="admin-button" onClick={() => { try { store.placeDraft(o.id); setFail(''); } catch (e) { setFail(msg(e)); } }}>Place draft as demo order</button>}</>} />
      {fail && <Notice tone="error">{fail}</Notice>}
      <div className="dr-grid2">
        <section className="admin-panel dr-section"><h2>Items</h2>
          <dl className="dr-review">{(o.items || []).map((i, n) => <div key={n}><dt>{i.name}</dt><dd>{i.quantity} x {money(i.priceMinor)} = {money(i.priceMinor * i.quantity)}</dd></div>)}
            <div><dt>Total</dt><dd><strong>{money(o.totalMinor)}</strong></dd></div>
            <div><dt>Payment (separate from fulfilment)</dt><dd><Badge status={pay} /> {o.status !== 'Draft' && <>Balance {money(orderBalance(o, S))}</>}</dd></div></dl>
          {o.status !== 'Draft' && <A to="/doctor/payments" className="admin-button admin-button--secondary">Go to payments</A>}
          <p className="dr-fine">Order and shipping status never indicates that any dose was administered.</p></section>
        <section className="admin-panel dr-section"><h2>Status timeline</h2>
          <ol className="dr-timeline">{(o.timeline || []).map((t, n) => <li key={n}><time>{fd(t.date)}</time><strong>{t.title}</strong></li>)}</ol></section>
      </div>
    </>
  );
}

export function Payments() {
  const S = useDemo();
  const fd = useFmt();
  const guard = useGuard();
  const [target, setTarget] = useState(null);
  const [ack, setAck] = useState(null);
  const orders = S.orders.filter((o) => o.status !== 'Draft');
  const pays = [...S.payments].sort((a, b) => b.date.localeCompare(a.date));
  useDirty(false);
  void guard;
  return (
    <>
      <Head eyebrow="Commerce" title="Payments" description="Demo ledger. No card, bank or UPI details are collected and no money moves." />
      {ack && <article className="dr-sheet dr-sheet--doc dr-printable" data-testid="payment-ack">
        <PrintPageStyle />
        <p className="dr-sheet__demo">DEMO PAYMENT ACKNOWLEDGEMENT. No real payment was made.</p>
        <p>Order {ack.orderId}: {money(ack.amountMinor)} recorded on {fd(ack.date)} in this demo ledger only.</p>
        <div className="dr-noprint dr-actions"><button type="button" className="admin-button" onClick={() => window.print()}><Printer size={15} /> Print acknowledgement</button><button type="button" className="admin-button admin-button--secondary" onClick={() => setAck(null)}>Dismiss</button></div></article>}
      <section className="admin-panel dr-section dr-noprint"><h2>Order balances</h2>
        {!orders.length ? <Empty title="No placed orders">Place an order to see balances.</Empty> :
          <div className="dr-rows">{orders.map((o) => { const bal = orderBalance(o, S); return (
            <div className="dr-row dr-row--static" key={o.id}>
              <span className="dr-row__main"><strong><A to={`/doctor/orders/${o.id}`}>Order {o.id}</A> · {pname(S, o.patientId)}</strong><small>Total {money(o.totalMinor)} · Balance {money(bal)} · Fulfilment: {o.status}</small></span>
              <span className="dr-row__side"><Badge status={paymentStatus(o, S)} /><button type="button" className="admin-button admin-button--secondary" disabled={bal <= 0} onClick={() => setTarget(o)}>Pay demo</button></span>
            </div>); })}</div>}</section>
      <section className="admin-panel dr-section dr-noprint"><h2>Transaction history</h2>
        {!pays.length ? <Empty title="No transactions yet">Demo payments appear here.</Empty> :
          <div className="dr-rows">{pays.map((p) => <Row key={p.id} to={`/doctor/orders/${p.orderId}`} title={`${money(p.amountMinor)} toward order ${p.orderId}`} sub="Demo transaction" meta={fd(p.date)} />)}</div>}</section>
      {target && <PayDialog order={target} onClose={() => setTarget(null)} onDone={(p) => { setTarget(null); setAck(p); }} />}
    </>
  );
}

function PayDialog({ order, onClose, onDone }) {
  const confirmDraft = usePlatformConfirm();
  const S = useDemo();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const req = useRef(uid());
  useDirty(Boolean(amount), true);
  const bal = orderBalance(order, S);
  let minor = 0;
  function check() {
    try { minor = store.parseMoney(amount.trim()); } catch (e) { setError(msg(e)); return false; }
    if (!(minor > 0)) { setError('Enter an amount greater than zero.'); return false; }
    if (minor > bal) { setError(`Amount cannot exceed the balance of ${money(bal)}.`); return false; }
    setError(''); return true;
  }
  function confirm() {
    if (busy.current) return;
    busy.current = true;
    try { onDone(store.addPayment({ orderId: order.id, amount: amount.trim(), date: store.today(), requestId: req.current })); }
    catch (e) { busy.current = false; setError(msg(e)); }
  }
  return (
    <Dialog eyebrow="Demo payment" title={`Pay order ${order.id}`} description={`Balance ${money(bal)}. DEMO: no payment credentials are collected.`} onClose={async () => {
      if (!busy.current && (!amount || await confirmDraft('Discard this unsaved demo payment draft?'))) onClose();
    }}
      footer={step === 0 ? <><button type="button" className="admin-button admin-button--secondary" onClick={async () => {
        if (!busy.current && (!amount || await confirmDraft('Discard this unsaved demo payment draft?'))) onClose();
      }}>Cancel</button><button type="button" className="admin-button" onClick={() => { if (check()) setStep(1); }}>Review</button></> :
        <><button type="button" className="admin-button admin-button--secondary" onClick={() => setStep(0)}>Back</button><button type="button" className="admin-button" onClick={confirm}>Confirm demo payment</button></>}>
      {step === 0 ? <div className="dr-form">
        <Field id="pay-amt" label="Amount in INR (two decimals, e.g. 250.00)" error={error}><input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describe('pay-amt', error)} /></Field>
        <button type="button" className="admin-button admin-button--secondary dr-self" onClick={() => setAmount((bal / 100).toFixed(2))}>Fill full balance</button></div> :
        <>{error && <Notice tone="error">{error}</Notice>}<p>You are recording <strong>{money(store.parseMoney(amount.trim()))}</strong> against order {order.id}. This is a DEMO entry only.</p></>}
    </Dialog>
  );
}

export function MyMR() {
  const fd = useFmt();
  const mr = store.mappedMR;
  useDirty(false);
  return (
    <>
      <Head eyebrow="Account" title="My MR" description="Fictional medical representative currently mapped to you. View only: no messaging, calling or reassignment." />
      <div className="dr-grid2">
        <section className="admin-panel dr-section"><h2>{mr.name}</h2><span className="admin-badge">Current mapping</span>
          <dl className="dr-review"><div><dt>Territory</dt><dd>{mr.territory}</dd></div><div><dt>Email</dt><dd>{mr.email}</dd></div><div><dt>Phone</dt><dd>{mr.phone}</dd></div></dl>
          <p className="dr-fine">Business contact summary for a fictional person. Nothing here can be contacted.</p></section>
        <section className="admin-panel dr-section"><h2>Mapping and activity</h2>
          <ol className="dr-timeline">{mr.history.map((h, i) => <li key={i} className={h.current ? 'is-current' : ''}><time>{fd(h.date)}</time><strong>{h.title}</strong> <span className={`admin-badge ${h.current ? '' : 'admin-badge--inactive'}`}>{h.current ? 'Current' : 'Past'}</span><span>{h.detail}</span></li>)}</ol></section>
      </div>
    </>
  );
}
