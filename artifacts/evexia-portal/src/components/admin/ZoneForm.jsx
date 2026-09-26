import { useState } from 'react';
import Field from '../auth/Field.jsx';
import Dialog from './Dialog.jsx';

export default function ZoneForm({ zone, onSave, onClose }) {
  const [name, setName] = useState(zone?.name || '');
  const [status, setStatus] = useState(zone?.status || 'active');
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('Zone name is required.'); return; }
    const result = onSave({ name: name.trim(), status });
    if (!result.success) setError(result.error);
  }

  return (
    <Dialog title={zone ? 'Edit zone' : 'Add zone'} description={zone ? 'Update the name or current availability of this zone.' : 'Create a zone for your EVEXIA workspace.'} onClose={onClose}>
      <form id="zone-form" className="admin-dialog__form" onSubmit={handleSubmit} noValidate>
        <Field id="zone-name" label="Zone name *" value={name} onChange={(event) => { setName(event.target.value); setError(''); }} error={error} placeholder="e.g. Central Zone" autoComplete="off" />
        <label className="admin-dialog__field" htmlFor="zone-status">
          Status
          <select id="zone-status" value={status} onChange={(event) => setStatus(event.target.value)} data-testid="select-zone-status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <div className="admin-dialog__actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-zone">Cancel</button>
          <button type="submit" className="admin-button" data-testid="button-save-zone">{zone ? 'Save changes' : 'Add zone'}</button>
        </div>
      </form>
    </Dialog>
  );
}