import { Link } from 'wouter';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useAdminDateFormatters } from '../components/admin/adminPreferences.js';

/** Compact Overview status. Uses the dashboard-level restriction state; no own fetching. */
export function RestrictionSummary({ state, onOpen }) {
  const d = state.data;
  return <section className="mrw-card mrd-rsum" aria-labelledby="mrd-rsum-h" data-testid="panel-restrictions-summary">
    <h2 id="mrd-rsum-h">Limits <small>Current · all dates</small></h2>
    {state.loading ? <p className="mrd-rsum__state" role="status">Loading limits…</p>
      : state.error ? <p className="mrd-rsum__state mrd-rsum__state--error" role="alert" data-testid="status-restrictions-summary-error">Restrictions unavailable — not assumed clear.</p>
        : <dl className="mrd-rsum__dl">
          <div><dt>Payment limit</dt><dd>₹{d.paymentLimit}{d.paymentLimit === '0.00' && <small>Disabled</small>}</dd></div>
          <div><dt>Days limit</dt><dd>{d.doctorDaysLimit} days{d.doctorDaysLimit === 0 && <small>Disabled</small>}</dd></div>
          <div className={d.total ? 'is-alert' : ''}><dt>Blocked Doctors</dt><dd data-testid="text-restrictions-summary-blocked">{d.total}</dd></div>
        </dl>}
    <button type="button" className="admin-button admin-button--secondary mrd-rsum__go" onClick={onOpen} data-testid="button-open-doctor-payments">
      Doctor payments <ArrowRight size={15} aria-hidden="true" /></button>
  </section>;
}

export default function FinancialRestrictions({ state }) {
  const { date } = useAdminDateFormatters();
  const { data, error, loading, offset, setOffset, page } = state;
  const outOfRange = data && offset > 0 && !data.items.length;
  const showPages = data && (data.total > page || offset > 0);
  return <section className="mrw-card mrd-restrictions" aria-labelledby="mr-financial-restrictions">
    <header className="mrd-restrictions__header">
      <div><h2 id="mr-financial-restrictions">Limits and blocked Doctors</h2>
        <small className="mrd-scopetag">Current · all dates</small></div>
      <button type="button" className="admin-button admin-button--secondary" data-testid="button-refresh-restrictions"
        onClick={state.refresh}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
    </header>
    {loading && <p className="mrd-restrictions__state" role="status" data-testid="status-restrictions-loading">Loading limits…</p>}
    {error && <p className="mrd-restrictions__state mrd-restrictions__state--error" role="alert" data-testid="status-restrictions-error">
      <strong>Restrictions unavailable</strong><span>{error} Not assumed clear.</span>
    </p>}
    {data && <>
      <dl className="mrd-restrictions__summary">
        <div data-testid="text-restrictions-payment-limit"><dt>MR Payment Limit</dt><dd>₹{data.paymentLimit}
          {data.paymentLimit === '0.00' && <small>Disabled · zero limit</small>}</dd></div>
        <div data-testid="text-restrictions-days-limit"><dt>Doctor Days Limit</dt><dd>{data.doctorDaysLimit} <span>days</span>
          {data.doctorDaysLimit === 0 && <small>Disabled · zero limit</small>}</dd></div>
        <div data-testid="text-restrictions-blocked-total"><dt>Blocked Doctors</dt><dd>{data.total}<small>Overdue-days rule</small></dd></div>
      </dl>
      <p className="mrd-restrictions__metadata" data-testid="text-restrictions-evaluated">Evaluated {date(data.businessDate)} · Asia/Kolkata</p>
      {data.items.length ? <ul className="mrd-restrictions__doctors" aria-label="Blocked Doctors">
        {data.items.map((item) => <li key={item.doctorId} data-testid={`row-restrictions-doctor-${item.doctorId}`}>
          <Link className="mrd-restrictions__doctor" href={`/mr/doctors/${item.doctorId}`} data-testid={`link-restrictions-doctor-${item.doctorId}`}>
            <strong>{item.doctorName}</strong><span>View Doctor</span>
          </Link>
          <dl className="mrd-restrictions__evidence">
            <div><dt>Unpaid</dt><dd>₹{item.doctorPendingBalance}</dd></div>
            <div><dt>Oldest unpaid</dt><dd>{date(item.oldestDoctorUnpaidDate)}<small>{item.oldestDoctorUnpaidAgeDays} days old</small></dd></div>
            <div><dt>Days limit</dt><dd>{item.doctorDaysLimit} days</dd></div>
          </dl>
        </li>)}
      </ul> : <div className="mrd-restrictions__state" role="status" data-testid="status-restrictions-empty">
        <strong>{outOfRange || data.total ? 'No Doctors on this page' : data.doctorDaysLimit === 0 ? 'Days restriction disabled' : 'No Doctors blocked'}</strong>
        <span>{outOfRange ? 'Go to the previous page.' : data.total ? 'Refresh to retry.' : 'Unpaid balances may still exist.'}</span>
      </div>}
      {data.pendingPricingOrders?.length > 0 && <p className="mrd-restrictions__pricing" data-testid="status-restrictions-pending-pricing">
        <strong>Pending pricing:</strong> {data.pendingPricingOrders.length} order(s) not counted as zero or overdue.
      </p>}
      {showPages && <nav className="mrd-restrictions__pages" aria-label="Blocked Doctors pages">
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-restrictions-previous" disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - page))}>Previous</button>
        <span>{data.items.length ? `${offset + 1}–${offset + data.items.length} of ${data.total}` : `${data.total} blocked · page out of range`}</span>
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-restrictions-next" disabled={offset + page >= data.total} onClick={() => setOffset((n) => n + page)}>Next</button>
      </nav>}
    </>}
  </section>;
}
