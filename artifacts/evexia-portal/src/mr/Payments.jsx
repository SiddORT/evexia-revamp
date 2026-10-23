import { useRef, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { DEMO_DATE, money, orderBalance, orderPaymentStatus, parseMoney, recordPayment } from '../services/mrWorkspaceDemo.js';
import { Empty, Field, Head, statusPill, useDate, useDirtyGuard, useWs } from './common.jsx';

const KINDS = { advance: 'Advance', partial: 'Partial payment', full: 'Full payment' };
export function PaymentList() {
  const { state } = useWs();
  const date = useDate();
  const dn = (id) => state.doctors.find((d) => d.id === id)?.name || 'Unknown doctor';
  const adv = state.payments.filter((p) => p.kind === 'advance').reduce((s, p) => s + p.amount, 0);
  return <>
    <Head eyebrow="Payments" title="Payments" text="Demo receipts only. No bank or card details are collected."><Link href="/mr/payments/new" className="admin-button" data-testid="link-add-payment">Add payment</Link></Head>
    <div className="mrw-grid"><div className="mrw-card mrw-stat"><span>Total recorded</span><strong>{money(state.payments.reduce((s, p) => s + p.amount, 0))}</strong></div><div className="mrw-card mrw-stat"><span>Unapplied advance credit</span><strong>{money(adv)}</strong></div></div>
    <div className="mrw-card"><h2>History</h2>{state.payments.length === 0 ? <Empty title="No payments yet" text="Record an advance or an order payment." to="/mr/payments/new" action="Add payment" /> :
      <div className="mrw-scroll" tabIndex={0} role="region" aria-label="Payment history"><table className="mrw-table"><thead><tr><th>Receipt</th><th>Doctor</th><th>Type</th><th>Order</th><th>Date</th><th>Method</th><th className="num">Amount</th></tr></thead><tbody>
        {state.payments.map((p) => <tr key={p.id} data-testid={`row-payment-${p.id}`}><td><Link href={`/mr/payments/${encodeURIComponent(p.id)}`}>{p.id}</Link></td><td>{dn(p.doctorId)}</td><td>{KINDS[p.kind]}</td><td>{p.orderId || 'Unapplied credit'}</td><td>{date(p.date)}</td><td>{p.method}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table></div>}</div>
  </>;
}

export function PaymentDetail({ id }) {
  const { state } = useWs();
  const date = useDate();
  const p = state.payments.find((x) => x.id === id);
  if (!p) return <div className="mrw-card"><Empty title="Payment not found" text="This demo payment is not in your workspace." to="/mr/payments" action="Back to payments" /></div>;
  return <><Head eyebrow="Payments" title={`Demo receipt ${p.id}`} text="In-app demo acknowledgement. Not a real invoice or receipt." />
    <div className="mrw-card"><dl className="mrw-dl"><dt>Doctor</dt><dd>{state.doctors.find((d) => d.id === p.doctorId)?.name}</dd><dt>Type</dt><dd>{KINDS[p.kind]}</dd><dt>Applied to</dt><dd>{p.orderId ? `${p.orderId} (fictional demo order)` : 'Unapplied advance credit'}</dd><dt>Amount</dt><dd><strong>{money(p.amount)}</strong></dd><dt>Date</dt><dd>{date(p.date)}</dd><dt>Method</dt><dd>{p.method}</dd><dt>Reference</dt><dd>{p.reference || '—'}</dd><dt>Remark</dt><dd>{p.remark || '—'}</dd></dl></div></>;
}

const rupees = (paise) => (paise / 100).toFixed(2);
export function PaymentForm() {
  const { state, apply, setFlash } = useWs();
  const date = useDate();
  const q = new URLSearchParams(useSearch());
  const qOrder = state.orders.find((o) => o.id === q.get('order') && o.status === 'placed');
  const [kind, setKind] = useState(KINDS[q.get('kind')] ? q.get('kind') : qOrder ? 'partial' : 'advance');
  const [doctorId, setDoctorId] = useState(qOrder?.doctorId || (state.doctors.some((d) => d.id === q.get('doctor')) ? q.get('doctor') : ''));
  const [orderId, setOrderId] = useState(qOrder?.id || '');
  const [amount, setAmount] = useState('');
  const [pdate, setPdate] = useState(DEMO_DATE);
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [remark, setRemark] = useState('');
  const [review, setReview] = useState(false);
  const [errors, setErrors] = useState({});
  const [ack, setAck] = useState(null);
  const busy = useRef(false);
  const dirty = !ack && Boolean(doctorId || amount || reference || remark);
  useDirtyGuard(dirty);
  const eligible = state.orders.filter((o) => o.doctorId === doctorId && o.status === 'placed' && orderBalance(state, o) > 0);
  const order = eligible.find((o) => o.id === orderId);
  const balance = order ? orderBalance(state, order) : 0;
  const needsOrder = kind !== 'advance';
  const shown = kind === 'full' && order ? rupees(balance) : amount;
  function validate() {
    const e = {};
    if (!doctorId) e.doctor = 'Select a doctor.';
    if (needsOrder && !order) e.order = 'Select an order with a balance due.';
    let paise = null;
    try { paise = parseMoney(shown); } catch { e.amount = 'Enter a valid amount with at most two decimals.'; }
    if (paise !== null && !e.amount) {
      if (paise <= 0) e.amount = 'Amount must be greater than zero.';
      else if (kind === 'partial' && order && paise >= balance) e.amount = `Partial payment must be below the balance of ${money(balance)}.`;
      else if (kind === 'full' && order && paise !== balance) e.amount = 'Full payment must equal the balance.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pdate) || pdate > DEMO_DATE) e.date = 'Choose a valid date on or before the demo date.';
    else if (order && pdate < order.date) e.date = 'Date cannot be before the order date.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function confirm() {
    if (busy.current) return;
    busy.current = true;
    const before = new Set(state.payments.map((p) => p.id));
    const r = apply((s) => recordPayment(s, { doctorId, orderId: needsOrder ? orderId : null, kind, amount: shown, date: pdate, method, reference: reference.trim(), remark: remark.trim() }));
    if (!r.ok) { busy.current = false; setErrors({ form: r.message }); setReview(false); return; }
    const pay = r.state.payments.find((p) => !before.has(p.id));
    setAck(pay);
    setFlash('Demo payment recorded.', null);
  }
  if (ack) return <><Head eyebrow="Payments" title="Payment recorded" /><div className="mrw-card" role="status" data-testid="payment-ack"><p><strong>Demo acknowledgement {ack.id}</strong>: {money(ack.amount)} {KINDS[ack.kind].toLowerCase()} recorded. No real money moved.</p><div className="mrw-actions"><Link href={`/mr/payments/${encodeURIComponent(ack.id)}`} className="admin-button">View receipt</Link><Link href="/mr/payments" className="admin-button admin-button--secondary">Payment history</Link></div></div></>;
  const err = (k) => errors[k] ? { 'aria-invalid': true, 'aria-describedby': `pay-${k}-error` } : {};
  return <>
    <Head eyebrow="Payments" title="Add payment" text="Fictional demo ledger. Do not enter real bank, card or account details." />
    <div className="mrw-card">
      {errors.form && <div className="mrw-alert" role="alert">{errors.form}</div>}
      {!review ? <div className="mrw-form">
        <div className="mrw-wide"><div className="mrw-choice" role="group" aria-label="Payment type">{Object.entries(KINDS).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setOrderId(''); setAmount(''); setErrors({}); }} data-testid={`button-kind-${k}`}>{l}</button>)}</div>
          {kind === 'advance' && <p className="mrw-notice">Advances stay as separate unapplied credit and are never settled against an order automatically.</p>}</div>
        <Field id="pay-doctor" label="Doctor" error={errors.doctor}><select className="admin-select" id="pay-doctor" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setOrderId(''); }} {...err('doctor')} data-testid="select-payment-doctor"><option value="">Select a doctor</option>{state.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        {needsOrder && <Field id="pay-order" label="Placed order" error={errors.order} hint={doctorId && eligible.length === 0 ? 'No placed orders with a balance for this doctor.' : undefined}><select className="admin-select" id="pay-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} {...err('order')} data-testid="select-payment-order"><option value="">Select an order</option>{eligible.map((o) => <option key={o.id} value={o.id}>{o.id} · balance {money(orderBalance(state, o))} · {orderPaymentStatus(state, o)}</option>)}</select></Field>}
        {order && <div className="mrw-wide" data-testid="text-payable-balance">Payable balance: <strong>{money(balance)}</strong></div>}
        <Field id="pay-amount" label="Amount (rupees)" error={errors.amount} hint={kind === 'full' ? 'Filled with the exact remaining balance.' : 'Up to two decimals'}><input className="mrw-input" id="pay-amount" inputMode="decimal" value={shown} readOnly={kind === 'full'} onChange={(e) => setAmount(e.target.value)} {...err('amount')} data-testid="input-payment-amount" /></Field>
        <Field id="pay-date" label="Payment date" error={errors.date}><input className="mrw-input" type="date" id="pay-date" max={DEMO_DATE} value={pdate} onChange={(e) => setPdate(e.target.value)} {...err('date')} data-testid="input-payment-date" /></Field>
        <Field id="pay-method" label="Method"><select className="admin-select" id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="select-payment-method">{['Cash', 'UPI', 'Bank transfer', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field id="pay-ref" label="Reference (optional)"><input className="mrw-input" id="pay-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <div className="mrw-wide"><Field id="pay-remark" label="Remark (optional)"><textarea className="mrw-input" id="pay-remark" maxLength={200} value={remark} onChange={(e) => setRemark(e.target.value)} /></Field></div>
      </div> : <dl className="mrw-dl" data-testid="payment-review"><dt>Doctor</dt><dd>{state.doctors.find((d) => d.id === doctorId)?.name}</dd><dt>Type</dt><dd>{KINDS[kind]}</dd><dt>Order</dt><dd>{needsOrder ? orderId : 'Unapplied advance credit'}</dd>{order && <><dt>Balance before</dt><dd>{money(balance)}</dd></>}<dt>Amount</dt><dd><strong>{money(parseMoney(shown))}</strong></dd><dt>Date</dt><dd>{date(pdate)}</dd><dt>Method</dt><dd>{method}</dd><dt>Reference</dt><dd>{reference || '—'}</dd><dt>Remark</dt><dd>{remark || '—'}</dd></dl>}
      <div className="mrw-actions" style={{ marginTop: 20 }}>
        {!review ? <button type="button" className="admin-button" onClick={() => validate() && setReview(true)} data-testid="button-payment-review">Review payment</button> : <><button type="button" className="admin-button admin-button--secondary" onClick={() => setReview(false)}>Back</button><button type="button" className="admin-button" onClick={confirm} data-testid="button-payment-confirm">Confirm payment</button></>}
        <Link href="/mr/payments" className="admin-button admin-button--secondary" data-testid="link-payment-cancel">Cancel</Link>
      </div>
    </div>
  </>;
}
