import { Link } from 'wouter';
import { ArrowLeft, CalendarDays, Clock3, History, RefreshCw, UserRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import usePatients from '../../hooks/usePatients.js';
import { getSampleDosageHistory } from '../../services/patientDosageHistory.js';
import '../../patient.css';

const LIST_PATH = '/admin/masters/patients';
function formatDate(value) {
  return formatAdminDate(value) === '—' ? 'Date not available' : formatAdminDate(value);
}

function Reference({ label, name, detail, missing, testId }) {
  return <div className="patient-dosage__reference">
    <span className="patient-dosage__reference-label">{label}</span>
    <strong data-testid={testId}>{name}</strong>
    <span className={missing ? 'patient-dosage__reference-detail patient-dosage__reference-detail--missing' : 'patient-dosage__reference-detail'}>{detail}</span>
  </div>;
}

function DoseList({ title, items, kind }) {
  return <section className="admin-panel patient-dosage__list" aria-label={title}>
    <div className="patient-dosage__list-head">
      <span className="patient-dosage__list-icon" aria-hidden="true">{kind === 'previous' ? <History size={18} /> : <CalendarDays size={18} />}</span>
      <div>
        <h2>{title}</h2>
        <p>{kind === 'previous' ? 'Illustrative past dates, not recorded administrations.' : 'Illustrative future dates, not confirmed appointments.'}</p>
      </div>
      <span className="patient-dosage__count">{items.length} example{items.length === 1 ? '' : 's'}</span>
    </div>
    {items.length ? <ol className="patient-dosage__entries" data-testid={`list-${kind}-sample-doses`}>
      {items.map((item, index) => <li className="patient-dosage__entry" key={`${item.date}-${item.name}-${index}`} data-testid={`item-${kind}-sample-dose-${index}`}>
        <span className="patient-dosage__entry-marker" aria-hidden="true" />
        <div className="patient-dosage__entry-copy">
          <strong data-testid={`text-${kind}-sample-name-${index}`}>{item.name}</strong>
          <span>Example dosage</span>
        </div>
        <time dateTime={item.date} data-testid={`text-${kind}-sample-date-${index}`}>{formatDate(item.date)}</time>
      </li>)}
    </ol> : <p className="patient-dosage__list-empty" data-testid={`status-${kind}-sample-doses-empty`}>No {kind} example doses to display.</p>}
  </section>;
}

export default function PatientDosageHistory({ id }) {
  useAdminPreferences();
  const { records, doctors, mrs, error, retry } = usePatients();
  const patient = !error ? records.find((item) => String(item.id) === String(id)) : null;
  const doctor = patient ? doctors.find((item) => String(item.id) === String(patient.doctorId)) : null;
  const mr = doctor ? mrs.find((item) => String(item.id) === String(doctor.mrId)) : null;
  const sample = patient ? getSampleDosageHistory(patient) : null;

  return <AdminLayout title="Patient dosage history">
    <main className="patient-dosage">
      <div className="admin-page-head patient-dosage__head">
        <div>
          <p className="admin-page-head__eyebrow">Masters / Patient Master / Dosage history</p>
          <h1>Dosage history</h1>
          <p className="admin-page-head__description">A read-only view of the patient reference and available example dates.</p>
        </div>
        <Link href={LIST_PATH} className="admin-button admin-button--secondary" data-testid="link-back-patient-master"><ArrowLeft size={16} aria-hidden="true" /> Back to Patient Master</Link>
      </div>

      {error ? <section className="admin-panel patient-dosage__recovery" role="alert" data-testid="status-patient-dosage-error">
        <span className="patient-dosage__recovery-icon"><RefreshCw size={22} aria-hidden="true" /></span>
        <h2>Records could not be loaded</h2>
        <p>{error}</p>
        <div className="patient-dosage__recovery-actions">
          <button className="admin-button" type="button" onClick={retry} data-testid="button-retry-patient-dosage">Retry loading records</button>
          <Link href={LIST_PATH} className="admin-button admin-button--secondary" data-testid="link-cancel-patient-dosage-error">Cancel</Link>
        </div>
      </section> : !patient ? <section className="admin-panel patient-dosage__recovery" role="alert" data-testid="status-patient-dosage-not-found">
        <span className="patient-dosage__recovery-icon"><UserRound size={22} aria-hidden="true" /></span>
        <h2>Patient record not found</h2>
        <p>This patient may have been removed, or the link may be incorrect. Return to Patient Master to choose a patient.</p>
        <div className="patient-dosage__recovery-actions">
          <Link href={LIST_PATH} className="admin-button" data-testid="link-return-patient-master">Return to Patient Master</Link>
          <button className="admin-button admin-button--secondary" type="button" onClick={retry} data-testid="button-refresh-patient-dosage">Refresh records</button>
        </div>
      </section> : <>
        <div className="patient-dosage__notice" role="note" data-testid="text-patient-dosage-notice">
          <span className="patient-dosage__notice-mark" aria-hidden="true">i</span>
          <div><strong>{sample ? 'Sample illustration only' : 'No recorded dosage data'}</strong><p>{sample ? 'These dates and names are browser-local examples. “Last” is illustrative, not an actual treatment or administration record. No appointments or orders are implied.' : 'This preview does not store a treatment or administration record. The references below come from Patient Master.'}</p></div>
        </div>

        <section className="admin-panel patient-dosage__context" aria-label="Patient, doctor and MR references" data-testid="panel-patient-dosage-references">
          <div className="patient-dosage__context-title"><span>Record references</span><span>Current master details</span></div>
          <div className="patient-dosage__reference-grid">
            <Reference label="Patient" name={patient.name || 'Name not available'} detail={`ID ${patient.id}`} testId="text-dosage-patient-name" />
            <Reference label="Doctor" name={doctor?.name || 'Doctor reference unavailable'} detail={doctor ? [doctor.registrationNumber && `Reg. ${doctor.registrationNumber}`, doctor.phone].filter(Boolean).join(' · ') || `ID ${doctor.id}` : patient.doctorId ? `Assigned ID ${patient.doctorId} could not be found` : 'No doctor assigned'} missing={!doctor} testId="text-dosage-doctor-name" />
            <Reference label="MR" name={mr?.name || 'MR reference unavailable'} detail={mr ? (mr.phone || `ID ${mr.id}`) : !doctor ? 'Doctor reference unavailable' : doctor.mrId ? `Assigned ID ${doctor.mrId} could not be found` : 'No MR assigned to doctor'} missing={!mr} testId="text-dosage-mr-name" />
          </div>
        </section>

        <section className="patient-dosage__overview" aria-labelledby="patient-dosage-upcoming">
          <div className="patient-dosage__section-heading">
            <div><p className="patient-dosage__eyebrow">Illustrative schedule</p><h2 id="patient-dosage-upcoming">Upcoming dosage</h2></div>
            <span className="patient-dosage__section-aside">Reference only / read-only</span>
          </div>
          {sample ? <>
            <div className="patient-dosage__spotlights">
              <article className="admin-panel patient-dosage__spotlight patient-dosage__spotlight--next" data-testid="card-next-sample-dose">
                <div className="patient-dosage__spotlight-top"><span className="patient-dosage__spotlight-icon"><CalendarDays size={19} aria-hidden="true" /></span><span>Next example</span></div>
                {sample.next ? <><strong data-testid="text-next-sample-dose">{sample.next.name}</strong><time dateTime={sample.next.date} data-testid="text-next-sample-date">{formatDate(sample.next.date)}</time></> : <p data-testid="status-next-sample-dose-empty">No upcoming example dose.</p>}
              </article>
              <article className="admin-panel patient-dosage__spotlight" data-testid="card-last-sample-dose">
                <div className="patient-dosage__spotlight-top"><span className="patient-dosage__spotlight-icon"><Clock3 size={19} aria-hidden="true" /></span><span>Last example · not an actual record</span></div>
                {sample.last ? <><strong data-testid="text-last-sample-dose">{sample.last.name}</strong><time dateTime={sample.last.date} data-testid="text-last-sample-date">{formatDate(sample.last.date)}</time></> : <p data-testid="status-last-sample-dose-empty">No previous example dose.</p>}
              </article>
            </div>
            <div className="patient-dosage__lists">
              <DoseList title="Previous examples" items={sample.previous || []} kind="previous" />
              <DoseList title="Upcoming examples" items={sample.upcoming || []} kind="upcoming" />
            </div>
          </> : <section className="admin-panel patient-dosage__no-history" data-testid="status-patient-dosage-empty">
            <span className="patient-dosage__no-history-icon"><CalendarDays size={24} aria-hidden="true" /></span>
            <div><h3>No dosage history recorded</h3><p>There are no example doses for this patient. This preview does not create or save dosage history.</p></div>
          </section>}
        </section>
        <div className="patient-dosage__footer"><span>EVEXIA / Patient Master / Browser-local preview</span><Link href={LIST_PATH} className="admin-button admin-button--secondary" data-testid="link-cancel-patient-dosage">Cancel</Link></div>
      </>}
    </main>
  </AdminLayout>;
}