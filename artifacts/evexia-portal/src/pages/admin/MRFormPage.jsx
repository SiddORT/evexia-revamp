import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MRForm from '../../components/admin/MRForm.jsx';
import useMRs from '../../hooks/useMRs.js';
import '../../mr.css';

const LIST_PATH = '/admin/masters/mrs';

export default function MRFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, zones, error, retry, add, edit } = useMRs();
  const [revision, setRevision] = useState(0);
  const mr = id ? records.find((record) => record.id === id) : null;
  const title = id ? 'Edit MR record' : 'Add MR record';

  function refresh() {
    // Remount the form from the freshly read snapshot; never save a stale draft.
    retry();
    setRevision((current) => current + 1);
  }

  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head">
      <div>
        <p className="admin-page-head__eyebrow">Masters / Team / MR Master</p>
        <h1>{title}</h1>
      </div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-mrs"><ArrowLeft size={16} aria-hidden="true" /> Back to MR Master</button>
    </div>
    {error || (id && !mr) ? <section className="admin-panel mr-form-page__recovery" role="alert">
      <h2>{error ? 'MR records could not be loaded' : 'MR record not found'}</h2>
      <p>{error || 'This MR may have been removed or the link may be incorrect. Refresh the latest records or return to MR Master.'}</p>
      <div className="mr-form__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-mrs">Return to MR Master</button>
        <button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-mr-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
      </div>
    </section> : <section className="admin-panel mr-form-page" aria-label={title}>
      <MRForm key={`${id || 'new'}-${revision}`} mr={mr} records={records} zones={zones} onSave={save} onClose={() => navigate(LIST_PATH)} onRefresh={refresh} />
    </section>}
  </AdminLayout>;
}