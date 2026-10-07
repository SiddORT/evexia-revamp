import { useState } from 'react';
import { getZone } from '../../services/serverZones.js';
import Field from '../auth/Field.jsx';
import Dialog from './Dialog.jsx';

export default function ZoneForm({ zone, onSave, onClose, canSave = true }) {
  const [name, setName] = useState(zone?.name || '');
  const [status, setStatus] = useState(zone?.status || 'active');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState(null);
  const [blocked, setBlocked] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || blocked || !canSave) return;
    if (!name.trim()) { setError('Zone name is required.'); return; }
    if (name.trim().length > 200) { setError('Zone name must be at most 200 characters.'); return; }
    setPending(true);
    try {
      const result = await onSave({ name: name.trim(), status }, current || zone);
      if (!result.success) { setError(result.error); setBlocked(result.code === 'zone_stale' || Boolean(result.ambiguous)); }
    } finally { setPending(false); }
  }

  async function reviewCurrent() {
    setPending(true);
    try {
      const record = await getZone(zone.id);
      setCurrent(record);
      setError(`Current server record: ${record.name} (${record.status}), version ${record.version}. Your draft is unchanged. Check it before saving.`);
      setBlocked(false);
    } catch (cause) { setError(cause.message); }
    finally { setPending(false); }
  }

  return (
    <Dialog title={zone ? 'Edit zone' : 'Add zone'} onClose={pending ? () => {} : onClose}
      titleInfo="Changes are saved to shared server records. Server identity and time determine audit details. Local demo assignments are unchanged.">
      <form id="zone-form" className="admin-dialog__form" onSubmit={handleSubmit} noValidate>
        {!canSave && <p role="alert">Your permission for this action was removed. This draft is kept for reference, but cannot be saved.</p>}
        <Field id="zone-name" label="Zone name *" value={name} onChange={(event) => { setName(event.target.value); setError(''); }} error={error} placeholder="e.g. Central Zone" autoComplete="off" />
        <label className="admin-dialog__field" htmlFor="zone-status">
          Status
          <select id="zone-status" value={status} onChange={(event) => setStatus(event.target.value)} data-testid="select-zone-status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        {blocked && zone && <button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={reviewCurrent}>Review current server record</button>}
        {blocked && !zone && <p role="alert">Close this draft and refresh the table to inspect whether the zone was saved before adding it again.</p>}
        <div className="admin-dialog__actions">
          <button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-zone">Cancel</button>
          <button type="submit" disabled={pending || blocked || !canSave} className="admin-button" data-testid="button-save-zone">{pending ? 'Saving…' : zone ? 'Save changes' : 'Add zone'}</button>
        </div>
      </form>
    </Dialog>
  );
}