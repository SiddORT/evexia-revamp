import { useState } from 'react';
import { X } from 'lucide-react';
import MRReferenceSelect from './MRReferenceSelect.jsx';
import './territory.css';

const unavailable = (item) => item?.deleted ? 'deleted' : item?.status && item.status !== 'active' ? 'inactive' : '';

// Bounded searchable multi-select: selected chips plus a server-searched picker.
// The picker is keyed by its parent scope by the caller so obsolete requests abort.
export default function TerritoryMultiSelect({ id, kind, label, values, savedChoices = [], onAdd, onRemove, requestChoices, disabled, disabledReason, invalid, describedBy, emptyGuidance, noun, onKnown, onStateChange, scopeKey }) {
  const [known, setKnown] = useState(() => Object.fromEntries(savedChoices.map((item) => [item.id, item])));
  const remember = (rows) => { onKnown?.(rows); setKnown((current) => ({ ...current, ...Object.fromEntries(rows.map((item) => [item.id, item])) })); };
  return <div className="territory-multi" data-testid={`territory-${kind}`}>
    {values.length ? <ul className="territory-multi__chips" aria-label={`Selected ${label}`}>
      {values.map((value) => {
        const item = known[value];
        const state = unavailable(item);
        return <li key={value} className={`territory-chip${state ? ' territory-chip--warn' : ''}`}>
          <span>{item?.name || `Saved ${noun} unavailable`}{state && <em> ({state})</em>}</span>
          <button type="button" className="territory-chip__remove" disabled={disabled} onClick={() => onRemove(value)}
            aria-label={`Remove ${item?.name || noun}`} data-testid={`button-remove-${kind}-${value}`}><X size={14} aria-hidden="true" /></button>
        </li>;
      })}
    </ul> : <p className="territory-multi__empty">{disabledReason || `No ${label} selected.`}</p>}
    <MRReferenceSelect key={scopeKey} id={id} kind={kind} label={`Add ${noun}`} value="" onChange={(next) => { if (next && !values.includes(next)) onAdd(next, known[next]); }}
      onHydrate={remember} onStateChange={onStateChange} name={id.replace('mr-', '')} requestChoices={requestChoices} placeholder={disabled ? disabledReason : `Add ${noun}`} required={false}
      disabled={disabled} invalid={invalid} describedBy={describedBy} emptyGuidance={emptyGuidance} testId={`select-add-${kind}`}
      isDisabled={(item) => values.includes(item.id) || item.deleted || item.status !== 'active'} />
  </div>;
}
