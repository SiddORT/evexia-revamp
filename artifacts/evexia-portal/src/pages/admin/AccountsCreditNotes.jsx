import { useEffect, useRef, useState } from 'react';
import { FileMinus, RefreshCw, Search, Undo2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import KitsReferenceSelect from '../../components/admin/KitsReferenceSelect.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import { contactReadScope, reportingIdentityGuard } from '../../auth/adminSession.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { KIND_LABEL, inr, listCreditNotes, lookupCreditRequest, newIdempotencyKey, referenceRequester, revertCreditNote, validateCredit } from '../../services/serverSettlements.js';
import '../../components/accounts/settlements.css';

const EMPTY = { search: '', date_from: '', date_to: '', mr_id: '' };
const stamp = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };

function RevertDialog({ note, date, onClose, onDone }) {
  const [phase, setPhase] = useState('confirm'); // confirm | posting | uncertain | checking
  const [message, setMessage] = useState('');
  const frozen = useRef(null);
  const uncertainEver = useRef(false);
  const busy = useRef(false);
  const locked = phase !== 'confirm';
  const lockedRef = useRef(locked); lockedRef.current = locked;
  useEffect(() => setNavigationGuard(() => { if (!lockedRef.current) return false; setMessage((m) => m || 'This reversal is not confirmed yet.'); return true; }), []);
  useEffect(() => {
    const warn = (e) => { if (frozen.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  async function send() {
    if (busy.current) return;
    if (!frozen.current) frozen.current = Object.freeze({ idempotency_key: newIdempotencyKey() });
    busy.current = true; setPhase('posting'); setMessage('');
    const guard = reportingIdentityGuard();
    try { const next = await revertCreditNote(note.id, frozen.current); guard(); busy.current = false; frozen.current = null; onDone(next); }
    catch (err) {
      busy.current = false;
      if (err.terminal) { frozen.current = null; setPhase('confirm'); setMessage(`${err.message || 'The reversal was rejected.'} Nothing changed. Reversal is allowed only while the order is not fully settled; partial cash still permits it.`); return; }
      uncertainEver.current = true; setPhase('uncertain');
      setMessage('The outcome is not confirmed. Check its status or retry the exact same reversal; it will never apply twice.');
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
      if (res.status === 'committed' && res.note.id === note.id && res.note.status === 'Reverted') { frozen.current = null; onDone(validateCredit(res.note)); return; }
      if (res.status === 'rejected') { frozen.current = null; uncertainEver.current = false; setPhase('confirm'); setMessage(`${res.rejection.message} Nothing changed.`); return; }
      setPhase('uncertain'); setMessage('No committed reversal was found yet. That does not cancel it; retry the same reversal to finish it.');
    } catch (err) { busy.current = false; setPhase('uncertain'); setMessage(`${err.message || 'Status could not be checked.'} The reversal is kept unchanged.`); }
  }
  const close = () => { if (!lockedRef.current) onClose(); };
  const uncertain = phase === 'uncertain' || phase === 'checking';
  return <Dialog eyebrow="Credit note" title={`Revert ${note.number}`} className="settle-dialog" onClose={close} dismissDisabled={locked}
    description={`Order ${note.orderNumber} · ${inr(note.amount)} against invoice ${note.invoiceReference}, ${date(note.date)}.`}
    footer={uncertain ? <>
      <button type="button" className="admin-button admin-button--secondary" disabled={phase === 'checking'} onClick={check} data-testid="button-check-revert">{phase === 'checking' ? 'Checking…' : 'Check status'}</button>
      <button type="button" className="admin-button" disabled={phase === 'checking'} onClick={send} data-testid="button-retry-revert">Retry same reversal</button>
    </> : <>
      <button type="button" className="admin-button admin-button--secondary" disabled={locked} onClick={close} data-testid="button-cancel-revert">Cancel</button>
      <button type="button" className="admin-button" disabled={locked} onClick={send} data-testid="button-confirm-revert">{phase === 'posting' ? 'Reverting…' : 'Revert credit'}</button>
    </>}>
    <p>The credit stops reducing the order balance, which rises by {inr(note.amount)}. The note stays listed as Reverted.</p>
    {message && <p className={`settle-msg${uncertain ? ' settle-msg--warn' : ''}`} role="alert" data-testid="status-revert">{message}</p>}
  </Dialog>;
}

function CreditNotesView({ date }) {
  const [draft, setDraft] = useState(EMPTY), [applied, setApplied] = useState(EMPTY);
  const [mrPerson, setMrPerson] = useState(null);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(''), [filterError, setFilterError] = useState('');
  const [revert, setRevert] = useState(null);
  const [notice, setNotice] = useState('');
  const returnRef = useRef(null), refreshRef = useRef(null);
  const key = JSON.stringify([applied, page, pageSize, revision]);
  const loading = response?.key !== key && !error;
  const result = response?.key === key ? response : { items: [], total: 0 };

  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setError('');
    listCreditNotes(applied, { offset: (page - 1) * pageSize, limit: pageSize, signal: controller.signal })
      .then((d) => { guard(); if (!controller.signal.aborted) setResponse({ key, items: d.items, total: d.total }); })
      .catch((e) => { if (controller.signal.aborted) return; try { guard(); } catch { return; } setError(e.message || 'Credit notes could not be loaded.'); });
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(e) {
    e.preventDefault();
    if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) { setFilterError('Date From must be on or before To.'); return; }
    setFilterError(''); setApplied({ ...draft, search: draft.search.trim().slice(0, 100) }); setPage(1);
  }
  const focusBack = () => requestAnimationFrame(() => (returnRef.current?.isConnected ? returnRef.current : refreshRef.current)?.focus());
  const filtered = Object.values(applied).some(Boolean);
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));

  return <div className="settle credit-notes">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Accounts</p><h1 tabIndex={-1}>Credit notes</h1>
        <p className="admin-page-head__description">Every credit applied against an order, including reverted ones. Credits reduce balance but are never cash.</p></div>
      <div className="settle-top"><button ref={refreshRef} type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)} data-testid="button-refresh-credits"><RefreshCw size={15} aria-hidden="true" />Refresh</button></div>
    </div>
    {notice && <div className="admin-feedback admin-feedback--success" role="status" data-testid="status-credit-notice">{notice}</div>}
    <section className="admin-panel settle-panel" aria-label="Credit notes">
      <form className="credit-filters" noValidate onSubmit={apply}>
        <div className="kits-field"><span>Search</span><div className="settle-search"><Search size={15} aria-hidden="true" />
          <input type="search" maxLength={100} value={draft.search} placeholder="Note, order or invoice" aria-label="Search credit notes" onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))} data-testid="input-search-credits" /></div></div>
        <label className="kits-field"><span>Date from</span><input type="date" value={draft.date_from} max={draft.date_to || undefined} aria-invalid={Boolean(filterError) || undefined} onChange={(e) => setDraft((d) => ({ ...d, date_from: e.target.value }))} data-testid="input-credit-from" /></label>
        <label className="kits-field"><span>Date to</span><input type="date" value={draft.date_to} min={draft.date_from || undefined} onChange={(e) => setDraft((d) => ({ ...d, date_to: e.target.value }))} data-testid="input-credit-to" /></label>
        <KitsReferenceSelect kind="mrs" id="credit-mr" label="MR" value={draft.mr_id} requester={referenceRequester} fieldClass="kits-field settle-ref" historicalPerson={mrPerson} onChange={(v) => setDraft((d) => ({ ...d, mr_id: v }))} onPerson={setMrPerson} />
        <div className="credit-filters__actions">
          <button type="submit" className="admin-button" data-testid="button-apply-credits">Apply</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setMrPerson(null); setFilterError(''); setPage(1); }} data-testid="button-reset-credits">Reset</button>
        </div>
      </form>
      {filterError && <p className="settle-err" role="alert">{filterError}</p>}
      {error ? <div className="settle-state settle-state--error" role="alert"><strong>Credit notes unavailable</strong><p>{error}</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)} data-testid="button-retry-credits">Retry</button></div>
        : loading ? <div className="settle-skeleton" aria-busy="true" aria-label="Loading credit notes">{[0, 1, 2, 3].map((i) => <div key={i}><span /><span /><span /><span /></div>)}</div>
          : !result.items.length ? <div className="settle-state"><FileMinus size={28} aria-hidden="true" /><strong>{filtered ? 'No matching credit notes' : 'No credit notes yet'}</strong>
            <p>{filtered ? 'Change or reset the filters.' : 'Add a credit note from a Settlements row with an outstanding balance.'}</p></div>
            : <div className="settle-table-wrap" tabIndex={0} role="region" aria-label="Credit notes table, scrolls horizontally">
              <table className="settle-table">
                <caption className="sr-only">Credit notes, newest first</caption>
                <thead><tr><th scope="col">Note</th><th scope="col">Order</th><th scope="col">Doctor</th><th scope="col">MR</th><th scope="col">Invoice</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                <tbody>{result.items.map((c) => <tr key={c.id} data-testid={`row-credit-note-${c.id}`}>
                  <td><strong className="settle-mono">{c.number}</strong><span className="settle-sub">{date(c.date)}</span></td>
                  <td><strong className="settle-mono">{c.orderNumber}</strong><span className="settle-sub">{c.orderDate ? date(c.orderDate) : 'Date unavailable'} · {KIND_LABEL[c.kind] || c.kind}</span></td>
                  <td>{c.doctor?.name || <span className="settle-na">Not recorded</span>}</td>
                  <td>{c.mr?.name || <span className="settle-na">Not recorded</span>}</td>
                  <td className="settle-mono">{c.invoiceReference}</td>
                  <td className="settle-mono">{inr(c.amount)}</td>
                  <td><span className={`settle-pill settle-pill--${c.status === 'Active' ? 'ok' : 'none'}`} data-testid={`status-credit-note-${c.id}`}>{c.status}</span>
                    {c.status === 'Reverted' && <span className="settle-sub">{stamp(c.revertedAt)}{c.revertedBy ? ` · ${c.revertedBy}` : ''}</span>}</td>
                  <td>{c.canRevert ? <button type="button" className="admin-button admin-button--secondary settle-action" onClick={(e) => { returnRef.current = e.currentTarget; setNotice(''); setRevert(c); }} data-testid={`button-revert-${c.id}`}><Undo2 size={15} aria-hidden="true" />Revert</button>
                    : <span className="settle-sub">{c.status === 'Active' ? 'Not revertible while fully settled' : '—'}</span>}</td>
                </tr>)}</tbody>
              </table>
            </div>}
      <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={result.total} total={result.total} label="credit notes" testId="credit-notes-count"
        onPageChange={(n) => { if (!loading && n >= 1 && n <= pageCount) setPage(n); }} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
    </section>
    {revert && <RevertDialog note={revert} date={date} onClose={() => { setRevert(null); focusBack(); }}
      onDone={(n) => { setRevert(null); setNotice(`${n.number} reverted. ${inr(n.amount)} is back on order ${n.orderNumber}'s balance.`); setRevision((x) => x + 1); focusBack(); }} />}
  </div>;
}

export default function AccountsCreditNotes() {
  const { user } = useAdminSession();
  const { date } = useAdminDateFormatters();
  if (!isSuperAdminIdentity(user)) return <AdminLayout title="CREDIT NOTES"><section className="admin-panel settle-state" role="alert"><strong>Credit notes are restricted</strong><p>Only the Super Admin can view credit notes.</p></section></AdminLayout>;
  return <AdminLayout title="CREDIT NOTES"><CreditNotesView key={`${user?.id}:${contactReadScope(user)}`} date={(v) => (v ? date(v) : '')} /></AdminLayout>;
}
