import { useState } from 'react';
import Field from '../auth/Field.jsx';
import Dialog from './Dialog.jsx';

export default function CourierPartnerForm({ partner, onSave, onClose }) {
  const [name, setName] = useState(partner?.name || '');
  const [status, setStatus] = useState(partner?.status || 'active');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('Courier partner name is required.'); return; }
    const result = onSave({ name: name.trim(), status });
    if (!result.success) setError(result.error);
  }
  return <Dialog title={partner ? 'Edit courier partner' : 'Add courier partner'} eyebrow="Courier Partner Master"
    titleInfo="Courier partner records are stored in this browser only; no provider account is created." onClose={onClose}>
    <form className="admin-dialog__form" onSubmit={submit} noValidate>
      <Field id="courier-partner-name" label="Courier partner name *" value={name} onChange={(event) => { setName(event.target.value); setError(''); }} error={error} placeholder="e.g. Express Delivery" autoComplete="off" />
      <label className="admin-dialog__field" htmlFor="courier-partner-status">Status
        <select id="courier-partner-status" value={status} onChange={(event) => setStatus(event.target.value)} data-testid="select-courier-partner-status">
          <option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </label>
      <div className="admin-dialog__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-courier-partner">Cancel</button>
        <button type="submit" className="admin-button" data-testid="button-save-courier-partner">{partner ? 'Save changes' : 'Add courier partner'}</button>
      </div>
    </form>
  </Dialog>;
}