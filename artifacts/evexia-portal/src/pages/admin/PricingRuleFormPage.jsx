import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import PricingPolicyWorkspace from '../../components/admin/PricingPolicyWorkspace.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import { getSavedCombinationRule } from '../../services/serverCombinationPricing.js';
import '../../pricingRules.css';

export default function PricingRuleFormPage({ id }) {
  const session = useAdminSession();
  if (!isSuperAdminIdentity(session.user)) return <AdminLayout title="Pricing Rules"><p role="alert">Pricing Rules can only be configured by a Super Admin.</p></AdminLayout>;
  return <Entry key={session.user.id} id={id} />;
}
function Entry({ id }) {
  const [, navigate] = useLocation();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const ctl = new AbortController();
    setRecord(null); setError('');
    getSavedCombinationRule(id, ctl.signal).then((value) => { if (!ctl.signal.aborted) setRecord(value); })
      .catch((cause) => { if (!ctl.signal.aborted) setError(cause.message); });
    return () => ctl.abort();
  }, [id, retry]);
  return <AdminLayout title={id ? 'Edit Pricing Rule' : 'Add Pricing Rule'}><div className="pricing-rules-page">
    {id && !record ? <section className="admin-panel">
      <h1>Edit Pricing Rule</h1>
      {error ? <div role="alert"><p>{error}</p><button type="button" className="admin-button" onClick={() => setRetry((n) => n + 1)}>Retry rule</button></div>
        : <p role="status">Loading exact saved rule…</p>}
      <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/pricing-rules')}>Back to Pricing Rules</button>
    </section> : <PricingPolicyWorkspace record={record} />}
  </div></AdminLayout>;
}
