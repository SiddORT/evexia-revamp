import { useEffect, useRef, useState } from 'react';
import Dialog from '../admin/Dialog.jsx';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { KIND_LABEL, MODES, fromPaise, inr, lookupRequest, postTransaction, toPaise, confirmBatch } from '../../services/serverSettlements.js';
import { todayISO as today } from '../../services/serverShipments.js';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16);
}));
// Definite rejections: the server answered and did not commit.
const definite = (e) => [400, 403, 404, 409, 422].includes(e?.status);

export default function TransactionDialog({ rows, onClose, onCommitted }) {
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState('');
  const [amounts, setAmounts] = useState(() => Object.fromEntries(rows.map((r) => [r.key, ''])));
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState('edit'); // edit | posting | uncertain | checking
  const [message, setMessage] = useState('');
  const frozen = useRef(null);
  const uncertainEver = useRef(false);
  const busy = useRef(false);
  const locked = phase !== 'edit';
  const lockedRef = useRef(locked);
  lockedRef.current = locked || confirming;

  useEffect(() => setNavigationGuard(() => {
    if (!lockedRef.current) return false;
    setMessage((m) => m || 'This payment has not been confirmed yet. Stay here until its outcome is confirmed.');
    return true;
  }), []);
  useEffect(() => {
    const warn = (e) => { if (frozen.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const parsed = rows.map((r) => ({ row: r, p: toPaise(amounts[r.key] || '') }));
  const totalPaise = parsed.reduce((s, x) => s + (x.p ?? 0n), 0n);

  function validate() {
    const next = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = 'Enter the transaction date.';
    else if (date > today()) next.date = 'The transaction date cannot be in the future.';
    if (!MODES.includes(mode)) next.mode = 'Choose a payment mode.';
    for (const { row, p } of parsed) {
      const raw = (amounts[row.key] || '').trim();
      if (!raw) next[row.key] = 'Enter an amount.';
      else if (p == null) next[row.key] = 'Use digits with up to 2 decimals, for example 1250.50.';
      else if (p <= 0n) next[row.key] = 'Amount must be more than zero.';
      else if (p > toPaise(row.balance)) next[row.key] = `Cannot exceed the balance of ${inr(row.balance)}.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function review(e) {
    e.preventDefault();
    if (locked) return;
    setMessage('');
    if (validate()) setConfirming(true);
  }

  async function send() {
    if (busy.current || !frozen.current) return;
    busy.current = true;
    setPhase('posting'); setMessage('');
    const guard = reportingIdentityGuard();
    try {
      const batch = confirmBatch(await postTransaction(frozen.current), frozen.current);
      guard();
      busy.current = false;
      frozen.current = null;
      onCommitted(batch);
    } catch (err) {
      busy.current = false;
      if (err.terminal || (!uncertainEver.current && definite(err))) {
        frozen.current = null;
        uncertainEver.current = false;
        setConfirming(false); setPhase('edit');
        setMessage(`${err.message || 'The payment was rejected.'} Nothing was recorded. Refresh the list if balances changed, then review your entries.`);
        return;
      }
      uncertainEver.current = true;
      setPhase('uncertain');
      setMessage('The outcome is not confirmed. The payment may or may not have been recorded. Check its status or retry the exact same submission; it will never be recorded twice.');
    }
  }

  async function check() {
    if (busy.current || !frozen.current) return;
    busy.current = true; setPhase('checking');
    try {
      const res = await lookupRequest(frozen.current.idempotency_key);
      busy.current = false;
      if (res?.status === 'committed' && res.batch) {
        const batch = confirmBatch(res.batch, frozen.current);
        frozen.current = null; onCommitted(batch); return;
      }
      if (res?.status === 'rejected' && res.rejection) {
        frozen.current = null; uncertainEver.current = false;
        setConfirming(false); setPhase('edit');
        setMessage(`${res.rejection.message} The server confirmed nothing was recorded for this submission. You can review your entries.`);
        return;
      }
      setPhase('uncertain');
      setMessage('No committed payment was found for this submission yet. Retry the same submission to finish it; a new submission is not allowed until this one is settled.');
    } catch (err) {
      busy.current = false; setPhase('uncertain');
      setMessage(`${err.message || 'Status could not be checked.'} The submission is kept unchanged. Sign in again if asked, then check or retry.`);
    }
  }

  function confirm() {
    if (busy.current) return;
    if (!frozen.current) {
      frozen.current = Object.freeze({
        idempotency_key: newKey(), date, mode,
        entries: rows.map((r) => ({ kind: r.kind, id: r.id, expected_version: r.version, expected_paid: r.paid, amount: fromPaise(toPaise(amounts[r.key])) })),
      });
    }
    send();
  }

  const close = () => { if (!lockedRef.current) onClose(); };
  const footer = phase === 'uncertain' || phase === 'checking'
    ? <>
      <button type="button" className="admin-button admin-button--secondary" disabled={phase === 'checking'} onClick={check} data-testid="button-check-transaction">{phase === 'checking' ? 'Checking…' : 'Check status'}</button>
      <button type="button" className="admin-button" disabled={phase === 'checking'} onClick={send} data-testid="button-retry-transaction">Retry same submission</button>
    </>
    : confirming
      ? <>
        <button type="button" className="admin-button admin-button--secondary" disabled={phase === 'posting'} onClick={() => setConfirming(false)} data-testid="button-back-transaction">Back to edit</button>
        <button type="button" className="admin-button" disabled={phase === 'posting'} aria-disabled={phase === 'posting'} onClick={confirm} data-testid="button-confirm-transaction">{phase === 'posting' ? 'Recording…' : `Record ${inr(totalPaise)}`}</button>
      </>
      : <>
        <button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-transaction">Cancel</button>
        <button type="submit" form="settle-form" className="admin-button" data-testid="button-review-transaction">Review payment</button>
      </>;

  return <Dialog eyebrow="Accounts" title="Add transaction" className="settle-dialog" onClose={close}
    description="Record one payment across the selected orders. Each order receives its own amount. Recorded payments are immutable and start as Not verified."
    footer={footer}>
    <form id="settle-form" noValidate onSubmit={review} className="settle-form">
      <fieldset disabled={locked || confirming} className="settle-form__common">
        <label className="kits-field">Transaction date
          <input type="date" value={date} max={today()} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'settle-date-err' : undefined}
            onChange={(e) => setDate(e.target.value)} data-testid="input-transaction-date" />
          {errors.date && <span id="settle-date-err" className="settle-err">{errors.date}</span>}
        </label>
        <label className="kits-field">Payment mode
          <select value={mode} aria-invalid={Boolean(errors.mode)} aria-describedby={errors.mode ? 'settle-mode-err' : undefined}
            onChange={(e) => setMode(e.target.value)} data-testid="select-transaction-mode">
            <option value="">Choose mode</option>{MODES.map((m) => <option key={m}>{m}</option>)}
          </select>
          {errors.mode && <span id="settle-mode-err" className="settle-err">{errors.mode}</span>}
        </label>
      </fieldset>
      <table className="settle-entries">
        <caption className="sr-only">Amount per selected order</caption>
        <thead><tr><th scope="col">Order</th><th scope="col">Balance</th><th scope="col">Amount (INR)</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}>
          <th scope="row"><strong className="settle-mono">{r.number}</strong><span className="settle-sub">{KIND_LABEL[r.kind] || r.kind}</span></th>
          <td className="settle-mono">{inr(r.balance)}</td>
          <td>
            <input inputMode="decimal" className="settle-amount" aria-label={`Amount for ${r.number}`} value={amounts[r.key]} disabled={locked || confirming}
              aria-invalid={Boolean(errors[r.key])} aria-describedby={errors[r.key] ? `settle-err-${r.key}` : undefined}
               maxLength={15} onChange={(e) => setAmounts((a) => ({ ...a, [r.key]: e.target.value }))}
              placeholder="0.00" data-testid={`input-amount-${r.key}`} />
            {errors[r.key] && <span id={`settle-err-${r.key}`} className="settle-err">{errors[r.key]}</span>}
          </td>
        </tr>)}</tbody>
      </table>
      <div className={`settle-total${confirming ? ' settle-total--confirm' : ''}`} aria-live="polite" data-testid="text-transaction-total">
        <span>{confirming ? `Confirm ${mode} payment dated ${date} across ${rows.length} order${rows.length > 1 ? 's' : ''}` : 'Aggregate total'}</span>
        <strong>{inr(totalPaise)}</strong>
      </div>
      {message && <p className={`settle-msg${phase === 'uncertain' || phase === 'checking' ? ' settle-msg--warn' : ''}`} role="alert" data-testid="status-transaction">{message}</p>}
    </form>
  </Dialog>;
}
