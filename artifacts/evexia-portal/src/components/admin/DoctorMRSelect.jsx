import MRReferenceSelect from './MRReferenceSelect.jsx';
import { doctorMRChoices } from '../../services/serverDoctors.js';

const request = (_, params, signal) => doctorMRChoices({
  ...params, include_saved: params.includeSaved, includeSaved: undefined,
}, signal);

export default function DoctorMRSelect({ id = 'doctor-mrId', value, savedName, onChange, onHydrate, error, testId = 'select-doctor-mrId', labelClassName = 'mr-form__label', label = 'MR Name', required = true }) {
  return <><label className={labelClassName} htmlFor={id}>{label}</label><MRReferenceSelect id={id} kind="managers" label={label} value={value}
    savedName={savedName} onChange={onChange} onHydrate={onHydrate} requestChoices={request}
    invalid={Boolean(error)} required={required} placeholder="Select an MR" testId={testId}
    emptyGuidance="Search for an active shared MR. New assignments require an active Zone." /></>;
}
