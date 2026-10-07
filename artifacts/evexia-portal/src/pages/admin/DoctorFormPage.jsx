import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DoctorForm from '../../components/admin/DoctorForm.jsx';
import useDoctors from '../../hooks/useDoctors.js';
import '../../doctor-form.css';

const LIST_PATH = '/admin/masters/doctors';

export default function DoctorFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, mrs, error, loading, retry, add, edit } = useDoctors({}, id || null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshing = useRef(false);
  useEffect(() => {
    if (!loading && !error) {
      setHasLoaded(true);
      if (refreshing.current) { refreshing.current = false; setRevision((n) => n + 1); }
    }
  }, [loading, error]);
  const doctor = id ? records.find((record) => String(record.id) === String(id)) : null;
  const title = id ? 'Edit Doctor record' : 'Add Doctor record';

  function refresh() {
    if (hasLoaded && !window.confirm('Reload the current saved record and discard changes in this form?')) return;
    refreshing.current = true;
    retry();
  }

  async function save(values) {
    const result = await (id ? edit(id, values) : add(values));
    if (result.success) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head">
      <div>
        <p className="admin-page-head__eyebrow">Masters / Team / Doctor Master</p>
        <h1>{title}</h1>
      </div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-doctors"><ArrowLeft size={16} aria-hidden="true" /> Back to Doctor Master</button>
    </div>
    {loading && !hasLoaded ? <p className="admin-empty" role="status">Loading Doctor form…</p> : (error && !hasLoaded) || (id && !doctor) ? <section className="admin-panel doctor-form-page__recovery" role="alert">
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
      <DoctorForm key={`${id || 'new'}-${revision}`} doctor={doctor} records={records} mrs={mrs} blocked={Boolean(error) || loading} onSave={save} onClose={() => navigate(LIST_PATH)} onRefresh={refresh} />
    </section>}
  </AdminLayout>;
}