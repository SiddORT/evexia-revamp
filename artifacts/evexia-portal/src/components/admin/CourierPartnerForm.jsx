import { useState } from 'react';
import Field from '../auth/Field.jsx';
import Dialog from './Dialog.jsx';
import { getCourier } from '../../services/serverCouriers.js';

export default function CourierPartnerForm({ partner, onSave, onClose }) {
  const [name, setName] = useState(partner?.name || '');
  const [status, setStatus] = useState(partner?.status || 'active');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (pending || blocked) return;
    if (!name.trim()) { setError('Courier partner name is required.'); return; }
    if (name.trim().length > 200) { setError('Name must be at most 200 characters.'); return; }
    setPending(true);
    try {
      const result = await onSave({ name: name.trim(), status }, current || partner);
      if (!result.success) { setError(result.error); setBlocked(result.code === 'courier_stale' || Boolean(result.ambiguous)); }
    } finally { setPending(false); }
  }
  async function reviewCurrent() {
    setPending(true);
    try {
      const record = await getCourier(partner.id);
      setCurrent(record);
      setError(`Current server record: ${record.name} (${record.status}), version ${record.version}. Your draft is unchanged. Review before saving.`);
      setBlocked(false);
    } catch (cause) { setError(cause.message); }
    finally { setPending(false); }
  }
  return <Dialog title={partner ? 'Edit courier partner' : 'Add courier partner'} eyebrow="Courier Partner Master"
    titleInfo="Changes are saved to shared server records. Verified server identity and UTC time determine audit details. No courier provider account is created." onClose={pending ? () => {} : onClose}>
    <form className="admin-dialog__form" onSubmit={submit} noValidate>
      <Field id="courier-partner-name" label="Courier partner name *" value={name} onChange={(event) => { setName(event.target.value); setError(''); }} error={error} placeholder="e.g. Express Delivery" autoComplete="off" />
      <label className="admin-dialog__field" htmlFor="courier-partner-status">Status
        <select id="courier-partner-status" value={status} onChange={(event) => setStatus(event.target.value)} data-testid="select-courier-partner-status">
          <option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </label>
      {blocked && partner && <button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={reviewCurrent}>Review current server record</button>}
      {blocked && !partner && <p role="alert">Close this draft and refresh the table to check whether the partner was saved before adding it again.</p>}
      <div className="admin-dialog__actions">
        <button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-courier-partner">Cancel</button>
        <button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-courier-partner">{pending ? 'Saving…' : partner ? 'Save changes' : 'Add courier partner'}</button>
      </div>
    </form>
  </Dialog>;
}