import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, RefreshCw, Wallet } from 'lucide-react';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import TablePagination from '../admin/TablePagination.jsx';
import KitsReferenceSelect from '../admin/KitsReferenceSelect.jsx';
import TransactionDialog from './TransactionDialog.jsx';
import { EMPTY_FILTERS, KINDS, KIND_LABEL, VERIFICATION, eligible, inr, listSettlements, referenceRequester, rowKey } from '../../services/serverSettlements.js';
import './settlements.css';

const POLL_MS = 60000, POLL_MAX = 15;
const NA = <span className="settle-na">Not recorded</span>;

function VerifyPill({ value }) {
  const tone = value === 'Verified' ? 'ok' : value === 'Not verified' ? 'pending' : 'none';
  return <span className={`settle-pill settle-pill--${tone}`} data-testid="status-verification">{value || 'No transactions'}</span>;
}

function Person({ p, label }) {
  if (!p) return NA;
  return <><strong>{p.name || 'Unnamed'}</strong>{p.qualification && <span className="settle-sub">{p.qualification}</span>}<span className="settle-sub settle-mono" aria-label={`${label} ID`}>{p.code || p.id}</span>
    {p.contactsMasked ? <span className="settle-sub">Contacts hidden in MR portal</span> : <>
      <span className="settle-sub">Phone: {p.phone || 'Not recorded'}</span>
      <span className="settle-sub">Email: {p.email || 'Not recorded'}</span>
    </>}</>;
}

function History({ row, date }) {
  const [open, setOpen] = useState(false);
  const tx = row.transactions || [];
  if (!tx.length) return <span className="settle-sub">No transactions yet</span>;
  return <div className="settle-history">
    <button type="button" className="settle-history__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={`button-history-${row.key}`}>
      {tx.length} transaction{tx.length > 1 ? 's' : ''}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <ul>{tx.map((t) => <li key={t.id}>
      <span className="settle-mono">{inr(t.amount)}</span>
      <span className="settle-sub">{date(t.date)} · {t.mode}</span>
      <VerifyPill value={t.verification} />
    </li>)}</ul>}
  </div>;
}

export default function SettlementsView({ mode, date, mrIdentity }) {
  const canPost = mode === 'mr';
  const [draft, setDraft] = useState(EMPTY_FILTERS), [applied, setApplied] = useState(EMPTY_FILTERS);
  const [people, setPeople] = useState({});
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [response, setResponse] = useState(null);
  const [pending, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [filterError, setFilterError] = useState('');
  const [selected, setSelected] = useState(() => new Map());
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const addRef = useRef(null);
  const dialogOpen = useRef(false);
  dialogOpen.current = Boolean(dialog);
  const refresh = () => { if (!dialogOpen.current) setRevision((n) => n + 1); };
  const requestKey = JSON.stringify([applied, page, pageSize, revision]);
  const result = response?.key === requestKey ? response : { items: [], total: 0 };
  const loading = pending || response?.key !== requestKey;

  // Finite polling and focus refresh; skipped while a draft is open.
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => { if (++count > POLL_MAX) clearInterval(timer); else if (!document.hidden) refresh(); }, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => { setSelected(new Map()); }, [applied, page, pageSize]);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true); setError('');
    listSettlements(applied, { offset: (page - 1) * pageSize, limit: pageSize, signal: controller.signal })
      .then((data) => {
        guard();
        if (controller.signal.aborted) return;
        const items = data.items.map((r) => ({ ...r, key: rowKey(r) }));
        setResponse({ key: requestKey, items, total: data.total });
        // Keep only still-eligible selections, with refreshed source values.
        setSelected((old) => { const m = new Map(); for (const r of items) if (old.has(r.key) && eligible(r)) m.set(r.key, r); return m; });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        try { guard(); } catch { return; }
        setError(e.message || 'Settlements could not be loaded.');
        setResponse({ key: requestKey, items: [], total: 0 }); setSelected(new Map());
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, pageSize, revision, requestKey]);

  const set = (patch) => { setDraft((v) => ({ ...v, ...patch })); setFilterError(''); };
  function apply(e) {
    e.preventDefault();
    if (draft.order_from && draft.order_to && draft.order_from > draft.order_to) return setFilterError('Order date From must be on or before To.');
    if (draft.payment_from && draft.payment_to && draft.payment_from > draft.payment_to) return setFilterError('Payment date From must be on or before To.');
    setSelected(new Map()); setApplied({ ...draft, mr_id: canPost ? '' : draft.mr_id }); setPage(1);
  }
  const reset = () => { setSelected(new Map()); setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setPeople({}); setFilterError(''); setPage(1); };

  const visibleEligible = result.items.filter(eligible);
  const allOn = visibleEligible.length > 0 && visibleEligible.every((r) => selected.has(r.key));
  const toggle = (r) => setSelected((old) => { const m = new Map(old); if (m.has(r.key)) m.delete(r.key); else m.set(r.key, r); return m; });
  const toggleAll = () => setSelected(allOn ? new Map() : new Map(visibleEligible.map((r) => [r.key, r])));

  function committed(batch) {
    setDialog(null);
    setSelected(new Map());
    setNotice(`Recorded ${inr(batch?.total)} by ${batch?.mode || 'payment'} across ${batch?.entries?.length || 0} order(s). Status: Not verified.`);
    setRevision((n) => n + 1);
    requestAnimationFrame(() => addRef.current?.focus());
  }

  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  const filterCount = Object.entries(applied).filter(([, v]) => v && v !== 'All').length;

  const orderCell = (r) => <><strong className="settle-mono" data-testid={`text-order-${r.key}`}>{r.number}</strong>
    <span className="settle-sub">{r.date ? date(r.date) : 'Date unavailable'}</span>
    <span className={`settle-kind settle-kind--${String(r.kind).toLowerCase()}`}>{KIND_LABEL[r.kind] || r.kind}</span></>;
  const patientsCell = (r) => r.patients?.length ? <ul className="settle-people">{r.patients.map((p, i) => <li key={p.id || i}><Person p={p} label="Patient" /></li>)}</ul> : NA;
  const money = (r) => <dl className="settle-money">
    <div><dt>Total</dt><dd>{r.total != null ? inr(r.total) : <span className="settle-na">Unavailable</span>}</dd></div>
    <div><dt>Paid</dt><dd>{inr(r.paid)}</dd></div>
    <div><dt>Balance</dt><dd className={r.balance != null && eligible(r) ? 'settle-due' : ''}>{r.balance != null ? inr(r.balance) : <span className="settle-na">Unavailable</span>}</dd></div>
  </dl>;
  const checkbox = (r) => canPost && <input type="checkbox" className="settle-check" checked={selected.has(r.key)} disabled={!eligible(r) || loading}
    onChange={() => toggle(r)} aria-label={eligible(r) ? `Select ${r.number}` : `${r.number} cannot receive a payment`}
    title={r.total == null ? 'No saved total yet' : !eligible(r) ? 'Fully paid' : undefined} data-testid={`checkbox-select-${r.key}`} />;

  return <div className="settle">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Accounts</p><h1>Settlements</h1>
        <p className="admin-page-head__description">{canPost
          ? 'Your In process orders and the payments you record against them.'
          : 'All In process orders and recorded payments. Read-only: only the owning MR can record transactions.'}</p></div>
      <div className="settle-top">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} disabled={loading} data-testid="button-refresh-settlements"><RefreshCw size={15} aria-hidden="true" />Refresh</button>
        {canPost && <button ref={addRef} type="button" className="admin-button" disabled={!selected.size || loading || Boolean(error)}
          onClick={() => { setNotice(''); setDialog([...selected.values()]); }} data-testid="button-add-transaction">
          <Plus size={16} aria-hidden="true" />Add transaction{selected.size ? ` (${selected.size})` : ''}</button>}
      </div>
    </div>

    <aside className="settle-note" data-testid="text-ledger-note">
      <Wallet size={18} aria-hidden="true" />
      <p><strong>Ledger starts at zero.</strong> Paid and Balance reflect only transactions recorded in Settlements. Older Paid, Partial or Unpaid flags on orders are not treated as payments. Orders without a saved total show Unavailable and cannot take a payment. Recorded transactions cannot be edited or deleted.</p>
    </aside>
    {notice && <div className="admin-feedback admin-feedback--success" role="status" data-testid="status-settlement-notice">{notice}</div>}

    <section className="admin-panel settle-panel" aria-label="Settlements">
      <form className="settle-filters" noValidate onSubmit={apply} onReset={(e) => { e.preventDefault(); reset(); }}>
        <fieldset><legend>Order date</legend>
          <label>From<input type="date" value={draft.order_from} max={draft.order_to || undefined} onChange={(e) => set({ order_from: e.target.value })} data-testid="input-order-from" /></label>
          <label>To<input type="date" value={draft.order_to} min={draft.order_from || undefined} onChange={(e) => set({ order_to: e.target.value })} data-testid="input-order-to" /></label>
        </fieldset>
        <fieldset><legend>Payment date</legend>
          <label>From<input type="date" value={draft.payment_from} max={draft.payment_to || undefined} onChange={(e) => set({ payment_from: e.target.value })} data-testid="input-payment-from" /></label>
          <label>To<input type="date" value={draft.payment_to} min={draft.payment_from || undefined} onChange={(e) => set({ payment_to: e.target.value })} data-testid="input-payment-to" /></label>
        </fieldset>
        <KitsReferenceSelect kind="doctors" id="settle-doctor" label="Doctor" value={draft.doctor_id} requester={referenceRequester} fieldClass="kits-field settle-ref"
          historicalPerson={people.doctor} onChange={(v) => set({ doctor_id: v })} onPerson={(p) => setPeople((o) => ({ ...o, doctor: p }))} />
        {canPost
          ? <div className="kits-field settle-ref"><span>MR</span><output className="settle-fixed" data-testid="text-fixed-mr">{mrIdentity || 'You'}</output></div>
          : <KitsReferenceSelect kind="mrs" id="settle-mr" label="MR" value={draft.mr_id} requester={referenceRequester} fieldClass="kits-field settle-ref"
            historicalPerson={people.mr} onChange={(v) => set({ mr_id: v })} onPerson={(p) => setPeople((o) => ({ ...o, mr: p }))} />}
        <KitsReferenceSelect kind="patients" id="settle-patient" label="Patient" value={draft.patient_id} requester={referenceRequester} fieldClass="kits-field settle-ref"
          historicalPerson={people.patient} onChange={(v) => set({ patient_id: v })} onPerson={(p) => setPeople((o) => ({ ...o, patient: p }))} />
        <label className="kits-field">Verification<select value={draft.verification} onChange={(e) => set({ verification: e.target.value })} data-testid="select-verification">{VERIFICATION.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="kits-field">Order type<select value={draft.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="select-kind">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div className="settle-filters__actions">
          <button type="reset" className="admin-button admin-button--secondary" data-testid="button-reset-settlements">Reset</button>
          <button type="submit" className="admin-button" data-testid="button-apply-settlements">Apply filters</button>
        </div>
        {filterError && <p className="settle-err" role="alert">{filterError}</p>}
        <p className="settle-sub settle-filters__hint">Date ranges include both ends. Payment date matches recorded transactions only, so orders without payments are excluded when it is set.{filterCount ? ` ${filterCount} filter${filterCount > 1 ? 's' : ''} applied.` : ''}</p>
      </form>

      {canPost && !error && <div className="settle-selectbar">
        <label><input type="checkbox" checked={allOn} disabled={!visibleEligible.length || loading} onChange={toggleAll} data-testid="checkbox-select-page" />
          Select all payable orders on this page ({visibleEligible.length})</label>
        <span role="status" aria-live="polite">{selected.size ? `${selected.size} selected` : 'No orders selected'}</span>
      </div>}

      {error ? <div className="settle-state settle-state--error" role="alert"><strong>Settlements unavailable</strong><p>{error}</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-retry-settlements">Retry</button></div>
        : loading ? <div className="settle-skeleton" aria-busy="true" aria-label="Loading settlements">{[0, 1, 2, 3].map((i) => <div key={i}><span /><span /><span /><span /></div>)}</div>
        : !result.items.length ? <div className="settle-state"><Wallet size={28} aria-hidden="true" /><strong>{filterCount ? 'No matching orders' : 'No In process orders'}</strong>
          <p>{filterCount ? 'Change or reset the filters.' : canPost ? 'Orders you own appear here once they are In process.' : 'Saved In process orders appear here.'}</p></div>
        : <>
          <div className="settle-table-wrap" tabIndex={0} role="region" aria-label="Settlements table, scrolls horizontally">
            <table className="settle-table">
              <caption className="sr-only">In process orders. Financial values include only transactions recorded in Settlements.</caption>
              <thead><tr>{canPost && <th scope="col"><span className="sr-only">Select</span></th>}<th scope="col">Sr.</th><th scope="col">Order</th><th scope="col">Patients</th><th scope="col">Doctor</th><th scope="col">MR</th><th scope="col">Payment</th><th scope="col">Verification</th><th scope="col">Transactions</th></tr></thead>
              <tbody>{result.items.map((r, i) => <tr key={r.key} data-selected={selected.has(r.key) || undefined} data-testid={`row-settlement-${r.key}`}>
                {canPost && <td>{checkbox(r)}</td>}
                <td className="settle-mono">{(page - 1) * pageSize + i + 1}</td>
                <td>{orderCell(r)}</td><td>{patientsCell(r)}</td>
                <td><Person p={r.doctor} label="Doctor" /></td><td><Person p={r.mr} label="MR" /></td>
                <td>{money(r)}</td><td><VerifyPill value={r.verification} /></td>
                <td><History row={r} date={date} /></td>
              </tr>)}</tbody>
            </table>
          </div>
          <ul className="settle-cards">{result.items.map((r) => <li key={r.key} className="settle-card" data-selected={selected.has(r.key) || undefined}>
            <div className="settle-card__head">{checkbox(r)}<div>{orderCell(r)}</div><VerifyPill value={r.verification} /></div>
            {money(r)}
            <dl className="settle-card__facts"><div><dt>Doctor</dt><dd><Person p={r.doctor} label="Doctor" /></dd></div><div><dt>MR</dt><dd><Person p={r.mr} label="MR" /></dd></div><div><dt>Patients</dt><dd>{patientsCell(r)}</dd></div></dl>
            <History row={r} date={date} />
          </li>)}</ul>
        </>}
      <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={result.total} total={result.total} label="orders" testId="settlements-count"
        onPageChange={(n) => { if (!loading && n >= 1 && n <= pageCount) { setSelected(new Map()); setPage(n); } }} onPageSizeChange={(s) => { setSelected(new Map()); setPageSize(s); setPage(1); }} />
    </section>
    {dialog && <TransactionDialog rows={dialog} onClose={() => { setDialog(null); requestAnimationFrame(() => addRef.current?.focus()); }} onCommitted={committed} />}
  </div>;
}
