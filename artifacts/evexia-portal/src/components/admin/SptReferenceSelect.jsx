import SearchableSelect from './SearchableSelect.jsx';
import useReferences from '../../hooks/useImmunotherapyReferences.js';
import { request } from '../../services/serverSpt.js';

export default function SptReferenceSelect({ kind, value, onChange, label, id, onPerson, disabled, saved = [], invalid, describedBy, exclude = [] }) {
  const source = useReferences(kind, saved, value, request);
  const options = source.items.filter((p) => !exclude.includes(p.id)).map((p) => ({
    value: p.id, label: [p.code || p.doctorNumber || p.employeeCode, p.name].filter(Boolean).join(' — '),
  }));
  return <div className="spt-field"><label htmlFor={id}>{label}</label>
    <SearchableSelect viewportMenu id={id} label={label} value={value || ''} disabled={disabled}
      invalid={invalid} describedBy={describedBy} options={options} searchOptions={() => options}
      onSearch={source.onSearch} onChange={(next) => { onChange(next); onPerson?.(source.items.find((p) => p.id === next) || null); }}
      placeholder={`Select ${label.toLowerCase()}`} />
    {source.state === 'loading' && !disabled && <span className="spt-card__sub" role="status">Loading choices…</span>}
    {source.error && !disabled && <span role="alert">{source.error} <button type="button" className="spt-link" onClick={source.retry}>Retry</button></span>}
    {source.nextCursor && !disabled && <button type="button" className="spt-link" disabled={source.state === 'loading'} onClick={source.more}>Load next section</button>}
    {value && !disabled && <button type="button" className="spt-link" onClick={() => { onChange(''); onPerson?.(null); }}>Clear selection</button>}
  </div>;
}
