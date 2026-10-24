import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import { staffRequest } from '../../auth/adminSession.js';

export default function StaffAccessDirectory() {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, items: [], total: null, error: '' });
  // Do not render the previous request's rows or totals before the effect runs.
  const currentRequest = state.offset === offset && state.attempt === attempt;
  const loading = !currentRequest || state.loading;
  const loaded = currentRequest && !state.loading && !state.error;
  useEffect(() => {
    const controller = new AbortController();
    setState({ offset, attempt, loading: true, items: [], total: null, error: '' });
    staffRequest(`/access-directory?offset=${offset}&limit=25`, undefined, { signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) setState({ ...page, offset, attempt, loading: false, error: '' }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ offset, attempt, loading: false, items: [], total: null, error: error.message }); });
    return () => controller.abort();
  }, [offset, attempt]);
  return <AdminLayout title="Staff Access">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">User Management</p><h1>Staff Access</h1><p className="admin-page-head__description">Read saved role assignments and workspace login status. Assign Role and Enable / Disable Login are Super Admin-only; this page cannot change them.</p></div></div>
    <section className="admin-card" aria-busy={loading}>
      <div className="admin-toolbar"><button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>Refresh access</button></div>
      {loading ? <p role="status" className="admin-empty">Loading staff access…</p> : state.error
        ? <p role="alert" className="admin-empty">{state.error}</p>
        : <DataTable rows={state.items} label="Staff access records" rowKey={(row) => row.id} columns={[
          { key: 'name', label: 'Staff', render: (row) => <strong>{row.name}</strong> },
          { key: 'code', label: 'Employee Code', render: (row) => row.employeeCode || 'Needs correction' },
          { key: 'role', label: 'Saved role', render: (row) => row.role },
          { key: 'status', label: 'Staff status', render: (row) => row.status },
          { key: 'login', label: 'Workspace login', render: (row) => row.workspace_login_enabled ? 'Enabled' : 'Disabled' },
        ]} />}
      <div className="admin-toolbar"><button type="button" className="admin-button admin-button--secondary" disabled={!loaded || !offset} onClick={() => setOffset((value) => Math.max(0, value - 25))}>Previous</button><span role="status">{loaded ? (state.total === 0 ? 'No staff access records'
        : state.items.length ? `${offset + 1}–${offset + state.items.length} of ${state.total}`
          : `No staff access records on this page (${state.total} total). Use Previous to return to earlier records.`) : null}</span><button type="button" className="admin-button admin-button--secondary" disabled={!loaded || offset + 25 >= state.total} onClick={() => setOffset((value) => value + 25)}>Next</button></div>
    </section>
  </AdminLayout>;
}
