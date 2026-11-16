import { useEffect, useRef, useState } from 'react';
import Dialog from '../admin/Dialog.jsx';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { CREDIT_AMOUNT, INVOICE_REFERENCE, KIND_LABEL, confirmCredit, creditEligible, fromPaise, inr, lookupCreditRequest, newIdempotencyKey, postCreditNote, toPaise } from '../../services/serverSettlements.js';

// Super Admin credit note against one settlement row. Draft survives rejection;
// an uncertain submission stays frozen and only the exact same body may be retried.
export default function CreditNoteDialog({ row, onClose, onCommitted }) {
  const authoritative = row.invoiceReference || null;
  const [invoice, setInvoice] = useState(authoritative || '');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState('edit'); // edit | posting | uncertain | checking
  const [message, setMessage] = useState('');
  const frozen = useRef(null);
  const uncertainEver = useRef(false);
  const busy = useRef(false);
  const reviewRef = useRef(null);
  const locked = phase !== 'edit' || confirming;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const eligible = creditEligible(row);

  useEffect(() => setNavigationGuard(() => {
    if (!lockedRef.current) return false;
    setMessage((m) => m || 'This credit note is not confirmed yet. Stay here until its outcome is confirmed.');
    return true;
  }), []);
  useEffect(() => {
    const warn = (e) => { if (frozen.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const balanceP = toPaise(row.balance) ?? 0n;
  const amountP = CREDIT_AMOUNT.test(amount) ? toPaise(amount) : null;
  const proposed = amountP != null ? balanceP - amountP : null;

  function review(e) {
    e.preventDefault();
    if (locked || !eligible) return;
    const next = {};
    const ref = authoritative || invoice.trim();
    if (!INVOICE_REFERENCE.test(ref)) next.invoice = 'Use the invoice format, for example 024-25/00051002.';
    if (!CREDIT_AMOUNT.test(amount)) next.amount = 'Enter rupees with exactly two decimals, for example 1250.00.';
    else if (amountP <= 0n) next.amount = 'Amount must be more than zero.';
    else if (amountP > balanceP) next.amount = `Cannot exceed the balance of ${inr(row.balance)}.`;
    setErrors(next); setMessage('');
    if (Object.keys(next).length) return;
    frozen.current = Object.freeze({ idempotency_key: newIdempotencyKey(), kind: row.kind, id: row.id, expected_version: row.version,
      expected_paid: row.paid, expected_credited: row.credited, invoice_reference: ref, amount: fromPaise(amountP) });
    setConfirming(true);
    requestAnimationFrame(() => reviewRef.current?.focus());
  }

  function rejected(text) {
    frozen.current = null; uncertainEver.current = false;
    setConfirming(false); setPhase('edit');
    setMessage(`${text} Nothing was credited. Your draft is kept; close and reopen the order to load its current balance if it changed.`);
  }

  async function send() {
    if (busy.current || !frozen.current) return;
    busy.current = true; setPhase('posting'); setMessage('');
    const guard = reportingIdentityGuard();
    try {
      const note = confirmCredit(await postCreditNote(frozen.current), frozen.current);
      guard();
      busy.current = false; frozen.current = null; onCommitted(note);
    } catch (err) {
      busy.current = false;
      // Only the server's durably retained rejection permits a new key.
      // Status codes alone cannot cancel an earlier request still in flight.
      if (err.terminal) return rejected(err.message || 'The credit note was rejected.');
      uncertainEver.current = true; setPhase('uncertain');
      setMessage('The outcome is not confirmed. The credit may or may not have been recorded. Check its status or retry the exact same submission; it will never be applied twice.');
    }
  }

  async function check() {
    if (busy.current || !frozen.current) return;
    busy.current = true; setPhase('checking');
    const guard = reportingIdentityGuard();
    try {
      const res = await lookupCreditRequest(frozen.current.idempotency_key);
      guard();
      busy.current = false;
      if (res.status === 'committed') { const note = confirmCredit(res.note, frozen.current); frozen.current = null; onCommitted(note); return; }
      if (res.status === 'rejected') return rejected(res.rejection.message);
      setPhase('uncertain');
      setMessage('No committed credit was found for this submission yet. That does not cancel it. Retry the same submission to finish it; a new credit is not allowed until this one is settled.');
    } catch (err) {
      busy.current = false; setPhase('uncertain');
      setMessage(`${err.message || 'Status could not be checked.'} The submission is kept unchanged. Sign in again if asked, then check or retry.`);
    }
  }

  const close = () => { if (!lockedRef.current) onClose(); };
  const uncertain = phase === 'uncertain' || phase === 'checking';
  const footer = uncertain ? <>
    <button type="button" className="admin-button admin-button--secondary" disabled={phase === 'checking'} onClick={check} data-testid="button-check-credit">{phase === 'checking' ? 'Checking…' : 'Check status'}</button>
    <button type="button" className="admin-button" disabled={phase === 'checking'} onClick={send} data-testid="button-retry-credit">Retry same submission</button>
  </> : confirming ? <>
    <button type="button" className="admin-button admin-button--secondary" disabled={phase === 'posting'} onClick={() => { frozen.current = null; setConfirming(false); }} data-testid="button-back-credit">Back to edit</button>
    <button type="button" className="admin-button" disabled={phase === 'posting'} onClick={send} data-testid="button-confirm-credit">{phase === 'posting' ? 'Recording…' : `Credit ${inr(amountP)}`}</button>
  </> : <>
    <button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-credit">Cancel</button>
    <button type="submit" form="credit-form" className="admin-button" disabled={!eligible} data-testid="button-review-credit">Review</button>
  </>;

  return <Dialog eyebrow="Credit note" title={`Order ${row.number}`} className="settle-dialog settle-credit-dialog" onClose={close} dismissDisabled={locked} footer={footer}
    description={`${KIND_LABEL[row.kind] || row.kind} · a credit reduces the balance without recording cash. No invoice, PDF or notification is issued.`}>
    <form id="credit-form" noValidate onSubmit={review} className="settle-form">
      <dl className="settle-history-sum">
        <div><dt>Total</dt><dd>{row.total != null ? inr(row.total) : 'Unavailable'}</dd></div>
        <div><dt>Paid (cash)</dt><dd>{inr(row.paid)}</dd></div>
        <div><dt>Credited</dt><dd>{inr(row.credited)}</dd></div>
        <div><dt>Balance now</dt><dd className="settle-due" data-testid="text-credit-balance-before">{row.balance != null ? inr(row.balance) : 'Unavailable'}</dd></div>
        <div><dt>Proposed balance</dt><dd data-testid="text-credit-balance-after">{proposed != null && proposed >= 0n ? inr(proposed) : '—'}</dd></div>
      </dl>
      {!eligible && <p className="settle-msg settle-msg--warn" role="alert">This order is not eligible for credit: it needs a known total, a positive balance and a payable stage.</p>}
      <label className="kits-field"><span>Invoice reference</span>
        <input value={invoice} readOnly={Boolean(authoritative) || locked} maxLength={30} onChange={(e) => { setInvoice(e.target.value); setErrors((x) => ({ ...x, invoice: undefined })); }}
          placeholder="024-25/00051002" aria-invalid={Boolean(errors.invoice)} aria-describedby={errors.invoice ? 'credit-inv-err' : undefined} data-testid="input-credit-invoice" />
        {authoritative && <span className="settle-sub">Recorded invoice reference; it cannot be changed here.</span>}
        {errors.invoice && <span id="credit-inv-err" className="settle-err">{errors.invoice}</span>}
      </label>
      <label className="kits-field"><span>Credit amount (INR)</span>
        <input value={amount} inputMode="decimal" readOnly={locked} maxLength={15} onChange={(e) => { setAmount(e.target.value.trim()); setErrors((x) => ({ ...x, amount: undefined })); }}
          placeholder="0.00" className="settle-amount" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'credit-amt-err' : undefined} data-testid="input-credit-amount" />
        {errors.amount && <span id="credit-amt-err" className="settle-err">{errors.amount}</span>}
      </label>
      {confirming && <div className="settle-total settle-total--confirm" ref={reviewRef} tabIndex={-1} data-testid="text-credit-confirm">
        <span>Credit against invoice {frozen.current?.invoice_reference}. Balance {inr(row.balance)} becomes {inr(proposed)}.</span><strong>{inr(amountP)}</strong>
      </div>}
      {message && <p className={`settle-msg${uncertain ? ' settle-msg--warn' : ''}`} role="alert" data-testid="status-credit">{message}</p>}
    </form>
  </Dialog>;
}
