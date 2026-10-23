import SearchableSelect from './SearchableSelect.jsx';
import useReferences from '../../hooks/useImmunotherapyReferences.js';
import { request } from '../../services/serverKits.js';

export default function KitsReferenceSelect({ kind, value, onChange, label, id, onPerson, disabled }) {
  const source = useReferences(kind, [], value, request);
  return <div className="kits-field"><label htmlFor={id}>{label}</label>
    <SearchableSelect viewportMenu id={id} label={label} value={value || ''} disabled={disabled}
      options={source.items.map((p) => ({ value: p.id, label: p.name }))}
      searchOptions={() => source.items.map((p) => ({ value: p.id, label: p.name }))}
      onSearch={source.onSearch} onChange={(next) => { onChange(next); onPerson?.(source.items.find((p) => p.id === next) || null); }}
      placeholder={`Select ${label.toLowerCase()}`} />
    {source.state === 'loading' && <span className="kits-hint" role="status">Loading choices…</span>}
    {source.error && <span role="alert">{source.error} <button type="button" className="kits-link" onClick={source.retry}>Retry</button></span>}
    {source.nextCursor && <button type="button" className="kits-link" disabled={source.state === 'loading'} onClick={source.more}>Load next section</button>}
    {value && !disabled && <button type="button" className="kits-link" onClick={() => { onChange(''); onPerson?.(null); }}>Clear selection</button>}
  </div>;
}
