import { Link } from 'wouter';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import usePatients from '../../hooks/usePatients.js';
import '../../patient.css';

export default function PatientDosageHistory({ id }) {
  const { records, loading, error, retry } = usePatients({}, id);
  const patient = records[0];
  return <AdminLayout title="Patient dosage history"><main className="patient-dosage">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Patient Master / Dosage history</p><h1>Dosage history</h1><p className="admin-page-head__description">Live Patient reference. No treatment, order or appointment records are available.</p></div>
      <Link href="/admin/masters/patients" className="admin-button admin-button--secondary"><ArrowLeft size={16} /> Back to Patient Master</Link></div>
    {loading ? <p role="status">Loading Patient…</p> : error ? <section className="admin-panel patient-dosage__recovery" role="alert"><h2>Patient could not be loaded</h2><p>{error}</p><button type="button" className="admin-button" onClick={retry}>Retry loading Patient</button></section> : patient ? <>
      <section className="admin-panel patient-dosage__context" aria-label="Patient references"><div className="patient-dosage__reference-grid">
        {[['Patient', `${patient.name} · ${patient.code}`], ['Doctor', patient.doctorName || 'Missing Doctor'], ['MR', patient.mrName || 'Missing MR'], ['Zone', patient.zoneName || 'Missing Zone']].map(([label, value]) => <div className="patient-dosage__reference" key={label}><span className="patient-dosage__reference-label">{label}</span><strong>{value}</strong></div>)}
      </div></section>
      <section className="admin-panel patient-dosage__no-history" data-testid="status-patient-dosage-empty"><CalendarDays size={24} /><div><h2>No dosage history recorded</h2><p>Last Dose: Not recorded. This master does not create treatment history and never matches live Patients to local sample doses.</p></div></section>
    </> : <p role="alert">Patient record not found.</p>}
  </main></AdminLayout>;
}
