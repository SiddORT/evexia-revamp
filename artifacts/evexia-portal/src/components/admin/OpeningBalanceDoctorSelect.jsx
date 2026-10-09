import { useEffect, useState } from 'react';
import SearchableSelect from './SearchableSelect.jsx';
import { openingBalanceDoctors } from '../../services/serverOpeningBalances.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../../auth/adminSession.js';

export default function OpeningBalanceDoctorSelect({ value, record, disabled, error, onChange }) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const [selected, setSelected] = useState(record ? { id: record.doctorId, name: record.doctorName, registrationNumber: record.registrationNumber, usable: record.doctorUsable } : null);
  useEffect(() => {
    if (record) setSelected({ id: record.doctorId, name: record.doctorName,
      registrationNumber: record.registrationNumber, usable: record.doctorUsable });
  }, [record?.doctorId, record?.doctorName, record?.registrationNumber, record?.doctorUsable]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) { setSelected(null); setState({ items: [], total: 0, loading: false, error: '' }); setQuery(''); }
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setState((old) => ({ ...old, items: [], loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const data = await openingBalanceDoctors({ query, offset, limit: 50, ...(record ? { balance_id: record.id } : {}) }, controller.signal);
        guard(); if (!controller.signal.aborted) setState({ ...data, loading: false, error: '' });
      } catch (cause) {
        try { guard(); } catch { return; }
        if (!controller.signal.aborted) setState({ items: [], total: 0, loading: false, error: cause.message });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, offset, record?.id, revision]);
  const rows = [...state.items];
  if (selected && !rows.some((d) => d.id === selected.id)) rows.push(selected);
  const options = rows.filter((d) => d.usable || d.id === record?.doctorId && d.id === value)
    .map((d) => ({ value: d.id, label: `${d.name} · ${d.registrationNumber}${!d.usable ? ' (saved inactive/unavailable reference)' : ''}` }));
  return <div className="mr-form__field">
    <label className="mr-form__label" htmlFor="opening-balance-doctor">Doctor *</label>
    <SearchableSelect id="opening-balance-doctor" label="Doctor" value={value} options={options}
      searchOptions={() => options.filter((option) => state.items.some((d) => d.id === option.value))} preserveSearch placeholder="Search name or registration" disabled={disabled} invalid={Boolean(error)}
      describedBy="ob-doctor-help" onSearch={(text) => { setQuery(text.slice(0, 200)); setOffset(0); }}
      onChange={(id) => { setSelected(rows.find((d) => d.id === id) || null); onChange(id); }} />
    <p className={error ? 'mr-form__error' : 'ob-form__hint'} id="ob-doctor-help" role={error || state.error ? 'alert' : 'status'}>{error || state.error || (state.loading ? 'Loading shared Doctors…' : `${state.total} matching active Doctors. Search or page; only unchanged saved inactive references can be retained.`)}</p>
    {state.error && <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)}>Retry Doctors</button>}
    <div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" disabled={disabled || state.loading || !offset} onClick={() => setOffset((n) => Math.max(0, n - 50))}>Previous Doctors</button><button type="button" className="admin-button admin-button--secondary" disabled={disabled || state.loading || offset + 50 >= state.total} onClick={() => setOffset((n) => n + 50)}>Next Doctors</button></div>
  </div>;
}
