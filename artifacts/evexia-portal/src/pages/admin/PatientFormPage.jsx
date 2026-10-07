import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import PatientForm from '../../components/admin/PatientForm.jsx';
import usePatients from '../../hooks/usePatients.js';
import '../../mr.css';

const LIST = '/admin/masters/patients';
export default function PatientFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, error, loading, retry, add, edit, sessionEpoch } = usePatients({}, id || null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshing = useRef(false);
  useEffect(() => {
    if (!loading && !error) {
      setLoaded(true);
      if (refreshing.current) { refreshing.current = false; setRevision((n) => n + 1); }
    }
  }, [loading, error]);
  const patient = id ? records.find((record) => record.id === id) : null;
  const title = id ? 'Edit Patient record' : 'Add Patient record';
  function refresh() {
    if (loaded && !window.confirm('Discard this draft and load the latest saved Patient?')) return;
    refreshing.current = true;
    retry();
  }
  async function save(values) {
    const result = await (id ? edit(id, values) : add(values));
    if (result.success) navigate(`${LIST}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Patients / Patient Master</p><h1>{title}</h1><p className="admin-page-head__description">Protected shared Patient records.</p></div><button className="admin-button admin-button--secondary" type="button" onClick={() => navigate(LIST)}><ArrowLeft size={16} /> Back to Patient Master</button></div>
    {loading && !loaded ? <p className="admin-empty" role="status">Loading Patient form…</p> : (error && !loaded) || (id && !patient) ? <section className="admin-panel mr-form-page__recovery" role="alert">
      <h2>{error ? 'Patient records could not be loaded' : 'Patient record not found'}</h2><p>{error || 'Refresh records or return to Patient Master.'}</p><div className="mr-form__actions"><button className="admin-button admin-button--secondary" type="button" onClick={() => navigate(LIST)}>Return to Patient Master</button><button className="admin-button" type="button" onClick={refresh}><RefreshCw size={16} /> Refresh records</button></div>
    </section> : <section className="admin-panel mr-form-page" aria-label={title}>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error} Saving is blocked. Refreshing will discard changes on this page.</div>}
      <PatientForm key={`${id || 'new'}-${revision}-${sessionEpoch}`} patient={patient} blocked={Boolean(error) || loading} onSave={save} onClose={() => navigate(LIST)} onRefresh={refresh} />
    </section>}
  </AdminLayout>;
}