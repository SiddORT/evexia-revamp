import { useEffect, useState } from 'react';
import { patientDoctorChoices } from '../../services/serverPatients.js';

export default function PatientDoctorSelect({ value, original, blocked, error, onChange }) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({ ...old, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const data = await patientDoctorChoices({ query, offset, limit: 50, include_saved: value || undefined }, controller.signal);
        if (!controller.signal.aborted) setState({ ...data, loading: false, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted) setState({ items: [], total: 0, loading: false, error: cause.message });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, offset, value, revision]);
  const selected = state.items.find((item) => item.id === value);
  return <div className="mr-form__field mr-form__field--wide">
    <label className="mr-form__label" htmlFor="patient-doctorSearch">Search server Doctors</label>
    <input id="patient-doctorSearch" className="mr-form__control" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} disabled={blocked} />
    <label className="mr-form__label" htmlFor="patient-doctorId">Assigned doctor *</label>
    <select id="patient-doctorId" name="doctorId" className="mr-form__control" required aria-invalid={Boolean(error)}
      aria-describedby={selected ? 'patient-doctor-selection patient-doctor-help' : 'patient-doctor-help'} value={value} disabled={blocked || state.loading} onChange={(event) => onChange(event.target.value)}
      data-testid="select-patient-doctorId">
      <option value="">{state.loading ? 'Loading Doctors…' : 'Select a Doctor'}</option>
      {value && !selected && <option value={value}>Missing/unavailable saved Doctor — repair explicitly</option>}
      {state.items.filter((item) => item.usable || (item.id === original && item.id === value)).map((item) =>
        <option value={item.id} key={item.id}>{item.name}{!item.usable ? ' (inactive relationship; retained only)' : ''}</option>)}
    </select>
    {selected && <p className="mr-form__hint" id="patient-doctor-selection">Doctor: {selected.name}{!selected.usable ? ' (inactive relationship; retained only)' : ''}</p>}
    <p className="mr-form__hint" id="patient-doctor-help">{error || state.error || (selected ? `MR: ${selected.mrName || 'Missing'} · Zone: ${selected.zoneName || 'Missing'}` : !state.loading && !state.total ? 'No matching Doctors. Clear the search, or set up Zone and MR Masters, then add an active Doctor in Doctor Master.' : !state.loading && !state.items.some((item) => item.usable) ? 'No usable Doctors on this page. Check active Doctor, MR and Zone records, or search/page for another Doctor.' : 'Search or page through authoritative server Doctors.')}</p>
    {state.error && <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)}>Retry Doctors</button>}
    <div className="mr-form__actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={!offset || state.loading} onClick={() => setOffset((n) => Math.max(0, n - 50))}>Previous Doctors</button>
      <span>{state.total} matching Doctors</span>
      <button type="button" className="admin-button admin-button--secondary" disabled={offset + 50 >= state.total || state.loading} onClick={() => setOffset((n) => n + 50)}>Next Doctors</button>
    </div>
  </div>;
}
