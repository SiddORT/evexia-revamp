import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, MapPin, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { createLocation, editLocation, getLocation, listLocations } from '../../services/serverLocations.js';
import '../../mr.css';
import '../../category.css';
import '../../storageLocation.css';

const LIST_PATH = '/admin/masters/storage-locations';
const emptyValues = { name: '', address: '', status: '' };

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Storage location name is required.';
  if (values.name.trim().length > 200) errors.name = 'Use no more than 200 characters.';
  if (!values.address.trim()) errors.address = 'Address is required.';
  if (values.address.trim().length > 2000) errors.address = 'Use no more than 2,000 characters.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Select a status.';
  return errors;
}

function StorageLocationForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? {
    name: record.name || '',
    address: record.address || '',
    status: record.status || 'active',
  } : emptyValues);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) return;
    busy.current = true;
    setPending(true);
    try {
      await onSave({ name: values.name.trim(), address: values.address.trim(), status: values.status });
    } catch (cause) {
      setServerError(cause.message || 'The location could not be saved.');
      setBlocked(cause.code === 'location_stale' || Boolean(cause.ambiguous));
    } finally { busy.current = false; setPending(false); }
  }

  return <form className="admin-category-form admin-storage-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Location details</h2><p>Fields marked * are required. Saved records are shared on the server.</p></div><MapPin size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={async () => {
        if (busy.current) return;
        busy.current = true;
        setPending(true);
        try {
          const current = await onRefresh(values);
          setServerError(current ? `Current server record: ${current.name}; ${current.address}; ${current.status}. Your draft is retained. Review these details before saving again.` : 'No matching server location was found. Your draft is retained; review it before retrying.');
          setBlocked(false);
        } catch (cause) { setServerError(cause.message); }
        finally { busy.current = false; setPending(false); }
      }} data-testid="button-refresh-storage-error"><RefreshCw size={16} aria-hidden="true" /> Review current server details (keep draft)</button></div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="storage-name">Storage location <span className="mr-form__required">*</span></label><input id="storage-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Central supply room" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'storage-name-error' : undefined} data-testid="input-storage-name" />{errors.name && <p className="mr-form__error" id="storage-name-error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field mr-form__field--wide"><label className="mr-form__label" htmlFor="storage-address">Address <span className="mr-form__required">*</span></label><textarea id="storage-address" className="mr-form__control" value={values.address} onChange={(event) => update('address', event.target.value)} placeholder="Building, floor, street and other location details" aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? 'storage-address-error' : undefined} data-testid="input-storage-address" />{errors.address && <p className="mr-form__error" id="storage-address-error" role="alert">{errors.address}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="storage-status">Status <span className="mr-form__required">*</span></label><select id="storage-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'storage-status-error' : undefined} data-testid="select-storage-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" id="storage-status-error" role="alert">{errors.status}</p>}</div>
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Shared location directory only. Browser-local Allergen and purchasing locations are separate; no inventory is updated.</span><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-storage">Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-storage">{pending ? 'Saving…' : record ? 'Save changes' : 'Save location'}</button></div></div>
  </form>;
}

export default function StorageLocationFormPage({ id }) {
  const [, navigate] = useLocation();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [revision, setRevision] = useState(0);
  const snapshot = useRef(null);
  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoading(true);
    getLocation(id).then((row) => {
      if (alive) { snapshot.current = row; setRecord(row); setError(''); }
    }).catch((cause) => { if (alive) setError(cause.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, revision]);
  const title = id ? 'Edit storage location' : 'Add storage location';

  async function refresh(values) {
    if (!id) {
      const result = await listLocations({ query: values.name.trim(), status: 'all', limit: 100, offset: 0 });
      const sameName = result.items.find((row) => row.name.toLowerCase() === values.name.trim().replace(/\s+/g, ' ').toLowerCase());
      if (sameName) throw new Error(`A location with this name is already saved: ${sameName.name}; ${sameName.address}; ${sameName.status}. Your draft is retained. Return to the list and inspect it instead of creating a duplicate.`);
      if (result.filtered > 100) throw new Error('More than 100 matching records. Narrow or inspect the list before retrying. Your draft is retained.');
      return null;
    }
    const current = await getLocation(id);
    snapshot.current = current;
    return current;
  }
  async function save(values) {
    await (id ? editLocation(snapshot.current, values) : createLocation(values));
    navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory / Storage Location Master</p><h1>{title}</h1><p className="admin-page-head__description">{id ? 'Update this location’s address and availability.' : 'Create a shared server location for your storage directory.'}</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-storage-locations"><ArrowLeft size={16} aria-hidden="true" /> Back to locations</button></div>
    {loading ? <p role="status">Loading location…</p> : error || (id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>Location could not be loaded</h2><p>{error || 'This location may have been deleted.'}</p><button type="button" className="admin-button" onClick={() => setRevision((value) => value + 1)} data-testid="button-refresh-storage-form">Retry</button></section> : <section className="admin-panel" aria-label={title}><StorageLocationForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}