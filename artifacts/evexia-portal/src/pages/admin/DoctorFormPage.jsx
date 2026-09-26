import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DoctorForm from '../../components/admin/DoctorForm.jsx';
import useDoctors from '../../hooks/useDoctors.js';
import '../../doctor-form.css';

const LIST_PATH = '/admin/masters/doctors';

export default function DoctorFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, mrs, error, retry, add, edit } = useDoctors();
  const [hasLoaded, setHasLoaded] = useState(() => !error);
  const [revision, setRevision] = useState(0);
  const doctor = id ? records.find((record) => String(record.id) === String(id)) : null;
  const title = id ? 'Edit Doctor record' : 'Add Doctor record';

  function refresh() {
    const result = retry();
    if (result.success) {
      setHasLoaded(true);
      setRevision((current) => current + 1);
    }
  }

  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head">
      <div>
        <p className="admin-page-head__eyebrow">Masters / Team / Doctor Master</p>
        <h1>{title}</h1>
        <p className="admin-page-head__description">{id ? 'Update the doctor profile, clinic and commercial details.' : 'Create a browser-local preview record for a doctor. This does not create a login account.'}</p>
      </div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-doctors"><ArrowLeft size={16} aria-hidden="true" /> Back to Doctor Master</button>
    </div>
    {(error && !hasLoaded) || (id && !doctor) ? <section className="admin-panel doctor-form-page__recovery" role="alert">
      <h2>{error ? 'Doctor records could not be loaded' : 'Doctor record not found'}</h2>
      <p>{error || 'This doctor may have been removed or the link may be incorrect. Refresh the latest records or return to Doctor Master.'}</p>
      <div className="doctor-form__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-doctors">Return to Doctor Master</button>
        <button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-doctor-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
      </div>
    </section> : <section className="admin-panel doctor-form-page" aria-label={title}>
      {error && <div className="doctor-form__notice doctor-form__notice--error doctor-form__stale" role="alert" data-testid="error-doctor-stale">
        <p>{error} Your draft is still here, but saving is blocked. Refreshing discards changes on this page.</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-stale-doctor">Discard draft and refresh records</button>
      </div>}
      <DoctorForm key={`${id || 'new'}-${revision}`} doctor={doctor} records={records} mrs={mrs} blocked={Boolean(error)} onSave={save} onClose={() => navigate(LIST_PATH)} onRefresh={refresh} />
    </section>}
  </AdminLayout>;
}