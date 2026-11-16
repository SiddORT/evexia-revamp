import { useEffect, useState } from 'react';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

/** Current directory policy, not the immutable person snapshot on an old order. */
export default function EffectiveDoctorDays({ doctorId, request }) {
  const [result, setResult] = useState(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!doctorId) return undefined;
    const controller = new AbortController(), guard = reportingIdentityGuard();
    setResult(null);
    request('/references/doctors', { params: { selected: doctorId, limit: 1 }, signal: controller.signal })
      .then((data) => {
        guard();
        const doctor = data?.items?.find((item) => item.id === doctorId);
        if (!doctor || !Number.isInteger(doctor.doctorDaysLimit)) throw new Error('The current assigned MR setting is unavailable.');
        if (!controller.signal.aborted) setResult({ doctorId, days: doctor.doctorDaysLimit });
      }).catch((error) => { if (!controller.signal.aborted) setResult({ doctorId, error: error.message }); });
    return () => controller.abort();
  }, [doctorId, request, revision]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision((n) => n + 1); };
    const timer = window.setInterval(refresh, 45000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const current = result?.doctorId === doctorId ? result : null;
  return <div className="mrw-notice" aria-live="polite">
    {!doctorId ? <p>Choose a Doctor to see the inherited Doctor Days Limit.</p> : !current ? <p>Loading the current inherited Doctor Days Limit…</p>
      : current.error ? <p role="alert">{current.error} No unrestricted value is assumed.</p>
        : <p>Effective Doctor Days Limit: <strong>{current.days} days</strong>{current.days === 0 ? ' · disabled' : ' · prior positive unpaid balances block a new order when this age is reached'}. Inherited from the Doctor’s currently assigned MR, not an independently editable Doctor value.</p>}
    {doctorId && <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)}>Refresh Doctor limit</button>}
  </div>;
}
