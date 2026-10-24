import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import AdminLayout from '../components/admin/AdminLayout.jsx';
import { MASTER_CATALOGUE, hasMasterPermission, isStaffIdentity } from './capabilities.js';
import * as api from './adminSession.js';

const REQUESTS = {
  headquarter: api.headquarterRequest, zone: api.zoneRequest, mr: api.mrRequest,
  patient: api.patientRequest, doctor: api.doctorRequest, product_category: api.productCategoryRequest,
  location: api.locationRequest, courier: api.courierRequest, language: api.languageRequest,
  designation: api.designationRequest, allergen: api.allergenRequest, product: api.productMasterRequest,
  vendor: api.vendorRequest, sales_target: api.salesTargetRequest, opening_balance: api.openingBalanceRequest,
  opening_stock: api.openingStockRequest,
};
const caption = (key) => key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
function Value({ value }) {
  if (value == null || value === '') return <>—</>;
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value !== 'object') return <>{String(value)}</>;
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul>;
  return <dl className="inv-detail-grid">{Object.entries(value).map(([key, item]) =>
    <div key={key}><dt>{caption(key)}</dt><dd><Value value={item} /></dd></div>)}</dl>;
}
function ReadOnlyMaster({ master, id }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, record: null, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, record: null, error: '' });
    REQUESTS[master.key](`/${id}`, { signal: controller.signal })
      .then((record) => { if (!controller.signal.aborted) setState({ loading: false, record, error: '' }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ loading: false, record: null, error: error.message }); });
    return () => controller.abort();
  }, [master.key, id, attempt]);
  return <AdminLayout title={`${master.label} details`}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Read-only details</p><h1>{master.label}</h1><p className="admin-page-head__description">Your role can read this record, but cannot edit it.</p></div><Link href={master.key === 'language' ? '/admin/languages' : `/admin/masters/${master.path}`} className="admin-button admin-button--secondary">Back to list</Link></div>
    <section className="admin-card" aria-busy={state.loading}>{state.loading ? <p role="status">Loading record…</p> : state.error
      ? <div role="alert"><p>{state.error}</p><button className="admin-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>
      : <Value value={state.record} />}</section>
  </AdminLayout>;
}

export default function MasterRecordAccess({ path, user, children }) {
  const match = /^\/admin\/masters\/([^/]+)\/([0-9a-f-]{36})$/i.exec(path);
  const master = match && MASTER_CATALOGUE.find((item) => item.path === match[1]);
  // Decide only on entry. A later revocation must not replace a mounted editor
  // with another component and discard its recoverable in-memory draft.
  const [readOnly] = useState(() => isStaffIdentity(user) && master && REQUESTS[master.key]
    && !hasMasterPermission(user, master.key, 'edit'));
  if (readOnly) return <ReadOnlyMaster master={master} id={match[2]} />;
  if (!master || !match) return children;
  const mutationRevoked = isStaffIdentity(user) && !hasMasterPermission(user, master.key, 'edit');
  return <>{mutationRevoked && <p role="alert" className="admin-feedback">Edit access changed. Your mounted draft is preserved and its controls are disabled. Return to the list only when you are ready to leave this draft.</p>}
    <fieldset disabled={mutationRevoked} style={{ display: 'contents' }}>{children}</fieldset></>;
}
