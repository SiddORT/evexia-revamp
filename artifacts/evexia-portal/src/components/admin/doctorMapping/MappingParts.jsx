import { useEffect, useRef, useState } from 'react';
import MRReferenceSelect from '../MRReferenceSelect.jsx';
import Dialog from '../Dialog.jsx';
import DoctorMRSelect from '../DoctorMRSelect.jsx';
import { formatAdminTimestamp } from '../adminPreferences.js';
import { doctorAssignmentHistory, doctorMappingReferences } from '../../../services/serverDoctors.js';

export const REASON_MIN = 10;
export const REASON_MAX = 1000;
export const reasonError = (value) => {
  const length = String(value || '').trim().length;
  return length < REASON_MIN ? `Enter a reason of at least ${REASON_MIN} characters.` : length > REASON_MAX ? `Keep the reason within ${REASON_MAX} characters.` : '';
};
export const person = (item, numberKey = 'number') => item ? `${item.name || 'Unnamed'}${item[numberKey] ? ` (${item[numberKey]})` : ''}` : 'Not assigned';

const LABELS = { area: 'Doctor Area', headquarter: 'MR Headquarter', zone: 'MR Zone', doctor: 'Doctor' };
const GUIDANCE = {
  area: 'Search saved Areas from the Headquarters/Areas catalogue.',
  headquarter: 'Search Headquarters. Filters by the current MR’s HQ.',
  zone: 'Search Zones. Filters by any saved Zone of the current MR.',
  doctor: 'Search Doctors by name or number.',
};

// Bounded, explicitly continued choices; selected value is hydrated via include_saved.
export function MappingReferenceSelect({ refKind, id, label = LABELS[refKind], value, savedName, onChange, onHydrate, required = false, placeholder, invalid, describedBy, testId }) {
  const request = (_, params, signal) => doctorMappingReferences(refKind, params, signal);
  return <><label className="doctor-mapping__label" htmlFor={id}>{label}</label>
    <MRReferenceSelect id={id} kind={refKind} label={label} value={value} savedName={savedName} onChange={onChange} onHydrate={onHydrate}
      requestChoices={request} required={required} placeholder={placeholder || `All ${label.toLocaleLowerCase()}s`} invalid={invalid} describedBy={describedBy}
      emptyGuidance={GUIDANCE[refKind]} testId={testId || `select-mapping-${refKind}`} /></>;
}

export function ReasonField({ id, value, onChange, error, label = 'Reason for change', hint }) {
  return <div className="doctor-mapping__field">
    <label className="doctor-mapping__label" htmlFor={id}>{label} <span aria-hidden="true">*</span></label>
    <textarea id={id} className="doctor-mapping__textarea" rows={3} maxLength={REASON_MAX} value={value} aria-required="true"
      aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onChange={(event) => onChange(event.target.value)} data-testid={`input-${id}`} />
    <p id={`${id}-hint`} className="doctor-mapping__hint">{hint || `Recorded permanently in assignment history. ${REASON_MIN}–${REASON_MAX} characters.`} {String(value || '').trim().length}/{REASON_MAX}</p>
    {error && <p id={`${id}-error`} className="doctor-mapping__error" role="alert">{error}</p>}
  </div>;
}

export function TransferEffects() {
  return <ul className="doctor-mapping__effects" data-testid="text-transfer-effects">
    <li>Linked Patients of each moved Doctor move to the new MR in the same save.</li>
    <li>Saved orders, payments, balances and historical documents keep their original MR and are not changed.</li>
    <li>Doctor Area is not changed by an MR transfer.</li>
  </ul>;
}

export function TransferDialog({ doctors, draft, onDraft, mrs, onHydrate, pending, error, onConfirm, onClose }) {
  const [touched, setTouched] = useState(false);
  const target = mrs.find((mr) => mr.id === draft.mrId);
  const moving = doctors.filter((doctor) => doctor.mrId !== draft.mrId);
  const unchanged = doctors.length - moving.length;
  const rError = moving.length ? reasonError(draft.reason) : '';
  const targetError = !draft.mrId ? 'Choose the destination MR.' : target && !target.usable ? 'This MR is not active with a usable Zone.' : '';
  const ready = draft.mrId && !targetError && moving.length > 0 && !rError && draft.reviewed;
  return <Dialog title={`Transfer ${doctors.length === 1 ? doctors[0].name : `${doctors.length} Doctors`} to another MR`} eyebrow="Review MR transfer"
    description="Review the old and new MR for every Doctor before confirming. The server re-checks versions and destination availability." onClose={onClose} dismissDisabled={pending}
    footer={<><button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={onClose} data-testid="button-cancel-transfer">Keep draft and close</button>
      <button type="button" className="admin-button" disabled={!ready || pending} onClick={() => { setTouched(true); if (ready) onConfirm(moving); }} data-testid="button-confirm-transfer">{pending ? 'Saving…' : `Transfer ${moving.length} Doctor${moving.length === 1 ? '' : 's'}`}</button></>}>
    <div className="doctor-mapping__dialog">
      <p className="doctor-mapping__hint">The destination must already cover each Doctor’s saved exact Zone, HQ and Area. This transfer does not grant coverage. For a legacy Doctor without a complete location, use Edit Doctor to review the location and MR together.</p>
      <div className="doctor-mapping__field"><DoctorMRSelect id="mapping-transfer-mr" label="New MR" labelClassName="doctor-mapping__label" value={draft.mrId} onHydrate={onHydrate}
        onChange={(value) => onDraft({ ...draft, mrId: value, reviewed: false })} error={touched && targetError} testId="select-transfer-mr" />
        {target && <p className="doctor-mapping__hint">New MR: {person(target, 'userId')} · Zone {target.zoneName || 'missing'}</p>}
        {touched && targetError && <p className="doctor-mapping__error" role="alert">{targetError}</p>}</div>
      <div className="doctor-mapping__review" role="region" aria-label="Doctors to transfer" tabIndex={0}>
        <table className="doctor-mapping__review-table"><thead><tr><th scope="col">Doctor</th><th scope="col">Current MR</th><th scope="col">New MR</th></tr></thead>
          <tbody>{doctors.map((doctor) => <tr key={doctor.id} data-testid={`row-transfer-${doctor.id}`}>
            <td>{person(doctor, 'doctorNumber')}</td><td>{doctor.mrName ? `${doctor.mrName}${doctor.mrUserId ? ` (${doctor.mrUserId})` : ''}` : 'Missing MR'}</td>
            <td>{!draft.mrId ? '—' : doctor.mrId === draft.mrId ? 'Already assigned — no change recorded' : person(target, 'userId')}</td></tr>)}</tbody></table>
      </div>
      {unchanged > 0 && draft.mrId && <p className="doctor-mapping__hint" role="status">{unchanged} Doctor{unchanged === 1 ? ' is' : 's are'} already with this MR and will be left out; no history is created for them.</p>}
      <TransferEffects />
      <ReasonField id="mapping-transfer-reason" value={draft.reason} onChange={(reason) => onDraft({ ...draft, reason })} error={touched || draft.reason ? rError : ''} hint="For example: MR left the organization, or MR no longer covers this Area." />
      <label className="doctor-mapping__confirm"><input type="checkbox" checked={Boolean(draft.reviewed)} onChange={(event) => onDraft({ ...draft, reviewed: event.target.checked })} data-testid="checkbox-transfer-reviewed" />
        I reviewed the Doctors, the old and new MR, and that linked Patients move with them.</label>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}

export function AreaDialog({ doctor, draft, onDraft, pending, error, onConfirm, onClose }) {
  const [touched, setTouched] = useState(false);
  const changed = (draft.areaId || null) !== (doctor.areaId || null);
  const rError = reasonError(draft.reason);
  return <Dialog title={`Doctor Area for ${doctor.name}`} eyebrow="Correct saved Area" onClose={onClose} dismissDisabled={pending}
    description="Doctor Area is a saved catalogue link only. It is not the postal address, does not change the current MR, and does not grant coverage or ownership."
    footer={<><button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={onClose} data-testid="button-cancel-area">Keep draft and close</button>
      <button type="button" className="admin-button" disabled={pending || !changed} onClick={() => { setTouched(true); if (!rError) onConfirm(); }} data-testid="button-save-area">{pending ? 'Saving…' : draft.areaId ? 'Save Doctor Area' : 'Clear Doctor Area'}</button></>}>
    <div className="doctor-mapping__dialog">
      <p className="doctor-mapping__hint">Current Doctor Area: <strong>{doctor.areaName ? `${doctor.areaName}${doctor.areaHeadquarterName ? ` · HQ ${doctor.areaHeadquarterName}` : ''}` : 'Not set'}</strong></p>
      <div className="doctor-mapping__field"><MappingReferenceSelect refKind="area" id="mapping-area-choice" label="New Doctor Area" placeholder="Area not set" value={draft.areaId || ''} savedName={doctor.areaName}
        onChange={(areaId) => onDraft({ ...draft, areaId })} testId="select-area-correction" /></div>
      {!changed && <p className="doctor-mapping__hint" role="status">Choose a different Area to save a correction.</p>}
      <ReasonField id="mapping-area-reason" value={draft.reason} onChange={(reason) => onDraft({ ...draft, reason })} error={touched ? rError : ''} />
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}

const KIND = { baseline: 'Opening baseline', initial: 'Initial assignment', transfer: 'MR transfer', area: 'Doctor Area change' };
const areaText = (area) => area ? `${area.name}${area.headquarter ? ` · HQ ${area.headquarter}` : ''}` : 'Not set';

export function HistoryDialog({ doctor, onClose }) {
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const limit = 20;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({ ...old, loading: true, error: '' }));
    doctorAssignmentHistory(doctor.id, { limit, offset }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setState({ items: result.items || [], total: result.total || 0, loading: false, error: '' }); })
      .catch((cause) => { if (!controller.signal.aborted) setState({ items: [], total: 0, loading: false, error: cause.message || 'History could not be loaded.' }); });
    return () => controller.abort();
  }, [doctor.id, offset, revision]);
  return <Dialog title={`Assignment history · ${doctor.name}`} eyebrow={doctor.doctorNumber ? `Doctor ${doctor.doctorNumber}` : 'Doctor'} className="doctor-mapping__history-dialog"
    description="Append-only record of MR and Doctor Area changes, newest first. Names are kept as they were when recorded." onClose={onClose}
    footer={<button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-history">Close</button>}>
    {state.loading ? <div className="doctor-mapping__skeleton" role="status" aria-label="Loading history"><span /><span /><span /></div>
      : state.error ? <div className="admin-feedback admin-feedback--error" role="alert">{state.error} <button type="button" className="doctor-master__text-button" onClick={() => setRevision((n) => n + 1)} data-testid="button-retry-history">Retry</button></div>
        : !state.items.length ? <p className="doctor-mapping__hint" role="status">No assignment events are recorded yet.</p>
          : <ol className="doctor-mapping__timeline" data-testid="list-assignment-history">{state.items.map((event) => {
            const d = event.details || {};
            return <li key={event.id} className={`doctor-mapping__event doctor-mapping__event--${event.kind}`} data-testid={`history-event-${event.id}`}>
              <div className="doctor-mapping__event-head"><strong>{KIND[event.kind] || event.kind}</strong><time dateTime={event.recordedAt}>{event.kind === 'baseline' ? 'Recorded ' : ''}{formatAdminTimestamp(event.recordedAt)}</time></div>
              {event.kind === 'baseline' && <p className="doctor-mapping__hint">Current state captured when history began. Original assignment date and reason are unknown; the time shown is when this baseline was recorded.</p>}
              <dl className="doctor-mapping__event-body">
                {event.kind !== 'area' && <><div><dt>Previous MR</dt><dd>{d.previousMR ? person(d.previousMR) : event.kind === 'baseline' ? 'Unknown' : 'None'}</dd></div><div><dt>New MR</dt><dd>{person(d.newMR)}</dd></div></>}
                {(event.kind === 'area' || d.previousArea || d.newArea) && <><div><dt>Previous Doctor Area</dt><dd>{areaText(d.previousArea)}</dd></div><div><dt>New Doctor Area</dt><dd>{areaText(d.newArea)}</dd></div></>}
                <div><dt>Recorded by</dt><dd>{d.actor?.name || 'System'}</dd></div>
                <div><dt>Reason</dt><dd>{d.reason || '—'}</dd></div>
              </dl>
            </li>;
          })}</ol>}
    {state.total > limit && <div className="doctor-mapping__pager"><button type="button" className="admin-button admin-button--secondary" disabled={offset === 0 || state.loading} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-history-newer">Newer</button>
      <span>{offset + 1}–{Math.min(offset + limit, state.total)} of {state.total}</span>
      <button type="button" className="admin-button admin-button--secondary" disabled={offset + limit >= state.total || state.loading} onClick={() => setOffset(offset + limit)} data-testid="button-history-older">Older</button></div>}
  </Dialog>;
}
