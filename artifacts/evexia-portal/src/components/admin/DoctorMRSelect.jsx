import { useRef, useState } from 'react';
import MRReferenceSelect from './MRReferenceSelect.jsx';
import { doctorMRChoices } from '../../services/serverDoctors.js';

// `location` (Doctor form only) requests assignment_only=true so search, paging
// and saved hydration are strictly limited to MRs covering that exact
// Zone/HQ/Area. Without it (list filter, bulk shift) the generic unscoped
// choices remain (assignment_only defaults false server-side).
export default function DoctorMRSelect({ id = 'doctor-mrId', value, savedName, onChange, onHydrate, error, testId = 'select-doctor-mrId', labelClassName = 'mr-form__label', label = 'MR Name', required = true, location, disabled = false }) {
  const scoped = location !== undefined;
  const complete = scoped && Boolean(location.zoneId && location.hqId && location.areaId);
  const [incompatible, setIncompatible] = useState(false);
  const seen = useRef(new Set());
  const valueRef = useRef(value);
  valueRef.current = value;
  const scopeKey = scoped ? `${location.zoneId}|${location.hqId}|${location.areaId}` : 'all';
  const request = (_, params, signal) => doctorMRChoices({
    ...params, include_saved: params.includeSaved, includeSaved: undefined,
    ...(scoped ? { assignment_only: true, zone_id: location.zoneId, hq_id: location.hqId, area_id: location.areaId } : {}),
  }, signal);
  if (scoped && !complete) {
    return <><label className={labelClassName} htmlFor={id}>{label}</label>
      <input id={id} name="mrId" className="doctor-form__control" readOnly disabled value={value ? (savedName || 'Saved MR') : ''}
        placeholder="Choose Zone, HQ and Area first" aria-invalid={Boolean(error)} data-testid={testId} /></>;
  }
  return <><label className={labelClassName} htmlFor={id}>{label}</label><MRReferenceSelect key={scopeKey}
    id={id} name={scoped ? 'mrId' : undefined} kind="managers" label={label} value={value}
    savedName={savedName} onChange={(next) => { setIncompatible(false); onChange(next); }}
    onHydrate={(items) => { items.forEach((item) => seen.current.add(item.id)); onHydrate?.(items); }}
    onStateChange={(state) => {
      if (state === 'loading') seen.current = new Set();
      if (scoped && state === 'ready') setIncompatible(Boolean(valueRef.current) && !seen.current.has(valueRef.current));
    }}
    requestChoices={request} disabled={disabled}
    invalid={Boolean(error) || incompatible} required={required} placeholder="Select an MR" testId={testId}
    emptyGuidance={scoped ? 'No active MR covers this Zone, HQ and Area. Update MR coverage in MR Master, or choose a different location.' : 'Search for an active shared MR. New assignments require an active Zone.'} />
    {incompatible && <p className="doctor-form__notice" role="status" data-testid="notice-doctor-mr-incompatible">The saved MR{savedName ? ` (${savedName})` : ''} does not cover this exact location. It has not been removed; choose an eligible MR or the server will reject the save.</p>}</>;
}
