import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import Dialog from '../admin/Dialog.jsx';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { KIND_LABEL, fetchHistory, inr, isUuid, verifyEntry, verifyLabel } from '../../services/serverSettlements.js';

export function VerifyPill({ value }) {
  const tone = value === 'Verified' ? 'ok' : value === 'Not verified' ? 'pending' : 'none';
  return <span className={`settle-pill settle-pill--${tone}`} data-testid="status-verification">{verifyLabel(value)}</span>;
}

const stamp = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };

export default function HistoryDialog({ row, date, canVerify, onClose, onChanged }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setError('');
    fetchHistory(row.kind, row.id, controller.signal)
      .then((r) => { guard(); if (!controller.signal.aborted) setRecord(r); })
      .catch((e) => { if (controller.signal.aborted) return; try { guard(); } catch { return; } setError(e.message || 'Transaction history could not be loaded.'); });
    return () => controller.abort();
  }, [row.kind, row.id, revision]);

  async function verify(t) {
    if (busy.current || !record) return;
    busy.current = true; setBusyId(t.id); setVerifyError(''); setNotice('');
    // Even a lost response may have committed verification; refresh the
    // underlying listing on close regardless of the response outcome.
    onChanged?.();
    const guard = reportingIdentityGuard();
    try {
      const next = await verifyEntry(record, t.id);
      guard();
      setRecord(next); setConfirmId(null); onChanged?.();
      setNotice(`${inr(t.amount)} dated ${date(t.date)} is verified. Order status: ${verifyLabel(next.verification)}.`);
    } catch (e) {
      setVerifyError(`${e.message || 'Verification could not be confirmed.'} Reload the history to see the current status, then retry if it is still Unverified.`);
    } finally { busy.current = false; setBusyId(null); }
  }

  const tx = record?.transactions || [];
  const verifiedCount = tx.filter((t) => t.verification === 'Verified').length;
  return <Dialog eyebrow="Transactions" title={`Order ${row.number}`} className="settle-dialog settle-history-dialog" onClose={onClose} dismissDisabled={Boolean(busyId)}
    description={`${KIND_LABEL[row.kind] || row.kind} · recorded payments only. Receipts cannot be edited or deleted.`}
    footer={<button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busyId)} onClick={onClose} data-testid="button-close-history">Close</button>}>
    {error ? <div className="settle-state settle-state--error" role="alert"><strong>History unavailable</strong><p>{error}</p>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { setRecord(null); setRevision((n) => n + 1); }} data-testid="button-retry-history">Retry</button></div>
      : !record ? <div className="settle-skeleton" aria-busy="true" aria-label="Loading transactions">{[0, 1, 2].map((i) => <div key={i}><span /><span /><span /><span /></div>)}</div>
        : <>
          <dl className="settle-money settle-history-sum">
            <div><dt>Total</dt><dd>{record.total != null ? inr(record.total) : <span className="settle-na">Unavailable</span>}</dd></div>
            <div><dt>Paid</dt><dd>{inr(record.paid)}</dd></div>
            <div><dt>Balance</dt><dd>{record.balance != null ? inr(record.balance) : <span className="settle-na">Unavailable</span>}</dd></div>
            <div><dt>Status</dt><dd><VerifyPill value={record.verification} />{tx.length > 0 && record.verification !== 'Verified' && <span className="settle-sub" data-testid="text-verified-count">{verifiedCount} of {tx.length} verified</span>}</dd></div>
          </dl>
          {notice && <p className="admin-feedback admin-feedback--success" role="status" data-testid="status-verify-notice">{notice}</p>}
          {verifyError && <div className="settle-msg settle-msg--warn" role="alert">{verifyError}
            <button type="button" className="kits-link" onClick={() => { setVerifyError(''); setRevision((n) => n + 1); }} data-testid="button-reload-history">Reload history</button></div>}
          {!tx.length ? <div className="settle-state"><strong>No transactions</strong><p>No payment has been recorded against this order yet.</p></div>
            : <ul className="settle-txlist">{tx.map((t) => <li key={t.id} data-testid={`row-transaction-${t.id}`}>
              <div className="settle-txlist__main">
                <strong className="settle-mono">{inr(t.amount)}</strong>
                <span className="settle-sub">{date(t.date)} · {t.mode}</span>
                <span className="settle-sub">Reference: {t.reference || 'Not supplied'}</span>
                {t.verification === 'Verified' && (t.verifiedAt || (t.verifiedBy && !isUuid(t.verifiedBy)))
                  && <span className="settle-sub">Verified{t.verifiedBy && !isUuid(t.verifiedBy) ? ` by ${t.verifiedBy}` : ''}{t.verifiedAt ? ` on ${stamp(t.verifiedAt)}` : ''}</span>}
              </div>
              <div className="settle-txlist__side">
                <VerifyPill value={t.verification} />
                {canVerify && t.verification !== 'Verified' && (confirmId === t.id
                  ? <div className="settle-confirm" role="group" aria-label="Confirm verification">
                    <span>Verify this {inr(t.amount)} entry? This cannot be reversed.</span>
                    <button type="button" className="admin-button admin-button--secondary" disabled={busyId === t.id} onClick={() => setConfirmId(null)} data-testid={`button-cancel-verify-${t.id}`}>Cancel</button>
                    <button type="button" className="admin-button" disabled={busyId === t.id} onClick={() => verify(t)} data-testid={`button-confirm-verify-${t.id}`}>{busyId === t.id ? 'Verifying…' : 'Confirm verify'}</button>
                  </div>
                  : <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busyId)} onClick={() => { setVerifyError(''); setConfirmId(t.id); }} data-testid={`button-verify-${t.id}`}><ShieldCheck size={15} aria-hidden="true" />Verify</button>)}
              </div>
            </li>)}</ul>}
        </>}
  </Dialog>;
}
