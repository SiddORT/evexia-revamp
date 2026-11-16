import { Link } from 'wouter';
import { RefreshCw, Search } from 'lucide-react';
import { useAdminDateFormatters } from '../components/admin/adminPreferences.js';

function Due({ i }) {
  if (i.due != null) return <>₹{i.due}{i.pendingPricingOrders > 0 && <small className="mrd-pay__flag">+{i.pendingPricingOrders} pending pricing</small>}</>;
  return <>
    <span className="mrd-pay__unknown">Unavailable</span>
    <small className="mrd-pay__flag">Known ₹{i.knownDue} · {i.pendingPricingOrders} pending pricing</small>
  </>;
}

function Age({ i, date }) {
  if (i.oldestUnpaidAgeDays == null) return <span className="mrd-pay__muted">{i.pendingPricingOrders > 0 ? 'Unavailable' : 'No unpaid orders'}</span>;
  return <>{i.oldestUnpaidAgeDays} days
    <small>{i.oldestUnpaidDate ? date(i.oldestUnpaidDate) : ''}{i.pendingPricingOrders > 0 ? ' · known orders only' : ''}</small></>;
}

function Remaining({ i, limit }) {
  if (limit === 0) return <span className="mrd-pay__muted">No days restriction</span>;
  if (i.oldestUnpaidAgeDays == null) return <span className="mrd-pay__muted">{i.pendingPricingOrders > 0 ? 'Unavailable' : 'No deadline'}</span>;
  if ((i.overdueDays ?? 0) > 0 || i.daysRemaining === 0) return <span className="mrd-pay__over">Overdue
    {i.overdueDays > 0 && <small>{i.overdueDays} days over</small>}</span>;
  return i.daysRemaining == null ? <span className="mrd-pay__muted">Unavailable</span> : <>{i.daysRemaining} days</>;
}

export default function DoctorPayments({ state }) {
  const { date } = useAdminDateFormatters();
  const { data, error, loading, search, setSearch, query, offset, setOffset, page } = state;
  const outOfRange = data && offset > 0 && !data.items.length;
  return <section className="mrw-card mrd-pay" aria-labelledby="mrd-pay-h" data-testid="panel-doctor-payments">
    <header className="mrd-restrictions__header">
      <div><h2 id="mrd-pay-h">Doctor payments</h2>
        <small className="mrd-scopetag">Current balances · all dates · not filtered by FY</small></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={state.refresh} data-testid="button-refresh-doctor-payments">
        <RefreshCw size={15} aria-hidden="true" />Refresh</button>
    </header>
    <label className="mrd-pay__search"><span className="sr-only">Search Doctors</span>
      <Search size={15} aria-hidden="true" />
      <input type="search" className="admin-input" placeholder="Search Doctors" value={search} onChange={(e) => setSearch(e.target.value)}
        maxLength={100} data-testid="input-doctor-payments-search" /></label>

    {loading && <div className="mrd-skel" role="status" aria-label="Loading Doctor payments"><span className="mrd-skel__card" /><span className="mrd-skel__card" /></div>}
    {error && <div className="mrd-restrictions__state mrd-restrictions__state--error" role="alert" data-testid="status-doctor-payments-error">
      <strong>Doctor payments unavailable</strong><span>{error} No balances shown.</span>
      <button type="button" className="mrd-link" onClick={state.refresh}>Retry</button></div>}
    {data && (data.items.length === 0 ? <div className="mrd-restrictions__state" role="status" data-testid="status-doctor-payments-empty">
      <strong>{outOfRange ? 'No Doctors on this page' : query ? `No Doctors match “${query}”` : 'No assigned Doctors'}</strong>
      {outOfRange && <button type="button" className="mrd-link" onClick={() => setOffset(0)}>Back to first page</button>}
    </div> : <>
      <table className="mrd-pay__table" role="table">
        <caption className="sr-only">Doctor payments, evaluated {date(data.businessDate)}</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Doctor</th><th role="columnheader" scope="col" className="num">Payments received</th><th role="columnheader" scope="col" className="num">Due amount</th><th role="columnheader" scope="col">Oldest unpaid age</th><th role="columnheader" scope="col">Days remaining</th></tr></thead>
        <tbody role="rowgroup">{data.items.map((i) => <tr role="row" key={i.doctorId} data-testid={`row-doctor-payment-${i.doctorId}`}>
          <th role="rowheader" scope="row"><Link href={`/mr/doctors/${i.doctorId}`} data-testid={`link-doctor-payment-${i.doctorId}`}>{i.doctorName}</Link></th>
          <td role="cell" className="num" data-label="Payments received">₹{i.received}</td>
          <td role="cell" className="num" data-label="Due amount"><Due i={i} /></td>
          <td role="cell" data-label="Oldest unpaid age"><Age i={i} date={date} /></td>
          <td role="cell" data-label="Days remaining"><Remaining i={i} limit={data.doctorDaysLimit} /></td>
        </tr>)}</tbody>
      </table>
      <p className="mrd-restrictions__metadata">Evaluated {date(data.businessDate)} · Asia/Kolkata · Days limit {data.doctorDaysLimit === 0 ? 'disabled' : `${data.doctorDaysLimit} days`}</p>
    </>)}
    {data && (data.total > page || offset > 0) && <nav className="mrd-restrictions__pages" aria-label="Doctor payments pages">
      <button type="button" className="admin-button admin-button--secondary" disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - page))} data-testid="button-doctor-payments-previous">Previous</button>
      <span>{data.items.length ? `${offset + 1}–${offset + data.items.length} of ${data.total}` : `${data.total} Doctors · page out of range`}</span>
      <button type="button" className="admin-button admin-button--secondary" disabled={offset + page >= data.total} onClick={() => setOffset((n) => n + page)} data-testid="button-doctor-payments-next">Next</button>
    </nav>}
  </section>;
}
