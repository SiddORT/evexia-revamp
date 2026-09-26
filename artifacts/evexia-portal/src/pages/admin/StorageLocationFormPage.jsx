import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, MapPin, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import useStorageLocations from '../../hooks/useStorageLocations.js';
import '../../mr.css';
import '../../category.css';
import '../../storageLocation.css';

const LIST_PATH = '/admin/masters/storage-locations';
const emptyValues = { name: '', address: '', status: '' };

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Storage location name is required.';
  if (!values.address.trim()) errors.address = 'Address is required.';
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

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError('');
  }
  function submit(event) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) return;
    try {
      const result = onSave({ name: values.name.trim(), address: values.address.trim(), status: values.status });
      if (!result.success) setServerError(result.error || 'The location could not be saved. Refresh records and try again.');
    } catch (cause) { setServerError(cause.message || 'The location could not be saved.'); }
  }

  return <form className="admin-category-form admin-storage-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Location details</h2><p>Fields marked * are required. Changes are saved to this browser only.</p></div><MapPin size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-storage-error"><RefreshCw size={16} aria-hidden="true" /> Refresh records and discard draft</button></div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="storage-name">Storage location <span className="mr-form__required">*</span></label><input id="storage-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Central supply room" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'storage-name-error' : undefined} data-testid="input-storage-name" />{errors.name && <p className="mr-form__error" id="storage-name-error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field mr-form__field--wide"><label className="mr-form__label" htmlFor="storage-address">Address <span className="mr-form__required">*</span></label><textarea id="storage-address" className="mr-form__control" value={values.address} onChange={(event) => update('address', event.target.value)} placeholder="Building, floor, street and other location details" aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? 'storage-address-error' : undefined} data-testid="input-storage-address" />{errors.address && <p className="mr-form__error" id="storage-address-error" role="alert">{errors.address}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="storage-status">Status <span className="mr-form__required">*</span></label><select id="storage-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'storage-status-error' : undefined} data-testid="select-storage-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" id="storage-status-error" role="alert">{errors.status}</p>}</div>
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Changes stay in this browser. No server account or inventory is updated.</span><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-storage">Cancel</button><button type="submit" className="admin-button" data-testid="button-save-storage">{record ? 'Save changes' : 'Save location'}</button></div></div>
  </form>;
}

export default function StorageLocationFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, error, retry, add, edit } = useStorageLocations();
  const [revision, setRevision] = useState(0);
  const record = id ? records.find((item) => item.id === id) : null;
  const title = id ? 'Edit storage location' : 'Add storage location';

  function refresh() {
    retry();
    setRevision((current) => current + 1);
  }
  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory / Storage Location Master</p><h1>{title}</h1><p className="admin-page-head__description">{id ? 'Update this location’s address and availability.' : 'Create a browser-local location for your storage directory.'}</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-storage-locations"><ArrowLeft size={16} aria-hidden="true" /> Back to locations</button></div>
    {error || (id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>{error ? 'Locations could not be loaded' : 'Location not found'}</h2><p>{error || 'This location may have been removed or the link may be incorrect. Refresh the latest records or return to Storage Location Master.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-storage-locations">Return to locations</button><button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-storage-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div></section> : <section className="admin-panel" aria-label={title}><StorageLocationForm key={`${id || 'new'}-${revision}`} record={record} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}