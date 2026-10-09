import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MRForm from '../../components/admin/MRForm.jsx';
import CredentialReveal from '../../components/admin/CredentialReveal.jsx';
import { createMR, editMR, getMR, resolveMRAccount } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';

const LIST_PATH = '/admin/masters/mrs';

export default function MRFormPage({ id }) {
  const [, navigate] = useLocation();
  const [mr, setMr] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [credentials, setCredentials] = useState(null);
  const [writeBlocked, setWriteBlocked] = useState(null);
  const [recovery, setRecovery] = useState('');
  const mounted = useRef(true);
  const busy = useRef(false);
  const title = id ? 'Edit MR record' : 'Add MR record';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { if (getSession().user?.id !== owner) { setMr(null); setCredentials(null); } });
  }, []);
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    setLoading(true); setError('');
    getMR(id, controller.signal)
      .then((record) => { if (!controller.signal.aborted) setMr(record); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.status === 404 ? '' : cause.message || 'The MR could not be loaded.'); setMr(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);

  const refresh = useCallback(async () => {
    if (!writeBlocked) { setRevision((n) => n + 1); return; }
    if (busy.current) return;
    busy.current = true;
    try {
      let record;
      try { record = id ? await getMR(id) : await resolveMRAccount(writeBlocked.username); }
      catch (cause) { if (cause.status !== 404 || id) throw cause; }
      if (!mounted.current) return;
      if (record && !id) {
        setRecovery('The account was created. Its initial password cannot be recovered. Open the saved record, then use Reset password in MR Master.');
        setWriteBlocked((current) => ({ ...current, record }));
      } else {
        setWriteBlocked(null); setRecovery(id ? 'Latest saved version loaded. Review it before saving again.' : 'No saved account was found. You may explicitly submit again.');
        setRevision((n) => n + 1);
      }
    } catch (cause) { if (mounted.current) setRecovery(`Reconciliation failed. No write was retried. ${cause.message}`); }
    finally { busy.current = false; }
  }, [writeBlocked, id]);
  async function save(values, password) {
    if (busy.current) return { success: false, error: 'A save is already pending.' };
    if (writeBlocked) return { success: false, error: 'Before another save, check the authoritative result using Reconcile saved records below.' };
    busy.current = true;
    try {
      if (id) {
        await editMR(mr, values);
        if (!mounted.current) return { success: true };
        navigate(`${LIST_PATH}?saved=updated`);
      } else {
        const result = await createMR(values, password);
        if (!mounted.current) return { success: true };
        // Credentials stay in memory only; the draft is consumed.
        setCredentials([result.credentials]);
      }
      return { success: true };
    } catch (cause) {
      // These typed assignment rejections occur before mutation and roll back.
      // A corrected selection can retry with the same expected version; stale
      // versions and uncertain outcomes still require explicit reconciliation.
      const rejectedAssignment = cause.status === 409 && ['mr_assignment', 'mr_manager_cycle'].includes(cause.code);
      if (mounted.current && !rejectedAssignment && (cause.ambiguous || cause.status === 409)) setWriteBlocked({ username: values.userId });
      return { success: false, error: `${cause.message}${cause.ambiguous ? ' Check MR Master before submitting again.' : ''}` };
    } finally { busy.current = false; }
  }

  const missing = id && !loading && !mr;
  return <AdminLayout title={title}>
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Team / MR Master</p><h1>{title}</h1></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-mrs"><ArrowLeft size={16} aria-hidden="true" /> Back to MR Master</button>
    </div>
    {(writeBlocked || recovery) && <section className="admin-panel" role="status">
      <p>{recovery || 'The save result is uncertain or conflicts with current records. No write will be replayed. Reconcile before retrying.'}</p>
      <button type="button" className="admin-button" onClick={refresh} data-testid="button-reconcile-mr">Reconcile saved records</button>
      {writeBlocked?.record && <button type="button" className="admin-button" onClick={() => navigate(`${LIST_PATH}/${writeBlocked.record.id}`)}>Open saved MR record</button>}
    </section>}
    {loading ? <p className="admin-empty" role="status">Loading MR…</p> : error || missing ? <section className="admin-panel mr-form-page__recovery" role="alert">
      <h2>{error ? 'MR could not be loaded' : 'MR record not found'}</h2>
      <p>{error || 'This MR may have been deleted or the link may be incorrect.'}</p>
      <div className="mr-form__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-mrs">Return to MR Master</button>
        <button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-mr-form"><RefreshCw size={16} aria-hidden="true" /> Try again</button>
      </div>
    </section> : <section className="admin-panel mr-form-page" aria-label={title}>
      {!credentials && <MRForm key={`${id || 'new'}-${revision}`} mr={mr} onSave={save} onClose={() => navigate(LIST_PATH)} onRefresh={refresh} />}
    </section>}
    {credentials && <CredentialReveal credentials={credentials} title="MR created. Copy the login credentials" onClose={() => { setCredentials(null); navigate(`${LIST_PATH}?saved=added`); }} />}
  </AdminLayout>;
}
