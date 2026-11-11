import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import Dialog from '../admin/Dialog.jsx';
import SearchableSelect from '../admin/SearchableSelect.jsx';
import TablePagination from '../admin/TablePagination.jsx';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { BATCH_LIMIT, EMPTY_FILTERS, KIND_LABEL, MODES, REFERENCE, confirmBatch, fromPaise, inr, listSettlements, lookupRequest, postTransaction, rowKey, toPaise } from '../../services/serverSettlements.js';
import { todayISO as today } from '../../services/serverShipments.js';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16);
}));
// Definite rejections: the server answered and did not commit.
const definite = (e) => [400, 403, 404, 409, 422].includes(e?.status);
const MODE_OPTIONS = MODES.map((m) => ({ value: m, label: m }));
const names = (r) => (r.patients || []).map((p) => p?.name).filter(Boolean).join(', ') || 'Patient not recorded';

export default function TransactionDialog({ onClose, onCommitted, formatDate }) {
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState('');
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState(() => new Map());
  const [amounts, setAmounts] = useState({});
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState('edit'); // edit | posting | uncertain | checking
  const [message, setMessage] = useState('');
  // Independent pending-order picker (server search + pagination).
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [listError, setListError] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedPageSize, setSelectedPageSize] = useState(10);
  const selectedToggle = useRef(null);
  const reviewHeading = useRef(null);
  const saveButton = useRef(null);
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

  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setResult(null); setListError('');
    listSettlements({ ...EMPTY_FILTERS, search, payable_only: true }, { offset: (page - 1) * pageSize, limit: pageSize, signal: controller.signal })
      .then((data) => {
        guard();
        if (controller.signal.aborted) return;
        const items = data.items.map((r) => ({ ...r, key: rowKey(r) }));
        setResult({ items, total: data.total });
        // Refresh snapshots of selected orders seen again; never while a payload is frozen.
        if (!lockedRef.current && !frozen.current) setSelected((old) => { let m = old; for (const r of items) if (old.has(r.key)) { if (m === old) m = new Map(old); m.set(r.key, r); } return m; });
      })
      .catch((e) => { if (controller.signal.aborted) return; try { guard(); } catch { return; } setListError(e.message || 'Pending orders could not be loaded.'); });
    return () => controller.abort();
  }, [search, page, pageSize, revision]);

  const rows = [...selected.values()];
  const parsed = rows.map((r) => ({ row: r, p: toPaise(amounts[r.key] || '') }));
  const totalPaise = parsed.reduce((s, x) => s + (x.p ?? 0n), 0n);
  const editable = !locked && !confirming;
  const full = selected.size >= BATCH_LIMIT;
  const selectedPageCount = Math.max(1, Math.ceil(rows.length / selectedPageSize));
  const visibleSelectedPage = Math.min(selectedPage, selectedPageCount);
  const pageItems = selectedOnly
    ? rows.slice((visibleSelectedPage - 1) * selectedPageSize, visibleSelectedPage * selectedPageSize)
    : result?.items || [];

  function toggle(r) {
    if (!editable) return;
    if (selectedOnly) requestAnimationFrame(() => selectedToggle.current?.focus());
    setSelected((old) => {
      const m = new Map(old);
      if (m.has(r.key)) m.delete(r.key); else if (m.size < BATCH_LIMIT) m.set(r.key, r);
      return m;
    });
    setErrors((e) => ({ ...e, selection: undefined }));
  }
  const pageAllOn = pageItems.length > 0 && pageItems.every((r) => selected.has(r.key));
  function togglePage() {
    if (!editable) return;
    if (selectedOnly) requestAnimationFrame(() => selectedToggle.current?.focus());
    setSelected((old) => {
      const m = new Map(old);
      if (pageAllOn) pageItems.forEach((r) => m.delete(r.key));
      else for (const r of pageItems) { if (m.size >= BATCH_LIMIT) break; m.set(r.key, r); }
      return m;
    });
  }

  function validate() {
    const next = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = 'Enter the payment date.';
    else if (date > today()) next.date = 'The payment date cannot be in the future.';
    if (!MODES.includes(mode)) next.mode = 'Choose a payment mode.';
    const ref = reference.trim();
    if (ref && !REFERENCE.test(ref)) next.reference = 'Use up to 100 plain-text characters without control characters.';
    if (!rows.length) next.selection = 'Select at least one pending order.';
    else if (rows.length > BATCH_LIMIT) next.selection = `A payment can cover at most ${BATCH_LIMIT} orders.`;
    for (const { row, p } of parsed) {
      const raw = (amounts[row.key] || '').trim();
      if (!raw) next[row.key] = 'Enter an amount.';
      else if (p == null) next[row.key] = 'Use digits with up to 2 decimals, for example 1250.50.';
      else if (p <= 0n) next[row.key] = 'Amount must be more than zero.';
      else if (p > toPaise(row.balance)) next[row.key] = `Cannot exceed the balance of ${inr(row.balance)}.`;
    }
    setErrors(next);
    const firstInvalid = rows.findIndex((r) => next[r.key]);
    if (firstInvalid !== -1) {
      setSelectedOnly(true);
      setSelectedPage(Math.floor(firstInvalid / selectedPageSize) + 1);
      requestAnimationFrame(() => document.getElementById(`settle-amount-${rows[firstInvalid].key}`)?.focus());
    }
    return Object.keys(next).length === 0;
  }

  function review(e) {
    e.preventDefault();
    if (locked || confirming) return;
    setMessage('');
    if (validate()) {
      frozen.current = Object.freeze({
        idempotency_key: newKey(), date, mode, reference: reference.trim() || null,
        entries: Object.freeze(rows.map((r) => Object.freeze({ kind: r.kind, id: r.id, expected_version: r.version,
          expected_paid: r.paid, amount: fromPaise(toPaise(amounts[r.key])) }))),
      });
      setConfirming(true);
      requestAnimationFrame(() => reviewHeading.current?.focus());
    }
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
        setMessage(`${err.message || 'The payment was rejected.'} Nothing was recorded. Refreshing pending orders; remove and reselect any changed order to load its current balance before reviewing again.`);
        setRevision((n) => n + 1);
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
        setRevision((n) => n + 1);
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
    if (busy.current || !frozen.current) return;
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
        <button type="button" className="admin-button admin-button--secondary" disabled={phase === 'posting'} onClick={() => { frozen.current = null; setConfirming(false); requestAnimationFrame(() => saveButton.current?.focus()); }} data-testid="button-back-transaction">Back to edit</button>
        <button type="button" className="admin-button" disabled={phase === 'posting'} aria-disabled={phase === 'posting'} onClick={confirm} data-testid="button-confirm-transaction">{phase === 'posting' ? 'Recording…' : `Record ${inr(totalPaise)}`}</button>
      </>
      : <>
        <button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-transaction">Cancel</button>
        <button ref={saveButton} type="submit" form="settle-form" className="admin-button" data-testid="button-review-transaction">Save</button>
      </>;

  const pageCount = Math.max(1, Math.ceil((result?.total || 0) / pageSize));
  return <Dialog eyebrow="Accounts" title="Add payment" className="settle-dialog settle-dialog--wide" onClose={close} dismissDisabled={locked || confirming}
    footer={footer}>
    <form id="settle-form" noValidate onSubmit={review} className="settle-form">
      {editable && <fieldset className="settle-form__common settle-payment-toolbar">
        <legend className="sr-only">Payment details and pending-order search</legend>
        <div className="kits-field"><label htmlFor="settle-pending-search">Search</label>
          <div className="settle-payment-search">
            <div className="settle-search">
              <Search size={15} aria-hidden="true" />
              <input id="settle-pending-search" type="search" value={searchDraft} maxLength={100} placeholder="Order, doctor or patient" aria-label="Search pending orders"
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setSearch(searchDraft.trim()); setPage(1); setSelectedOnly(false); } }} data-testid="input-search-pending" />
            </div>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => { setSearch(searchDraft.trim()); setPage(1); setSelectedOnly(false); }} data-testid="button-search-pending">Search</button>
          </div>
        </div>
        <div className="kits-field"><span id="settle-mode-label">Payment mode</span>
          <SearchableSelect id="settle-mode" label="Payment mode" value={mode} options={MODE_OPTIONS} onChange={setMode} placeholder="Choose mode"
            invalid={Boolean(errors.mode)} describedBy={errors.mode ? 'settle-mode-err' : undefined} disabled={!editable} viewportMenu />
          {errors.mode && <span id="settle-mode-err" className="settle-err">{errors.mode}</span>}
        </div>
        <div className="kits-field"><span id="settle-derived-total-label">Amount (INR)</span><output aria-labelledby="settle-derived-total-label" className="settle-fixed settle-mono">{inr(totalPaise)}</output></div>
        <label className="kits-field">Transaction ID / UTR (optional)
          <input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} aria-invalid={Boolean(errors.reference)}
            aria-describedby={errors.reference ? 'settle-ref-err' : undefined} placeholder="e.g. UTR 4021 8876 1190" data-testid="input-transaction-reference" />
          {errors.reference && <span id="settle-ref-err" className="settle-err">{errors.reference}</span>}
        </label>
        <label className="kits-field">Payment date
          <input type="date" value={date} max={today()} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'settle-date-err' : undefined}
            onChange={(e) => setDate(e.target.value)} data-testid="input-transaction-date" />
          {errors.date && <span id="settle-date-err" className="settle-err">{errors.date}</span>}
        </label>
      </fieldset>}

      {editable && <section className="settle-picker settle-picker--payment" aria-label="Pending orders">
        <div className="settle-picker__head">
          <span className="settle-sub" role="status" aria-live="polite" data-testid="text-selected-count">{selected.size} of {BATCH_LIMIT} orders selected{full ? ' · limit reached' : ''}</span>
          <button ref={selectedToggle} type="button" className="admin-button admin-button--secondary" aria-pressed={selectedOnly} onClick={() => setSelectedOnly((v) => !v)} data-testid="button-selected-pending">{selectedOnly ? 'Show pending orders' : `Show selected (${selected.size})`}</button>
        </div>
        {errors.selection && <p className="settle-err" role="alert">{errors.selection}</p>}
        {!selectedOnly && listError ? <div className="settle-state settle-state--error" role="alert"><strong>Pending orders unavailable</strong><p>{listError}</p>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)} data-testid="button-retry-pending">Retry</button></div>
          : !selectedOnly && !result ? <div className="settle-skeleton" aria-busy="true" aria-label="Loading pending orders">{[0, 1, 2].map((i) => <div key={i}><span /><span /><span /><span /></div>)}</div>
            : !pageItems.length ? <div className="settle-state"><strong>{selectedOnly ? 'No selected orders' : search ? 'No matching pending orders' : 'Nothing pending'}</strong><p>{selectedOnly ? 'Show pending orders to select an order.' : search ? 'Try another search.' : 'All your payable orders are fully paid.'}</p></div>
              : <div className="settle-table-wrap" tabIndex={0} role="region" aria-label={`${selectedOnly ? 'Selected' : 'Pending'} orders, scrolls horizontally`}>
                <table className="settle-table settle-table--compact settle-payment-table">
                  <caption className="sr-only">{selectedOnly ? 'Selected orders' : 'Pending orders'} with payment amounts in INR</caption>
                  <thead><tr>
                    <th scope="col"><input type="checkbox" className="settle-check" checked={pageAllOn} onChange={togglePage} aria-label="Select all orders on this page only" data-testid="checkbox-select-pending-page" /></th>
                    <th scope="col">Order / date</th><th scope="col">Doctor</th><th scope="col">Patients</th><th scope="col">Total</th><th scope="col">Outstanding</th><th scope="col">Payment (INR)</th>
                  </tr></thead>
                  <tbody>{pageItems.map((r) => <tr key={r.key} data-selected={selected.has(r.key) || undefined}>
                    <td><input type="checkbox" className="settle-check" checked={selected.has(r.key)} disabled={!selected.has(r.key) && full} onChange={() => toggle(r)}
                      aria-label={`Select ${r.number}`} data-testid={`checkbox-pending-${r.key}`} /></td>
                    <td><strong className="settle-mono">{r.number}</strong><span className="settle-sub">{r.date ? formatDate(r.date) : 'Date unavailable'} · {KIND_LABEL[r.kind]}</span></td>
                    <td>{r.doctor?.name || 'Not recorded'}</td><td>{names(r)}</td>
                    <td className="settle-mono">{inr(r.total)}</td><td className="settle-mono settle-due">{inr(r.balance)}</td>
                    <td>
                      <input id={`settle-amount-${r.key}`} inputMode="decimal" className="settle-amount" aria-label={`Amount for ${r.number}`} value={amounts[r.key] || ''} disabled={!selected.has(r.key)}
                        aria-invalid={selected.has(r.key) && Boolean(errors[r.key])} aria-describedby={selected.has(r.key) && errors[r.key] ? `settle-err-${r.key}` : undefined}
                        maxLength={15} onChange={(e) => setAmounts((a) => ({ ...a, [r.key]: e.target.value }))}
                        placeholder="0.00" data-testid={`input-amount-${r.key}`} />
                      {selected.has(r.key) && <button type="button" className="kits-link" onClick={() => setAmounts((a) => ({ ...a, [r.key]: r.balance }))} data-testid={`button-full-${r.key}`}>Full balance</button>}
                      {selected.has(r.key) && errors[r.key] && <span id={`settle-err-${r.key}`} className="settle-err">{errors[r.key]}</span>}
                    </td>
                  </tr>)}</tbody>
                </table>
              </div>}
        {selectedOnly
          ? <TablePagination page={visibleSelectedPage} pageCount={selectedPageCount} pageSize={selectedPageSize} filtered={rows.length} total={rows.length} label="selected orders" testId="selected-pending-count"
            onPageChange={(n) => { if (n >= 1 && n <= selectedPageCount) setSelectedPage(n); }} onPageSizeChange={(s) => { setSelectedPageSize(s); setSelectedPage(1); }} />
          : <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={result?.total || 0} total={result?.total || 0} label="pending orders" testId="pending-count"
            onPageChange={(n) => { if (n >= 1 && n <= pageCount) setPage(n); }} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />}
      </section>}

      {confirming && <section aria-label="Payment confirmation">
        <h3 ref={reviewHeading} tabIndex={-1} className="settle-h3">Confirm payment</h3>
        <p className="settle-sub">Payments cannot be edited or deleted. Recorded entries start as Unverified.</p>
        <div className="settle-confirmation-scroll" tabIndex={0} role="region" aria-label="Allocation summary, scrolls horizontally">
          <table className="settle-entries">
            <caption className="sr-only">Amount per selected order</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Amount (INR)</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.key}>
              <th scope="row"><strong className="settle-mono">{r.number}</strong><span className="settle-sub">{KIND_LABEL[r.kind] || r.kind} · {r.doctor?.name || 'Doctor not recorded'}</span><span className="settle-sub">{names(r)}</span></th>
              <td className="settle-mono">{inr(toPaise(amounts[r.key]))}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
      <div className={`settle-total${confirming ? ' settle-total--confirm' : ''}`} aria-live="polite" data-testid="text-transaction-total">
        <span>{confirming ? `Confirm ${mode} payment dated ${formatDate(date)}${reference.trim() ? `, reference ${reference.trim()}` : ''}, across ${rows.length} order${rows.length > 1 ? 's' : ''}` : 'Selected payment total'}</span>
        <strong>{inr(totalPaise)}</strong>
      </div>
      {message && <p className={`settle-msg${phase === 'uncertain' || phase === 'checking' ? ' settle-msg--warn' : ''}`} role="alert" data-testid="status-transaction">{message}</p>}
    </form>
  </Dialog>;
}
