import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, CreditCard, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import { loadDoctors } from '../../services/doctors.js';
import { loadDemoPayments, DOCTOR_PAYMENT_STORAGE_KEY, filterDemoPayments, demoPaymentTotals, validPaymentDate } from '../../services/doctorPayments.js';
import '../../doctor-payments.css';

const LIST_PATH = '/admin/masters/doctors';
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const formatMoney = (paise) => money.format(paise / 100);
const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatDate = (date) => dateFormatter.format(new Date(`${date}T00:00:00Z`));
const display = (value) => String(value ?? '').trim() || '—';

function readRecords() {
  try {
    return { doctors: loadDoctors(), payments: loadDemoPayments(), error: '' };
  } catch (cause) {
    return { doctors: [], payments: [], error: cause?.message || 'Browser-local records could not be read. Refresh records and try again.' };
  }
}

export default function DoctorPaymentHistory({ id }) {
  const [snapshot, setSnapshot] = useState(readRecords);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [updatedElsewhere, setUpdatedElsewhere] = useState('');

  const refresh = useCallback(() => {
    setSnapshot(readRecords());
    setUpdatedElsewhere('');
  }, []);

  useEffect(() => {
    refresh();
  }, [id, refresh]);

  useEffect(() => {
    function onStorage(event) {
      // Doctor and payment records can both change in another tab. Reloading any
      // local-storage change avoids showing an outdated doctor identity.
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      setSnapshot(readRecords());
      setUpdatedElsewhere(event.key === DOCTOR_PAYMENT_STORAGE_KEY
        ? 'Payment records changed in another tab. The latest records have been loaded.'
        : 'Browser-local records changed in another tab. The latest doctor and payment records have been loaded.');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const doctor = snapshot.doctors.find((record) => String(record.id) === String(id));
  const dateError = (from && !validPaymentDate(from)) || (to && !validPaymentDate(to))
    ? 'Enter valid dates in YYYY-MM-DD format.'
    : from && to && from > to
      ? 'The From date must be on or before the To date.'
      : '';

  const result = useMemo(() => {
    if (snapshot.error || !doctor || dateError) return { rows: [], totals: null, error: '' };
    try {
      const rows = filterDemoPayments(snapshot.payments, doctor.id, from, to);
      return { rows, totals: demoPaymentTotals(rows), error: '' };
    } catch (cause) {
      return { rows: [], totals: null, error: cause?.message || 'Payment records could not be filtered. Refresh records and try again.' };
    }
  }, [snapshot, doctor?.id, from, to, dateError]);

  const error = snapshot.error || result.error;
  const doctorPayments = doctor && !error ? snapshot.payments.filter((payment) => String(payment.doctorId) === String(doctor.id)).length : 0;
  const columns = [
    { key: 'date', label: 'Date', render: (payment) => <time dateTime={payment.date} className="doctor-payments__date">{formatDate(payment.date)}</time> },
    { key: 'reference', label: 'Reference', render: (payment) => <span className="doctor-payments__reference"><strong>{display(payment.reference)}</strong><small>ID {payment.id}</small></span> },
    { key: 'mr', label: 'MR at recording', render: (payment) => <span className="doctor-payments__mr"><span>{payment.mrName ? payment.mrName : 'MR name not recorded'}</span><small>{payment.mrId ? `ID ${payment.mrId}` : 'No MR ID recorded'}</small></span> },
    { key: 'billed', label: 'Billed', render: (payment) => <span className="doctor-payments__amount">{formatMoney(payment.billedPaise)}</span> },
    { key: 'received', label: 'Received', render: (payment) => <span className="doctor-payments__amount">{formatMoney(payment.receivedPaise)}</span> },
    { key: 'outstanding', label: 'Outstanding', render: (payment) => <span className="doctor-payments__amount">{formatMoney(payment.billedPaise - payment.receivedPaise)}</span> },
    { key: 'status', label: 'Status', render: (payment) => <span className="doctor-payments__status">{display(payment.status)}</span> },
  ];

  return <AdminLayout title="Doctor payment history">
    <div className="doctor-payments">
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Masters / Doctor Master / Payments</p>
          <h1>Payment history</h1>
           <p className="admin-page-head__description">Review a doctor’s sample billing and receipts in this browser.</p>
        </div>
        <div className="doctor-payments__head-actions">
          <Link href={LIST_PATH} className="admin-button admin-button--secondary" data-testid="link-back-doctor-master"><ArrowLeft size={16} aria-hidden="true" /> Back to Doctor Master</Link>
          <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-doctor-payments"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
        </div>
      </div>

      {!error && !doctor ? <section className="admin-panel doctor-payments__recovery" role="alert" data-testid="status-doctor-payments-not-found">
        <h2>Doctor record not found</h2>
        <p>This doctor may have been removed, or the link may be incorrect. Refresh the records or return to Doctor Master.</p>
        <div className="doctor-payments__recovery-actions">
          <Link href={LIST_PATH} className="admin-button admin-button--secondary" data-testid="link-return-doctor-master">Return to Doctor Master</Link>
          <button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-doctor-payments">Refresh records</button>
        </div>
      </section> : error ? <section className="admin-panel doctor-payments__recovery" role="alert" data-testid="status-doctor-payments-error">
        <h2>Records could not be loaded</h2>
        <p>{error}</p>
        <div className="doctor-payments__recovery-actions">
          <button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-doctor-payments">Retry loading records</button>
          <Link href={LIST_PATH} className="admin-button admin-button--secondary" data-testid="link-return-doctor-master">Return to Doctor Master</Link>
        </div>
      </section> : <>
        <section className="admin-panel doctor-payments__context" aria-label="Doctor identity">
          <div>
            <p className="doctor-payments__context-label">Doctor record</p>
            <h2 data-testid="text-payment-doctor-name">{doctor.name}</h2>
            <p data-testid="text-payment-doctor-details">{[doctor.registrationNumber && `Reg. ${doctor.registrationNumber}`, doctor.qualification, doctor.clinicName].filter(Boolean).join(' · ') || `ID ${doctor.id}`}</p>
          </div>
          <span className="doctor-payments__context-note">MR names below are snapshots saved with each payment, not the doctor’s current assignment.</span>
        </section>
        <div className="admin-feedback doctor-payments__notice" role="note" data-testid="text-payments-demo-notice">Browser-local demo payment records only. These amounts are not actual revenue or verified financial data.</div>
        {updatedElsewhere && <div className="admin-feedback" role="status" data-testid="status-payments-updated">{updatedElsewhere}</div>}
        <section className="admin-panel" aria-label="Doctor payment records">
          <div className="doctor-payments__filters" role="group" aria-label="Filter payments by date">
            <div className="admin-filter"><label htmlFor="doctor-payments-from">From date</label><input id="doctor-payments-from" type="date" className="admin-select" value={from} onChange={(event) => setFrom(event.target.value)} data-testid="input-payments-from" /></div>
            <div className="admin-filter"><label htmlFor="doctor-payments-to">To date</label><input id="doctor-payments-to" type="date" className="admin-select" value={to} onChange={(event) => setTo(event.target.value)} data-testid="input-payments-to" /></div>
            {(from || to) && <button type="button" className="admin-button admin-button--secondary" onClick={() => { setFrom(''); setTo(''); }} data-testid="button-clear-payment-dates">Clear dates</button>}
            <p className="doctor-payments__filter-meta" data-testid="text-payment-filter-count">{dateError ? 'Correct the date range to see results' : `Showing ${result.rows.length} of ${doctorPayments} records · Dates inclusive`}</p>
          </div>
          {dateError ? <div className="admin-feedback admin-feedback--error doctor-payments__validation" role="alert" data-testid="status-payment-date-error">{dateError}</div> : <>
            <div className="doctor-payments__totals" aria-label="Totals for displayed payments">
               <div className="admin-panel doctor-payments__total"><span>Billed demo amount</span><strong data-testid="text-payment-total-billed">{formatMoney(result.totals.billed)}</strong></div>
               <div className="admin-panel doctor-payments__total"><span>Received demo amount</span><strong data-testid="text-payment-total-received">{formatMoney(result.totals.received)}</strong></div>
               <div className="admin-panel doctor-payments__total doctor-payments__total--outstanding"><span>Outstanding demo balance</span><strong data-testid="text-payment-total-outstanding">{formatMoney(result.totals.outstanding)}</strong></div>
            </div>
            {result.rows.length ? <>
              <div className="doctor-payments__table"><DataTable columns={columns} rows={result.rows} rowKey={(payment) => payment.id} label="Doctor payment records" testIdPrefix="doctor-payment" /></div>
              <div className="doctor-payments__card-list" role="list" aria-label="Doctor payment records">
                {result.rows.map((payment) => <article className="doctor-payments__card" role="listitem" key={payment.id} data-testid={`card-doctor-payment-${payment.id}`}>
                   <div className="doctor-payments__card-head"><div><strong>{display(payment.reference)}</strong><small><time dateTime={payment.date}>{formatDate(payment.date)}</time> · ID {payment.id}</small></div><span className="doctor-payments__status">{display(payment.status)}</span></div>
                  <dl>
                    <div><dt>Billed</dt><dd>{formatMoney(payment.billedPaise)}</dd></div>
                    <div><dt>Received</dt><dd>{formatMoney(payment.receivedPaise)}</dd></div>
                    <div><dt>Outstanding</dt><dd>{formatMoney(payment.billedPaise - payment.receivedPaise)}</dd></div>
                    <div><dt>MR at recording</dt><dd>{payment.mrName || 'MR name not recorded'}<br /><small>{payment.mrId ? `ID ${payment.mrId}` : 'No MR ID recorded'}</small></dd></div>
                  </dl>
                </article>)}
              </div>
            </> : <div className="admin-empty" data-testid="status-doctor-payments-empty"><span className="admin-empty__icon"><CreditCard size={21} aria-hidden="true" /></span><strong>{doctorPayments ? 'No payments in this date range' : 'No demo payments recorded'}</strong><p>{doctorPayments ? 'Try a wider date range or clear the date filters.' : 'This doctor has no browser-local demo payment records yet.'}</p>{doctorPayments > 0 && <button type="button" className="admin-button admin-button--secondary" style={{ marginTop: 16 }} onClick={() => { setFrom(''); setTo(''); }} data-testid="button-clear-empty-payment-dates">Clear dates</button>}</div>}
            <div className="admin-panel__foot">Totals reflect only the displayed records. All values are browser-local demo data, not actual revenue.</div>
          </>}
        </section>
      </>}
    </div>
  </AdminLayout>;
}