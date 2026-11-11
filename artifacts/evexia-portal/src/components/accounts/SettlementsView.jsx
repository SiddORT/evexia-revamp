import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Filter, History, Plus, RefreshCw, Search, Wallet } from 'lucide-react';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import TablePagination from '../admin/TablePagination.jsx';
import KitsReferenceSelect from '../admin/KitsReferenceSelect.jsx';
import SearchableSelect from '../admin/SearchableSelect.jsx';
import TransactionDialog from './TransactionDialog.jsx';
import HistoryDialog, { VerifyPill } from './HistoryDialog.jsx';
import { EMPTY_FILTERS, KINDS, KIND_LABEL, ORDER_STATUSES, PAYMENT_STATUSES, VERIFICATION_OPTIONS, inr, listSettlements, referenceRequester, rowKey } from '../../services/serverSettlements.js';
import './settlements.css';

const POLL_MS = 60000, POLL_MAX = 15;
const NA = <span className="settle-na">Not recorded</span>;
const KIND_OPTIONS = KINDS.map(([value, label]) => ({ value, label }));
const PAY_OPTIONS = PAYMENT_STATUSES.map((v) => ({ value: v, label: v === 'All' ? 'All payment statuses' : v }));
// Admin keeps its prior default view (approved In process orders); MR sees all saved owned orders.
const defaultsFor = (mode) => (mode === 'mr' ? EMPTY_FILTERS : { ...EMPTY_FILTERS, order_status: 'In process' });

function Person({ p }) {
  if (!p) return NA;
  return <><strong>{p.name || 'Unnamed'}</strong>{p.qualification && <span className="settle-sub">{p.qualification}</span>}{p.code && <span className="settle-sub settle-mono">{p.code}</span>}
    {p.contactsMasked ? <span className="settle-sub">Contacts hidden in MR portal</span> : <>
      {p.phone && <span className="settle-sub">Phone: {p.phone}</span>}
      {p.email && <span className="settle-sub">Email: {p.email}</span>}
    </>}</>;
}

function PayPill({ value }) {
  const tone = value === 'Paid' ? 'ok' : value === 'Part paid' ? 'pending' : value === 'Unpaid' ? 'due' : 'none';
  return <span className={`settle-pill settle-pill--${tone}`} data-testid="status-payment">{value}</span>;
}

export default function SettlementsView({ mode, date, mrIdentity }) {
  const canPost = mode === 'mr';
  const defaults = defaultsFor(mode);
  const [draft, setDraft] = useState(defaults), [applied, setApplied] = useState(defaults);
  const [people, setPeople] = useState({});
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [response, setResponse] = useState(null);
  const [pending, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [filterError, setFilterError] = useState('');
  const filterDisclosure = useRef(null);
  const [dialog, setDialog] = useState(false);
  const [history, setHistory] = useState(null);
  const [notice, setNotice] = useState('');
  const addRef = useRef(null);
  const refreshRef = useRef(null);
  const returnRef = useRef(null);
  const historyChanged = useRef(false);
  const dialogOpen = useRef(false);
  dialogOpen.current = dialog || Boolean(history);
  const refresh = () => { if (!dialogOpen.current) setRevision((n) => n + 1); };
  const requestKey = JSON.stringify([applied, page, pageSize, revision]);
  const result = response?.key === requestKey ? response : { items: [], total: 0 };
  const loading = pending || response?.key !== requestKey;

  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => { if (++count > POLL_MAX) clearInterval(timer); else if (!document.hidden) refresh(); }, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true); setError('');
    listSettlements(applied, { offset: (page - 1) * pageSize, limit: pageSize, signal: controller.signal })
      .then((data) => {
        guard();
        if (controller.signal.aborted) return;
        setResponse({ key: requestKey, items: data.items.map((r) => ({ ...r, key: rowKey(r) })), total: data.total });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        try { guard(); } catch { return; }
        setError(e.message || 'Accounts could not be loaded.');
        setResponse({ key: requestKey, items: [], total: 0 });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, pageSize, revision, requestKey]);

  const set = (patch) => { setDraft((v) => ({ ...v, ...patch })); setFilterError(''); };
  function apply(e) {
    e?.preventDefault();
    const invalidRange = draft.order_from && draft.order_to && draft.order_from > draft.order_to ? 'order'
      : draft.payment_from && draft.payment_to && draft.payment_from > draft.payment_to ? 'payment' : '';
    if (invalidRange) {
      setFilterError(`${invalidRange === 'order' ? 'Order' : 'Payment'} date From must be on or before To.`);
      if (canPost && filterDisclosure.current) {
        filterDisclosure.current.open = true;
        requestAnimationFrame(() => filterDisclosure.current?.querySelector(`[data-testid="input-${invalidRange}-from"]`)?.focus());
      }
      return;
    }
    setApplied({ ...draft, search: draft.search.trim().slice(0, 100), mr_id: canPost ? '' : draft.mr_id }); setPage(1);
  }
  const reset = () => { setDraft(defaults); setApplied(defaults); setPeople({}); setFilterError(''); setPage(1); };

  const focusBack = (el) => requestAnimationFrame(() => { if (el?.isConnected) el.focus(); else (addRef.current || refreshRef.current)?.focus(); });
  function committed(batch) {
    setDialog(false);
    setNotice(`Recorded ${inr(batch?.total)} by ${batch?.mode || 'payment'}${batch?.reference ? ` (ref. ${batch.reference})` : ''} across ${batch?.entries?.length || 0} order(s). Status: Unverified.`);
    setRevision((n) => n + 1);
    focusBack(addRef.current);
  }
  function openHistory(r, el) { returnRef.current = el; historyChanged.current = false; setHistory(r); }
  function closeHistory() {
    setHistory(null);
    if (historyChanged.current) setRevision((n) => n + 1);
    focusBack(returnRef.current);
  }

  const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
  const filterCount = Object.entries(applied).filter(([k, v]) => k !== 'search' && v && v !== 'All' && v !== defaults[k]).length + (applied.search ? 1 : 0);
  const statusOptions = [...new Set([...ORDER_STATUSES, ...result.items.map((r) => r.status)])].map((v) => ({ value: v, label: v === 'All' ? 'All order statuses' : v }));

  const orderCell = (r) => <><strong className="settle-mono" data-testid={`text-order-${r.key}`}>{r.number}</strong>
    <span className="settle-sub">{r.date ? date(r.date) : 'Date unavailable'} · {r.status}</span>
    <span className={`settle-kind settle-kind--${String(r.kind).toLowerCase()}`}>{KIND_LABEL[r.kind] || r.kind}</span>
    {!r.payable && r.balance != null && r.balance !== '0.00' && <span className="settle-sub">{canPost && ['Confirmed', 'Saved'].includes(r.status) ? 'Admin approval required before payment' : 'Not payable at this status'}</span>}</>;
  const patientsCell = (r) => r.patients?.length ? <ul className="settle-people">{r.patients.map((p, i) => <li key={p.id || i}><Person p={p} /></li>)}</ul> : NA;
  const money = (r) => <dl className="settle-money">
    <div><dt>Total</dt><dd>{r.total != null ? inr(r.total) : <span className="settle-na">Unavailable</span>}</dd></div>
    <div><dt>Paid</dt><dd>{inr(r.paid)}</dd></div>
    <div><dt>Balance</dt><dd className={r.payable ? 'settle-due' : ''}>{r.balance != null ? inr(r.balance) : <span className="settle-na">Unavailable</span>}</dd></div>
  </dl>;
  const action = (r) => <button type="button" className="admin-button admin-button--secondary settle-action" onClick={(e) => openHistory(r, e.currentTarget)}
    aria-label={`View transactions for ${r.number}`} data-testid={`button-history-${r.key}`}><History size={15} aria-hidden="true" />{r.transactions.length ? `Transactions (${r.transactions.length})` : 'View transactions'}</button>;

  const paymentFilters = <>
    <div className={canPost ? 'kits-field' : 'settle-toolbar__select'}>{canPost && <span>Payment status</span>}<SearchableSelect id="settle-pay-status" label="Payment status" value={draft.payment_status} options={PAY_OPTIONS} onChange={(v) => set({ payment_status: v || 'All' })} placeholder="All payment statuses" viewportMenu /></div>
    <div className={canPost ? 'kits-field' : 'settle-toolbar__select'}>{canPost && <span>Verification</span>}<SearchableSelect id="settle-verification" label="Verification" value={draft.verification} options={VERIFICATION_OPTIONS} onChange={(v) => set({ verification: v || 'All' })} placeholder="All verification" viewportMenu /></div>
  </>;
  const orderFilters = <>
    <fieldset aria-describedby={canPost && filterError.startsWith('Order') ? 'settle-filter-error' : undefined}><legend>Order date</legend>
      <label>From<input type="date" value={draft.order_from} max={draft.order_to || undefined} aria-invalid={canPost && filterError.startsWith('Order') || undefined} aria-describedby={canPost && filterError.startsWith('Order') ? 'settle-filter-error' : undefined} onChange={(e) => set({ order_from: e.target.value })} data-testid="input-order-from" /></label>
      <label>To<input type="date" value={draft.order_to} min={draft.order_from || undefined} onChange={(e) => set({ order_to: e.target.value })} data-testid="input-order-to" /></label>
    </fieldset>
    <KitsReferenceSelect kind="doctors" id="settle-doctor" label="Doctor" value={draft.doctor_id} requester={referenceRequester} fieldClass="kits-field settle-ref"
      historicalPerson={people.doctor} onChange={(v) => set({ doctor_id: v })} onPerson={(p) => setPeople((o) => ({ ...o, doctor: p }))} />
    <div className="kits-field"><span>Order type</span><SearchableSelect id="settle-kind" label="Order type" value={draft.kind} options={KIND_OPTIONS} onChange={(v) => set({ kind: v || 'All' })} placeholder="All types" viewportMenu /></div>
    <div className="kits-field"><span>Order status</span><SearchableSelect id="settle-order-status" label="Order status" value={draft.order_status} options={statusOptions} onChange={(v) => set({ order_status: v || 'All' })} placeholder="All order statuses" viewportMenu /></div>
  </>;
  const additionalFilters = <>
    <fieldset aria-describedby={canPost && filterError.startsWith('Payment') ? 'settle-filter-error' : undefined}><legend>Payment date</legend>
      <label>From<input type="date" value={draft.payment_from} max={draft.payment_to || undefined} aria-invalid={canPost && filterError.startsWith('Payment') || undefined} aria-describedby={canPost && filterError.startsWith('Payment') ? 'settle-filter-error' : undefined} onChange={(e) => set({ payment_from: e.target.value })} data-testid="input-payment-from" /></label>
      <label>To<input type="date" value={draft.payment_to} min={draft.payment_from || undefined} onChange={(e) => set({ payment_to: e.target.value })} data-testid="input-payment-to" /></label>
    </fieldset>
    {canPost
      ? <div className="kits-field settle-ref"><span>MR</span><output className="settle-fixed" data-testid="text-fixed-mr">{mrIdentity || 'You'}</output></div>
      : <KitsReferenceSelect kind="mrs" id="settle-mr" label="MR" value={draft.mr_id} requester={referenceRequester} fieldClass="kits-field settle-ref"
        historicalPerson={people.mr} onChange={(v) => set({ mr_id: v })} onPerson={(p) => setPeople((o) => ({ ...o, mr: p }))} />}
    <KitsReferenceSelect kind="patients" id="settle-patient" label="Patient" value={draft.patient_id} requester={referenceRequester} fieldClass="kits-field settle-ref"
      historicalPerson={people.patient} onChange={(v) => set({ patient_id: v })} onPerson={(p) => setPeople((o) => ({ ...o, patient: p }))} />
  </>;

  return <div className="settle">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Accounts</p><h1 tabIndex={-1}>{canPost ? 'Accounts' : 'Settlements'}</h1>
        <p className="admin-page-head__description">{canPost
          ? 'Your saved orders, what has been recorded against them and what is still due.'
          : 'Orders and recorded payments. Super Admin may verify individual recorded entries; only the owning MR records payments.'}</p></div>
      <div className="settle-top">
        <button ref={refreshRef} type="button" className="admin-button admin-button--secondary" onClick={refresh} aria-disabled={loading} data-testid="button-refresh-settlements"><RefreshCw size={15} aria-hidden="true" />Refresh</button>
        {canPost && <button ref={addRef} type="button" className="admin-button" onClick={() => { setNotice(''); setDialog(true); }} data-testid="button-add-transaction">
          <Plus size={16} aria-hidden="true" />Add payment</button>}
      </div>
    </div>

    {!canPost && <aside className="settle-note" data-testid="text-ledger-note">
      <Wallet size={18} aria-hidden="true" />
      <p><strong>Ledger starts at zero.</strong> Paid and Balance reflect only payments recorded here; legacy Paid or Partial flags are not treated as payments. Orders without a saved total show Unavailable. Recorded payments cannot be edited or deleted.</p>
    </aside>}
    {notice && <div className="admin-feedback admin-feedback--success" role="status" data-testid="status-settlement-notice">{notice}</div>}

    <section className="admin-panel settle-panel" aria-label="Accounts">
      <form className="settle-toolbar" noValidate onSubmit={apply}>
        <div className="settle-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={draft.search} maxLength={100} placeholder="Search order number, doctor or patient" aria-label="Search orders"
            onChange={(e) => set({ search: e.target.value })} data-testid="input-search-settlements" />
        </div>
        {!canPost && paymentFilters}
        <button type="submit" className="admin-button" data-testid="button-apply-settlements">Apply</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-reset-settlements">Reset</button>
        {!canPost && <div className="settle-filters settle-primary-filters">{orderFilters}</div>}
        {canPost && <details ref={filterDisclosure} className="settle-filter-disclosure settle-filter-disclosure--mr">
          <summary data-testid="button-toggle-settlement-filters"><Filter size={15} aria-hidden="true" />Filter records{filterCount > 0 && ` · ${filterCount} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
          <div className="settle-filters">{paymentFilters}{orderFilters}{additionalFilters}</div>
        </details>}
      </form>
      {!canPost && <details className="settle-filter-disclosure">
        <summary data-testid="button-toggle-settlement-filters"><Filter size={15} aria-hidden="true" />More filters{filterCount > 0 && ` · ${filterCount} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
        <form className="settle-filters" noValidate onSubmit={apply}>
          {additionalFilters}
          <div className="settle-filters__actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-reset-settlements-more">Reset</button>
            <button type="submit" className="admin-button" data-testid="button-apply-settlements-more">Apply filters</button>
          </div>
          {filterError && <p className="settle-err" role="alert">{filterError}</p>}
          <p className="settle-sub settle-filters__hint">Date ranges include both ends. Payment date matches recorded payments only, so orders without payments are excluded when it is set.</p>
        </form>
      </details>}
      {filterError && <p id="settle-filter-error" className="settle-err settle-toolbar__err" role="alert">{filterError}</p>}

      {error ? <div className="settle-state settle-state--error" role="alert"><strong>Accounts unavailable</strong><p>{error}</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-retry-settlements">Retry</button></div>
        : loading ? <div className="settle-skeleton" aria-busy="true" aria-label="Loading orders">{[0, 1, 2, 3].map((i) => <div key={i}><span /><span /><span /><span /></div>)}</div>
          : !result.items.length ? <div className="settle-state"><Wallet size={28} aria-hidden="true" /><strong>{filterCount ? 'No matching orders' : 'No saved orders yet'}</strong>
            <p>{filterCount ? 'Change or reset the filters.' : canPost ? 'Orders you save appear here with their payment position.' : 'Saved orders appear here.'}</p></div>
            : <>
              <div className="settle-table-wrap" tabIndex={0} role="region" aria-label="Orders table, scrolls horizontally">
                <table className="settle-table">
                  <caption className="sr-only">Saved orders. Financial values include only payments recorded in Accounts.</caption>
                  <thead><tr><th scope="col">Sr.</th><th scope="col">Order</th><th scope="col">Doctor</th><th scope="col">Patients</th>{!canPost && <th scope="col">MR</th>}<th scope="col">Amounts</th><th scope="col">Payment</th><th scope="col">Verification</th><th scope="col">Actions</th></tr></thead>
                  <tbody>{result.items.map((r, i) => <tr key={r.key} data-testid={`row-settlement-${r.key}`}>
                    <td className="settle-mono">{(page - 1) * pageSize + i + 1}</td>
                    <td>{orderCell(r)}</td><td><Person p={r.doctor} /></td><td>{patientsCell(r)}</td>
                    {!canPost && <td><Person p={r.mr} /></td>}
                    <td>{money(r)}</td><td><PayPill value={r.paymentStatus} /></td><td><VerifyPill value={r.verification} /></td>
                    <td>{action(r)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <ul className="settle-cards">{result.items.map((r) => <li key={r.key} className="settle-card">
                <div className="settle-card__head"><div>{orderCell(r)}</div><PayPill value={r.paymentStatus} /></div>
                {money(r)}
                <dl className="settle-card__facts"><div><dt>Doctor</dt><dd><Person p={r.doctor} /></dd></div>{!canPost && <div><dt>MR</dt><dd><Person p={r.mr} /></dd></div>}<div><dt>Patients</dt><dd>{patientsCell(r)}</dd></div><div><dt>Verification</dt><dd><VerifyPill value={r.verification} /></dd></div></dl>
                {action(r)}
              </li>)}</ul>
            </>}
      <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={result.total} total={result.total} label="orders" testId="settlements-count"
        onPageChange={(n) => { if (!loading && n >= 1 && n <= pageCount) setPage(n); }} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
    </section>
    {dialog && <TransactionDialog formatDate={date} onClose={() => { setDialog(false); focusBack(addRef.current); }} onCommitted={committed} />}
    {history && <HistoryDialog row={history} date={date} canVerify={mode === 'admin'} onClose={closeHistory} onChanged={() => { historyChanged.current = true; }} />}
  </div>;
}
