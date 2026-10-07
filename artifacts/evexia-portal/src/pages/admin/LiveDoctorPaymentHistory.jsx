import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { getDoctor } from '../../services/serverDoctors.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

export default function LiveDoctorPaymentHistory({ id }) {
  const [doctor, setDoctor] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setDoctor(null); setError(''); setLoading(true);
    getDoctor(id, controller.signal).then((record) => { guard(); if (!controller.signal.aborted) setDoctor(record); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  return <AdminLayout title="Doctor payment history">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Doctor Master / Payments</p><h1>Payment history</h1></div>
      <Link href="/admin/masters/doctors" className="admin-button admin-button--secondary" data-testid="link-back-doctor-master">Back to Doctor Master</Link></div>
    <section className="admin-panel" style={{ padding: 24 }}>
      {loading ? <p role="status">Loading doctor…</p> : error ? <><p role="alert">{error}</p><button className="admin-button" type="button" onClick={() => setRevision((n) => n + 1)}>Retry</button></> : <>
        <h2 data-testid="text-payment-doctor-name">{doctor.name}</h2><p>{doctor.registrationNumber} · {doctor.clinicName || 'No clinic specified'}</p>
        <p role="note" data-testid="text-payments-demo-notice">No live payment ledger is connected. Browser-local demonstration payments and opening balances are separate and are never matched to this server Doctor ID.</p>
        <p data-testid="status-doctor-payments-empty">No live payment history is available.</p>
      </>}
    </section>
  </AdminLayout>;
}
