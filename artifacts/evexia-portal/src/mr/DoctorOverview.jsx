import { Link } from 'wouter';
import { Eye } from 'lucide-react';
import { statusPill } from './common.jsx';
import DoctorOrders from './DoctorOrders.jsx';

export const dash = (value) => String(value ?? '').trim() || '--';
const isInt = (v) => Number.isInteger(v) && v >= 0;

// Exact minor-unit formatting; never uses Number/parseFloat on money.
export function formatMinor(minor) {
  if (typeof minor !== 'string' || !/^-?\d+$/.test(minor.trim())) return null;
  let big = BigInt(minor.trim());
  const negative = big < 0n;
  if (negative) big = -big;
  const whole = (big / 100n).toString();
  const frac = (big % 100n).toString().padStart(2, '0');
  const grouped = whole.length > 3
    ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`
    : whole;
  return `${negative ? '-' : ''}\u20B9${grouped}.${frac}`;
}

export function summaryModel(doctor) {
  const s = doctor?.orderSummary;
  if (!s || typeof s !== 'object' || !isInt(s.orderCount)) return { available: false };
  const value = s.valueAvailability === 'available' && s.knownValueMinor != null ? formatMinor(s.knownValueMinor) : null;
  const flags = s.paymentFlags || {};
  return {
    available: true, count: s.orderCount, pending: isInt(s.pendingFulfillment) ? s.pendingFulfillment : null,
    untracked: isInt(s.fulfillmentUntracked) ? s.fulfillmentUntracked : null,
    value, priced: isInt(s.pricedOrders) ? s.pricedOrders : null, unpriced: isInt(s.unpricedOrders) ? s.unpricedOrders : null,
    flags, domains: Array.isArray(s.domains) ? s.domains : [],
    valueReason: s.valueUnavailableReason,
  };
}

export function valueText(m) {
  if (!m.available) return 'Unavailable';
  if (m.count === 0) return 'No orders';
  if (m.priced === 0 && m.unpriced > 0) return 'Unpriced';
  return m.value ?? 'Unavailable';
}
export function coverageText(m) {
  if (m.available && !m.value) return m.valueReason === 'scan_limit'
    ? 'Saved-price inspection limit exceeded; no partial sum shown'
    : m.valueReason === 'scope_changed' ? 'Orders changed during the read; refresh for prices'
      : 'Saved prices could not be read; no partial sum shown';
  if (!m.available) return '';
  if (m.priced == null || m.unpriced == null) return 'Known priced subtotal';
  return `Known subtotal: ${m.priced} priced, ${m.unpriced} unpriced`;
}
export const limitText = (v, money) => {
  const t = String(v ?? '').trim();
  if (!t) return 'Not set';
  return money ? `\u20B9${t}` : t;
};

function Metric({ label, children, note }) {
  return <div className="mrw-do-metric"><dt>{label}</dt><dd>{children}{note && <small>{note}</small>}</dd></div>;
}

export function PaymentFlagsText({ m }) {
  if (!m.available) return 'Payment flags unavailable';
  if (m.count === 0) return 'No orders, so no payment flags';
  const f = m.flags;
  return `Kits/Lupin saved flags: ${f.paid ?? 0} paid, ${f.unpaid ?? 0} unpaid, ${f.partial ?? 0} partial; ${f.notTracked ?? 0} not tracked`;
}

export function DoctorSummary({ doctor }) {
  const m = summaryModel(doctor);
  return <dl className="mrw-do-summary" aria-label={`Order summary for ${dash(doctor.name)}`}>
    <Metric label="Total orders">{m.available ? m.count : 'Unavailable'}</Metric>
    <Metric label="Pending fulfillment" note={m.available && m.untracked ? `${m.untracked} untracked (SPT)` : undefined}>{m.available ? (m.pending ?? 'Unavailable') : 'Unavailable'}</Metric>
    <Metric label="Known priced subtotal" note={coverageText(m) || undefined}>{valueText(m)}</Metric>
    <Metric label="Pending payment" note={<PaymentFlagsText m={m} />}>Unavailable</Metric>
    <Metric label="Days limit (configured)">{limitText(doctor.daysLimit)}</Metric>
    <Metric label="Payment limit (configured)">{limitText(doctor.paymentLimit, true)}</Metric>
  </dl>;
}

function DoctorDetailsLink({ doctor, className = '' }) {
  const label = `View details for ${dash(doctor.name)} (${dash(doctor.doctorNumber)})`;
  return <Link className={`mrw-do-link ${className}`} href={`/mr/doctors/${doctor.id}`} aria-label={label} title={label} data-testid={`link-doctor-details-${doctor.id}`}><Eye size={20} aria-hidden="true" /></Link>;
}

export function DoctorCard({ doctor }) {
  return <article className="mrw-do-card" data-testid={`card-doctor-${doctor.id}`}>
    <header>
      <div><h2>{dash(doctor.name)}</h2><p className="mrw-doctor-number">{dash(doctor.doctorNumber)}</p></div>
      {statusPill(doctor.status)}
    </header>
    <p className="mrw-do-clinic">{dash(doctor.clinicName)}</p>
    <DoctorSummary doctor={doctor} />
    <p className="mrw-do-secondary">Reg. {dash(doctor.registrationNumber)} · {dash(doctor.qualification)} · {dash(doctor.phoneDisplay)} · {dash(doctor.emailDisplay)}</p>
    <DoctorDetailsLink doctor={doctor} className="mrw-do-view" />
  </article>;
}

export function DoctorGrid({ records }) {
  return <div className="mrw-do-grid">{records.map((d) => <DoctorCard key={d.id} doctor={d} />)}</div>;
}

export function DoctorTable({ records, partial, serial }) {
  const heads = ['Sr No', 'Doctor / clinic', 'Orders', 'Order value', 'Payment status / limits', 'Details'];
  return <div className="mrw-card mrw-doctor-list" role="region" aria-label="Assigned doctor list">
    <table className="mrw-table mrw-doctor-table mrw-do-table">
      <caption className="sr-only">{partial ? 'Rows restart numbering in each bounded search section.' : 'Assigned doctors.'} Order totals cover all MR-owned saved orders for the doctor; value is a known priced subtotal. On narrow screens each record stacks with labeled fields.</caption>
      <colgroup>{['52px', undefined, '16%', '18%', '23%', '64px'].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
      <thead><tr>{heads.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{records.map((d, index) => {
        const m = summaryModel(d);
        return <tr key={d.id}>
          <td><span className="mrw-doctor-label" aria-hidden="true">{heads[0]}</span><div className="mrw-doctor-value">{serial(index)}</div></td>
          <td><span className="mrw-doctor-label" aria-hidden="true">{heads[1]}</span><div className="mrw-doctor-value">
            <strong>{dash(d.name)}</strong> {statusPill(d.status)}
            <div className="mrw-doctor-number">{dash(d.doctorNumber)} · Reg. {dash(d.registrationNumber)}</div>
            <div>{dash(d.clinicName)}</div>
            <div className="mrw-doctor-number">{dash(d.phoneDisplay)} · {dash(d.emailDisplay)}</div></div></td>
          <td><span className="mrw-doctor-label" aria-hidden="true">{heads[2]}</span><div className="mrw-doctor-value">{m.available ? (m.count ? `${m.count} total` : 'No orders') : 'Unavailable'}<div className="mrw-doctor-number">Pending fulfillment: {m.available ? (m.pending ?? 'Unavailable') : 'Unavailable'}</div>{m.untracked > 0 && <div className="mrw-doctor-number">{m.untracked} SPT orders: fulfillment not tracked</div>}</div></td>
          <td><span className="mrw-doctor-label" aria-hidden="true">{heads[3]}</span><div className="mrw-doctor-value">{valueText(m)}<div className="mrw-doctor-number">{coverageText(m)}</div></div></td>
          <td><span className="mrw-doctor-label" aria-hidden="true">{heads[4]}</span><div className="mrw-doctor-value">Pending payment: Unavailable<div className="mrw-doctor-number"><PaymentFlagsText m={m} /></div><div className="mrw-doctor-number">Limits: {limitText(d.daysLimit)} days, {limitText(d.paymentLimit, true)}</div></div></td>
          <td><span className="mrw-doctor-label" aria-hidden="true">{heads[5]}</span><div className="mrw-doctor-value"><DoctorDetailsLink doctor={d} /></div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

const Section = ({ title, children }) => <section className="mrw-card mrw-do-section"><h2>{title}</h2>{children}</section>;
const Fields = ({ rows }) => <dl className="mrw-dl">{rows.map(([l, v]) => <div className="mrw-profile-field" key={l}><dt>{l}</dt><dd>{dash(v)}</dd></div>)}</dl>;

export function DoctorDetailView({ doctor }) {
  const addrParts = [['Address line 1', doctor.addressLine1], ['Address line 2', doctor.addressLine2], ['Landmark', doctor.landmark], ['City', doctor.city], ['State', doctor.state], ['Pincode', doctor.pincode], ['Country', doctor.country]];
  const shown = addrParts.filter(([, v]) => String(v ?? '').trim());
  return <div className="mrw-do-detail">
    <Section title="Identity and clinic"><Fields rows={[['Doctor number', doctor.doctorNumber], ['Registration number', doctor.registrationNumber], ['Qualification', doctor.qualification], ['Clinic', doctor.clinicName], ['Date of joining', doctor.dateOfJoining], ['Assigned MR', doctor.mrName], ['Zone', doctor.zoneName], ['Status', doctor.status], ['Verification', doctor.verification]]} /></Section>
    <Section title="Location">
      {shown.length ? <Fields rows={shown} /> : <p className="mrw-notice">No address available.</p>}
    </Section>
    <Section title="Contact (masked)"><Fields rows={[['Phone', doctor.phoneDisplay], ['Alternate phone', doctor.alternatePhoneDisplay], ['Email', doctor.emailDisplay]]} /></Section>
    <Section title="Configured terms"><Fields rows={[['Invoice type', doctor.invoiceType], ['GST number', doctor.gstNumber], ['Drug licence number', doctor.drugLicenceNumber], ['Order discount (%)', doctor.orderDiscount], ['Days limit (configured)', limitText(doctor.daysLimit)], ['Payment limit (configured)', limitText(doctor.paymentLimit, true)]]} /></Section>
    <DoctorOrders doctorId={doctor.id} />
  </div>;
}
