import { useCallback, useEffect, useRef, useState } from 'react';
import { CirclePower, Hash, Pencil, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import AllergenSearchableSelect from '../../components/admin/AllergenSearchableSelect.jsx';
import { formatAdminTimestamp } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { createHsn, editHsn, listHsn, normalGst, statusHsn, validateHsn } from '../../services/serverHsn.js';
import '../../mr.css';
import '../../allergen.css';

const audit = (name, value) => <span className="admin-allergen-audit"><strong>{name || '—'}</strong><time dateTime={value}>{formatAdminTimestamp(value, undefined, true)}</time></span>;
const isBlocking = (cause) => /stale|conflict|version/.test(cause?.code || '') || cause?.status === 409 || Boolean(cause?.ambiguous) || cause?.code === 'not_found';
function explain(cause) {
  const msg = cause?.message || 'The request failed.';
  if (cause?.ambiguous) return `${msg} The save outcome is unknown and was not retried. Refresh the list and check before trying again.`;
  if (cause?.code === 'not_found') return `${msg} This mapping no longer exists. Close and refresh the list.`;
  if (/stale|version/.test(cause?.code || '')) return `${msg} Someone changed this mapping. Close, refresh and review before saving again.`;
  if (/conflict|duplicate|collision/.test(cause?.code || '') || cause?.status === 409) return `${msg} The code or GST rate is already mapped. Each code and each GST rate may appear only once.`;
  if (!cause?.status || cause.status >= 500) return `${msg} The HSN service is unavailable. Your draft is retained.`;
  return msg;
}

export default function HsnMaster() {
  const { user } = useAdminSession();
  const can = useResourceActions('hsn');
  if (!can.read) return <AccessDenied title="HSN Master" heading="HSN Master is not available" testId="status-hsn-denied" message="Your saved role does not allow HSN Master." />;
  return <HsnWorkspace key={user.id} />;
}

function HsnWorkspace() {
  const can = useResourceActions('hsn');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState({ items: [], total: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const retry = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true);
    const timer = setTimeout(() => {
      listHsn({ query: search.trim(), status, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
        .then((r) => { guard(); setData(r); setError(''); })
        .catch((cause) => { if (controller.signal.aborted) return; try { guard(); } catch { return; } setError(explain(cause)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, status, page, pageSize, revision]);
  const pageCount = Math.max(1, Math.ceil((data.filtered || 0) / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  const hasFilters = Boolean(search || status !== 'all');

  async function confirmAction() {
    if (pending || blocked || !can.edit) return;
    const { record, type } = confirming;
    const guard = reportingIdentityGuard();
    setPending(true);
    try {
      await statusHsn(record, type === 'activate' ? 'active' : 'inactive'); guard();
      setConfirming(null); setFeedback(`HSN ${record.code} ${type === 'activate' ? 'activated' : 'inactivated'}.`); retry();
    } catch (cause) {
      try { guard(); } catch { return; }
      setActionError(explain(cause)); setBlocked(isBlocking(cause));
    } finally { setPending(false); }
  }
  function actions(r, mobile = false) {
    const toggle = r.status === 'active' ? 'Inactivate' : 'Activate';
    const cls = mobile ? 'admin-zone-card__action' : 'admin-icon-button';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" disabled={!can.edit} className={cls} aria-label={`Edit HSN ${r.code}`} onClick={() => { setFeedback(''); setEditing(r); }} data-testid={`button-edit-hsn-${r.id}`}><Pencil size={16} aria-hidden="true" />{mobile && 'Edit'}</button>
      <button type="button" disabled={!can.edit} className={cls} aria-label={`${toggle} HSN ${r.code}`} onClick={() => { setFeedback(''); setActionError(''); setBlocked(false); setConfirming({ record: r, type: toggle.toLowerCase() }); }} data-testid={`button-status-hsn-${r.id}`}><CirclePower size={16} aria-hidden="true" />{mobile && toggle}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_r, i) => i + 1 },
    { key: 'code', label: 'HSN code', render: (r) => <strong className="admin-allergen-number" data-testid={`text-hsn-code-${r.id}`}>{r.code}</strong> },
    { key: 'gst', label: 'GST (%)', render: (r) => <span className="admin-allergen-number">{r.gst}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} kind="hsn" /> },
    { key: 'created', label: 'Created details', render: (r) => audit(r.createdBy, r.createdAt) },
    { key: 'updated', label: 'Updated details', render: (r) => audit(r.updatedBy, r.updatedAt) },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  const actionName = confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="HSN Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Products & Supply</p><h1>HSN Master</h1><p className="admin-page-head__description">One HSN code per GST rate. Active mappings are offered on allergen products.</p></div>
      <div className="admin-mr-head-actions"><button type="button" disabled={!can.add} className="admin-button" onClick={() => { setFeedback(''); setEditing('new'); }} data-testid="button-add-hsn"><Plus size={16} aria-hidden="true" /> Add HSN mapping</button></div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-hsn-feedback">{feedback}</div>}
    <section className="admin-panel admin-allergen-panel" aria-label="HSN list">
      <div className="admin-toolbar master-filter-toolbar">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry} data-testid="button-refresh-hsn">Refresh records</button>
        <div className="admin-toolbar__fields">
          <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search by HSN code or GST</span>
            <input maxLength={20} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="HSN code or GST rate" data-testid="input-search-hsn" /></label>
          <div className="admin-filter" style={{ minWidth: 160 }}><AllergenSearchableSelect id="hsn-filter-status" label="Status" value={status} testId="select-filter-hsn-status" options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} onChange={(v) => { setStatus(v || 'all'); setPage(1); }} /></div>
        </div>
        <MasterFilterReset disabled={!hasFilters} onClick={() => { setSearch(''); setStatus('all'); setPage(1); }} testId="button-clear-hsn-filters" />
      </div>
      {loading ? <p className="admin-empty" role="status">Loading HSN mappings…</p>
        : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><Hash size={21} aria-hidden="true" /></span><strong>HSN mappings could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={retry} data-testid="button-retry-hsn">Try again</button></div>
        : <>
          {data.items.length ? <>
            <div className="admin-allergen-desktop"><DataTable columns={columns} rows={data.items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="HSN records" /></div>
            <div className="admin-allergen-mobile" role="list" aria-label="HSN records">{data.items.map((r, i) => <article className="admin-zone-card" role="listitem" key={r.id} data-testid={`card-hsn-${r.id}`}>
              <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{(page - 1) * pageSize + i + 1}</span><h2>HSN {r.code}</h2></div><StatusBadge status={r.status} id={`m-${r.id}`} kind="hsn" /></div>
              <p>GST {r.gst}%</p>
              <dl className="admin-zone-card__meta"><div><dt>Created</dt><dd>{audit(r.createdBy, r.createdAt)}</dd></div><div><dt>Updated</dt><dd>{audit(r.updatedBy, r.updatedAt)}</dd></div></dl>{actions(r, true)}
            </article>)}</div>
          </> : <div className="admin-empty" data-testid="status-hsn-empty"><span className="admin-empty__icon"><Hash size={21} aria-hidden="true" /></span><strong>{data.total ? 'No matching HSN mappings' : 'No HSN mappings yet'}</strong><p>{data.total ? 'Try another code or GST rate.' : 'Add the first code-to-GST mapping.'}</p></div>}
          <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={data.filtered} total={data.total} label="HSN mappings" onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} testId="text-hsn-count" />
        </>}
    </section>
    {editing && <HsnForm record={editing === 'new' ? null : editing} canSave={editing === 'new' ? can.add : can.edit} onClose={() => { setEditing(null); retry(); }} onSaved={(msg) => { setEditing(null); setFeedback(msg); retry(); }} />}
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked || !can.edit} title={`${actionName} HSN mapping?`} description={`${actionName} HSN ${confirming.record.code} (GST ${confirming.record.gst}%)? ${confirming.type === 'inactivate' ? 'It will no longer be offered for new or changed allergen pairs. Existing products keep their saved snapshot.' : ''}`} actionLabel={`${actionName} mapping`} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}

function HsnForm({ record, canSave, onClose, onSaved }) {
  const [values, setValues] = useState(() => record ? { code: record.code, gst: String(record.gst), status: record.status } : { code: '', gst: '', status: 'active' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const update = (f, v) => { setValues((c) => ({ ...c, [f]: v })); setErrors((c) => ({ ...c, [f]: undefined })); if (!blocked) setServerError(''); };
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked || !canSave) return;
    const next = validateHsn(values); setErrors(next);
    if (Object.keys(next).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setServerError('');
    try {
      const saved = await (record ? editHsn(record, values) : createHsn(values)); guard();
      onSaved(`HSN ${saved?.code ?? values.code.trim()} ${record ? 'updated' : 'added'}.`);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (cause.fields) setErrors((c) => ({ ...c, ...cause.fields }));
      setServerError(explain(cause)); setBlocked(isBlocking(cause));
    } finally { busy.current = false; setPending(false); }
  }
  const field = (name, label, props) => <div className="mr-form__field"><label className="mr-form__label" htmlFor={`hsn-${name}`}>{label} <span className="mr-form__required">*</span></label>
    <input id={`hsn-${name}`} className="mr-form__control" value={values[name]} onChange={(e) => update(name, e.target.value)} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `hsn-${name}-error` : undefined} data-testid={`input-hsn-${name}`} {...props} />
    {errors[name] && <p className="mr-form__error" id={`hsn-${name}-error`} role="alert">{errors[name]}</p>}</div>;
  return <Dialog title={record ? `Edit HSN ${record.code}` : 'Add HSN mapping'} dismissDisabled={pending} onClose={onClose}>
    <form className="admin-dialog__form" onSubmit={submit} noValidate>
      {!canSave && <p role="alert">Your permission for this action was removed. This draft cannot be saved.</p>}
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert" data-testid="status-hsn-form-error"><p>{serverError}</p></div>}
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 14 }}>
        {field('code', 'HSN code', { inputMode: 'numeric', maxLength: 16, autoComplete: 'off', placeholder: 'e.g. 30049099' })}
        <p className="mr-form__hint" style={{ marginTop: -8 }}>Digits only, 1 to 16. Leading zeros are kept exactly.</p>
        {field('gst', 'GST (%)', { inputMode: 'decimal', onBlur: () => { const n = normalGst(values.gst); if (n !== null) update('gst', n); } })}
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="hsn-status">Status <span className="mr-form__required">*</span></label>
          <AllergenSearchableSelect id="hsn-status" label="Status" value={values.status} testId="select-hsn-status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} onChange={(v) => update('status', v)} />
          {errors.status && <p className="mr-form__error" role="alert">{errors.status}</p>}</div>
      </fieldset>
      <div className="admin-dialog__actions">
        <button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-hsn">{blocked ? 'Close and refresh' : 'Cancel'}</button>
        <button type="submit" disabled={pending || blocked || !canSave} className="admin-button" data-testid="button-save-hsn">{pending ? 'Saving…' : record ? 'Save changes' : 'Add mapping'}</button>
      </div>
    </form>
  </Dialog>;
}
