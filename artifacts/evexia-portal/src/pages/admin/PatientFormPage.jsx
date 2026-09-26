import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import PatientForm from '../../components/admin/PatientForm.jsx';
import usePatients from '../../hooks/usePatients.js';
import '../../mr.css';

const LIST = '/admin/masters/patients';
export default function PatientFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, doctors, error, retry, add, edit } = usePatients();
  const [loaded, setLoaded] = useState(() => !error);
  const [revision, setRevision] = useState(0);
  const patient = id ? records.find((record) => record.id === id) : null;
  const title = id ? 'Edit Patient record' : 'Add Patient record';
  function refresh() {
    const result = retry();
    if (result.success) { setLoaded(true); setRevision((value) => value + 1); }
  }
  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) navigate(`${LIST}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Patients / Patient Master</p><h1>{title}</h1><p className="admin-page-head__description">Browser-local preview only. Do not enter real patient or health information.</p></div><button className="admin-button admin-button--secondary" type="button" onClick={() => navigate(LIST)}><ArrowLeft size={16} /> Back to Patient Master</button></div>
    {(error && !loaded) || (id && !patient) ? <section className="admin-panel mr-form-page__recovery" role="alert">
      <h2>{error ? 'Patient records could not be loaded' : 'Patient record not found'}</h2><p>{error || 'Refresh records or return to Patient Master.'}</p><div className="mr-form__actions"><button className="admin-button admin-button--secondary" type="button" onClick={() => navigate(LIST)}>Return to Patient Master</button><button className="admin-button" type="button" onClick={refresh}><RefreshCw size={16} /> Refresh records</button></div>
    </section> : <section className="admin-panel mr-form-page" aria-label={title}>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error} Saving is blocked. Refreshing will discard changes on this page.</div>}
      <PatientForm key={`${id || 'new'}-${revision}`} patient={patient} doctors={doctors} blocked={Boolean(error)} onSave={save} onClose={() => navigate(LIST)} onRefresh={refresh} />
    </section>}
  </AdminLayout>;
}