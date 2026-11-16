import { useEffect, useRef, useState } from 'react';
import Dialog from '../admin/Dialog.jsx';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { CREDIT_AMOUNT, SAVED_INVOICE_REFERENCE, KIND_LABEL, confirmCredit, creditEligible, fetchHistory, fromPaise, inr, lookupCreditRequest, newIdempotencyKey, postCreditNote, toPaise } from '../../services/serverSettlements.js';

// Load current server authority before mounting the editor. Never refresh or
// replace the row underneath a reviewed/frozen submission.
export default function CreditNoteDialog({ row, onClose, onCommitted }) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoaded(null); setError('');
    fetchHistory(row.kind, row.id, controller.signal).then((current) => {
      guard();
      if (!controller.signal.aborted) setLoaded(current);
    }).catch((err) => {
      if (controller.signal.aborted) return;
      try { guard(); } catch { return; }
      setError(err.message || 'The current invoice number and balance could not be loaded.');
    });
    return () => controller.abort();
  }, [row.kind, row.id, retry]);
  if (loaded && loaded.kind === row.kind && loaded.id === row.id) {
    return <CreditNoteEditor row={loaded} onClose={onClose} onCommitted={onCommitted} />;
  }
  return <Dialog eyebrow="Credit note" title={`Order ${row.number}`} className="settle-dialog settle-credit-dialog" onClose={onClose}
    description="Load the saved invoice number and current balance before preparing a credit."
    footer={<>
      <button type="button" className="admin-button admin-button--secondary" onClick={onClose}>Cancel</button>
      {error && <button type="button" className="admin-button" onClick={() => setRetry((n) => n + 1)}>Retry loading</button>}
    </>}>
    {error ? <p className="settle-msg settle-msg--warn" role="alert">{error} No credit was submitted.</p>
      : <p role="status">Loading saved invoice number and balance…</p>}
  </Dialog>;
}

// Super Admin credit note against one settlement row. Draft survives rejection;
// an uncertain submission stays frozen and only the exact same body may be retried.
function CreditNoteEditor({ row, onClose, onCommitted }) {
  const authoritative = typeof row.invoiceReference === 'string' && SAVED_INVOICE_REFERENCE.test(row.invoiceReference) ? row.invoiceReference : null;
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
    if (locked || !eligible || !authoritative) return;
    const next = {};
    if (!CREDIT_AMOUNT.test(amount)) next.amount = 'Enter rupees with exactly two decimals, for example 1250.00.';
    else if (amountP <= 0n) next.amount = 'Amount must be more than zero.';
    else if (amountP > balanceP) next.amount = `Cannot exceed the balance of ${inr(row.balance)}.`;
    setErrors(next); setMessage('');
    if (Object.keys(next).length) return;
    frozen.current = Object.freeze({ idempotency_key: newIdempotencyKey(), kind: row.kind, id: row.id, expected_version: row.version,
      expected_paid: row.paid, expected_credited: row.credited, invoice_reference: authoritative, amount: fromPaise(amountP) });
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
    <button type="submit" form="credit-form" className="admin-button" disabled={!eligible || !authoritative} data-testid="button-review-credit">Review</button>
  </>;

  return <Dialog eyebrow="Credit note" title={`Order ${row.number}`} className="settle-dialog settle-credit-dialog" onClose={close} dismissDisabled={locked} footer={footer}
    description={`${KIND_LABEL[row.kind] || row.kind} · a credit reduces the balance without recording cash. No invoice document, PDF or notification is issued.`}>
    <form id="credit-form" noValidate onSubmit={review} className="settle-form">
      <dl className="settle-history-sum">
        <div><dt>Total</dt><dd>{row.total != null ? inr(row.total) : 'Unavailable'}</dd></div>
        <div><dt>Paid (cash)</dt><dd>{inr(row.paid)}</dd></div>
        <div><dt>Credited</dt><dd>{inr(row.credited)}</dd></div>
        <div><dt>Balance now</dt><dd className="settle-due" data-testid="text-credit-balance-before">{row.balance != null ? inr(row.balance) : 'Unavailable'}</dd></div>
        <div><dt>Proposed balance</dt><dd data-testid="text-credit-balance-after">{proposed != null && proposed >= 0n ? inr(proposed) : '—'}</dd></div>
      </dl>
      {!eligible && <p className="settle-msg settle-msg--warn" role="alert">This order is not eligible for credit: it needs a known total, a positive balance and a payable stage.</p>}
      <div className="kits-field">
        <dl><dt>Invoice number</dt><dd data-testid="text-credit-invoice">{authoritative || 'Unavailable'}</dd></dl>
        {authoritative ? <span className="settle-sub">Saved server-generated invoice number; it cannot be changed here.</span>
          : <p className="settle-msg settle-msg--warn" role="alert">The saved invoice number is unavailable or requires review. A new credit cannot be created. Ask an administrator to review the saved order authority, then close and reopen this dialog.</p>}
      </div>
      <label className="kits-field"><span>Credit amount (INR)</span>
        <input value={amount} inputMode="decimal" readOnly={locked} maxLength={15} onChange={(e) => { setAmount(e.target.value.trim()); setErrors((x) => ({ ...x, amount: undefined })); }}
          placeholder="0.00" className="settle-amount" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'credit-amt-err' : undefined} data-testid="input-credit-amount" />
        {errors.amount && <span id="credit-amt-err" className="settle-err">{errors.amount}</span>}
      </label>
      {confirming && <div className="settle-total settle-total--confirm" ref={reviewRef} tabIndex={-1} data-testid="text-credit-confirm">
        <span>Credit against Invoice number: {frozen.current?.invoice_reference}. Balance {inr(row.balance)} becomes {inr(proposed)}.</span><strong>{inr(amountP)}</strong>
      </div>}
      {message && <p className={`settle-msg${uncertain ? ' settle-msg--warn' : ''}`} role="alert" data-testid="status-credit">{message}</p>}
    </form>
  </Dialog>;
}
