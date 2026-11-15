import { useEffect, useRef, useState } from 'react';
import MRReferenceSelect from './MRReferenceSelect.jsx';
import TerritoryMultiSelect from './TerritoryMultiSelect.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { COVERAGE_LABEL, coverageScopeOf, mrTerritoryChoices } from '../../services/serverMRs.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const choiceDisabled = (item, saved) => item.deleted || (item.status !== 'active' && item.id !== saved);

// Explicit MR coverage: one Zone, optional HQs in that Zone, optional Areas in
// those HQs. Empty lower levels are deliberate broader responsibility.
export default function MRCoverageFields({ mr, values, patch, errors, disabled, onBusyChange }) {
  const confirm = usePlatformConfirm();
  // Area -> parent HQ, from saved assignments and every hydrated reference page.
  const areaParent = useRef(Object.fromEntries((mr?.assignedAreas || []).filter((area) => area.headquarterId).map((area) => [area.id, area.headquarterId])));
  const rememberAreas = (rows) => rows.forEach((row) => { if (row.headquarterId) areaParent.current[row.id] = row.headquarterId; });
  const [hqState, setHqState] = useState('loading');
  const [areaState, setAreaState] = useState('loading');
  const explicitMode = values.coverageScope !== null;
  const unsettled = explicitMode && Boolean(values.zoneId) && (hqState !== 'ready' || (values.hqIds.length > 0 && areaState !== 'ready'));
  const busyRef = useRef(onBusyChange);
  busyRef.current = onBusyChange;
  useEffect(() => { busyRef.current?.(unsettled); }, [unsettled]);
  useEffect(() => () => busyRef.current?.(false), []);
  const legacy = values.coverageScope === null;
  const scope = coverageScopeOf(values);
  const zoneReq = (kind, params, signal) => mrTerritoryChoices('zones', params, signal);
  const hqReq = (kind, params, signal) => mrTerritoryChoices('headquarters', { ...params, zoneId: values.zoneId }, signal);
  const areaReq = (kind, params, signal) => mrTerritoryChoices('areas', { ...params, zoneId: values.zoneId, hqIds: values.hqIds }, signal);

  async function adopt() {
    if (!await confirm('Adopt explicit coverage? You will choose exactly one Zone and review HQs and Areas. Nothing is saved until you save this MR; cancel the form to keep the legacy assignment.', { actionLabel: 'Review explicit coverage' })) return;
    patch({ coverageScope: 'zone', zoneId: '', zoneIds: [], hqIds: [], areaIds: [] });
  }
  async function revertLegacy() {
    if (!await confirm('Discard the explicit coverage draft and keep the saved legacy assignment unchanged?', { actionLabel: 'Keep legacy assignment' })) return;
    patch({ coverageScope: null, zoneId: String(mr?.zoneId ?? ''), zoneIds: [...(mr?.zoneIds || (mr?.zoneId ? [mr.zoneId] : []))], hqIds: [...(mr?.hqIds || [])], areaIds: [...(mr?.areaIds || [])], hq: String(mr?.hq ?? '') });
  }
  async function changeZone(next) {
    if (next === values.zoneId) return;
    const lost = values.hqIds.length + values.areaIds.length;
    if (lost && !await confirm(`Changing the Zone clears ${plural(values.hqIds.length, 'selected HQ')} and ${plural(values.areaIds.length, 'selected Area')}, because they belong to the previous Zone. Coverage becomes Entire Zone until you choose again.`, { actionLabel: 'Change Zone and clear' })) return;
    patch({ zoneId: next, zoneIds: next ? [next] : [], hqIds: [], areaIds: [] });
  }
  async function removeHQ(id) {
    const rest = values.hqIds.filter((value) => value !== id);
    if (values.areaIds.length) {
      const unknown = values.areaIds.filter((area) => !areaParent.current[area]);
      if (unknown.length) {
        if (!await confirm(`The parent HQ of ${plural(unknown.length, 'selected Area')} is not known, so removing this HQ clears all ${plural(values.areaIds.length, 'selected Area')} for review.${rest.length ? ' Coverage broadens from Selected Areas only to Entire selected HQs.' : ' With no HQs left, coverage broadens to the Entire Zone.'}`, { actionLabel: 'Remove HQ and clear Areas' })) return;
        patch({ hqIds: rest, areaIds: [] });
        return;
      }
      const keptAreas = values.areaIds.filter((area) => areaParent.current[area] !== id);
      const dropped = values.areaIds.length - keptAreas.length;
      if (!keptAreas.length) {
        if (!await confirm(`Removing this HQ also removes its ${plural(dropped, 'selected Area')}. No Areas remain, so coverage broadens from Selected Areas only to ${rest.length ? `the Entire ${plural(rest.length, 'selected HQ')}` : 'the Entire Zone'}.`, { actionLabel: 'Remove and broaden' })) return;
      } else if (dropped && !await confirm(`Removing this HQ also removes its ${plural(dropped, 'selected Area')}. Coverage stays Selected Areas only.`, { actionLabel: 'Remove HQ and its Areas' })) return;
      patch({ hqIds: rest, areaIds: keptAreas });
      return;
    }
    if (!rest.length && !await confirm('Removing the last HQ broadens this MR\u2019s responsibility to the Entire Zone.', { actionLabel: 'Broaden to Entire Zone' })) return;
    patch({ hqIds: rest });
  }
  async function removeArea(id) {
    const rest = values.areaIds.filter((value) => value !== id);
    if (!rest.length && !await confirm(`Removing the last Area broadens this MR\u2019s responsibility to the entire ${plural(values.hqIds.length, 'selected HQ')}.`, { actionLabel: 'Broaden to selected HQs' })) return;
    patch({ areaIds: rest });
  }
  async function clearAll(kind) {
    const areas = kind === 'areas';
    const n = areas ? values.areaIds.length : values.hqIds.length;
    if (!n) return;
    const text = areas ? `Clear all ${plural(n, 'Area')}? Coverage broadens to Entire selected HQs.`
      : `Clear all ${plural(n, 'HQ')}${values.areaIds.length ? ` and ${plural(values.areaIds.length, 'Area')}` : ''}? Coverage broadens to the Entire Zone.`;
    if (!await confirm(text, { actionLabel: 'Clear and broaden' })) return;
    patch(areas ? { areaIds: [] } : { hqIds: [], areaIds: [] });
  }

  if (legacy) {
    const zones = mr?.assignedZones?.length ? mr.assignedZones : (mr?.zoneIds || []).map((id) => ({ id, name: id === mr?.zoneId ? mr.zoneName : '' }));
    return <div className="mr-form__field mr-form__field--wide territory-panel territory-panel--legacy" data-testid="mr-coverage-legacy">
      <p className="territory-panel__eyebrow">Legacy assignment</p>
      <p className="territory-panel__title">Coverage scope not yet reviewed</p>
      <dl className="territory-panel__facts">
        <div><dt>Saved Zones</dt><dd>{zones.length ? zones.map((zone) => zone.name || 'Unavailable Zone').join(', ') : 'None saved'}</dd></div>
        <div><dt>Saved HQ</dt><dd>{mr?.hqName || (values.hq ? 'Unavailable HQ' : 'None saved')}</dd></div>
      </dl>
      <p className="mr-form__hint">This record predates explicit territory coverage. Saving unrelated changes keeps every saved Zone and HQ exactly as they are; no Zone, HQ or Area is inferred. To change territory, adopt explicit coverage and choose one Zone.</p>
      {(errors.zoneId || errors.hq) && <p className="mr-form__error" role="alert">{errors.zoneId || errors.hq} The saved legacy assignment is incomplete; adopt explicit coverage to fix it.</p>}
      <button type="button" className="admin-button admin-button--secondary" disabled={disabled} onClick={adopt} data-testid="button-adopt-coverage">Adopt explicit coverage</button>
    </div>;
  }

  return <div className="mr-form__field mr-form__field--wide territory-panel" data-testid="mr-coverage">
    <div className="territory-panel__grid">
      <div className="territory-panel__level">
        <label className="mr-form__label" htmlFor="mr-zoneId">Zone <span className="mr-form__required" aria-hidden="true">*</span></label>
        <MRReferenceSelect id="mr-zoneId" kind="zones" label="Zone" value={values.zoneId} savedName={mr?.coverageScope ? mr?.zoneName : undefined}
          onChange={changeZone} requestChoices={zoneReq} placeholder="Select one Zone" required disabled={disabled}
          isDisabled={choiceDisabled} invalid={Boolean(errors.zoneId)} describedBy={errors.zoneId ? 'mr-zoneId-error' : undefined}
          emptyGuidance="No Zones available. Add one in Zone Master first." testId="select-mr-zone" />
        {errors.zoneId && <p id="mr-zoneId-error" className="mr-form__error" role="alert">{errors.zoneId}</p>}
      </div>
      <div className="territory-panel__level">
        <div className="territory-panel__level-head"><label className="mr-form__label" htmlFor="mr-hqIds">HQs <span className="territory-panel__opt">optional</span></label>
          {values.hqIds.length > 0 && <button type="button" className="territory-panel__clear" disabled={disabled} onClick={() => clearAll('hqs')}>Clear all</button>}</div>
        <TerritoryMultiSelect scopeKey={`hq-${values.zoneId}`} id="mr-hqIds" kind="headquarters" label="HQs" noun="HQ" values={values.hqIds}
          savedChoices={mr?.assignedHeadquarters || []} requestChoices={hqReq} disabled={disabled || !values.zoneId}
          disabledReason={values.zoneId ? '' : 'Choose a Zone first.'} onAdd={(id) => patch({ hqIds: [...values.hqIds, id] })} onRemove={removeHQ} onStateChange={setHqState}
          invalid={Boolean(errors.hqIds)} emptyGuidance="No HQs in this Zone." />
        {errors.hqIds && <p className="mr-form__error" role="alert">{errors.hqIds}</p>}
      </div>
      <div className="territory-panel__level">
        <div className="territory-panel__level-head"><label className="mr-form__label" htmlFor="mr-areaIds">Areas <span className="territory-panel__opt">optional</span></label>
          {values.areaIds.length > 0 && <button type="button" className="territory-panel__clear" disabled={disabled} onClick={() => clearAll('areas')}>Clear all</button>}</div>
        <TerritoryMultiSelect scopeKey={`area-${values.zoneId}-${values.hqIds.join(',')}`} id="mr-areaIds" kind="areas" label="Areas" noun="Area" values={values.areaIds}
          savedChoices={mr?.assignedAreas || []} requestChoices={areaReq} disabled={disabled || !values.hqIds.length}
          disabledReason={values.hqIds.length ? '' : 'Areas require at least one selected HQ.'} onAdd={(id) => patch({ areaIds: [...values.areaIds, id] })} onRemove={removeArea} onKnown={rememberAreas} onStateChange={setAreaState}
          invalid={Boolean(errors.areaIds)} emptyGuidance="No Areas in the selected HQs." />
        {errors.areaIds && <p className="mr-form__error" role="alert">{errors.areaIds}</p>}
      </div>
    </div>
    <div className={`territory-summary territory-summary--${scope}`} role="status" aria-live="polite" data-testid="text-mr-coverage-summary">
      <span className="territory-summary__label">Responsibility</span>
      <strong>{unsettled ? 'Not confirmed' : COVERAGE_LABEL[scope]}</strong>
      <span>{unsettled ? ((hqState === 'error' || areaState === 'error') ? 'HQ or Area choices could not be loaded. Retry them before saving; scope is never inferred from a failed load.' : 'Loading HQ and Area choices. Saving waits until they load.')
        : !values.zoneId ? 'Choose a Zone to define responsibility.'
        : scope === 'zone' ? 'Every HQ and Area in the selected Zone. No HQs or Areas are selected, deliberately.'
          : scope === 'hq' ? `All Areas within ${plural(values.hqIds.length, 'selected HQ')}.`
            : `Only ${plural(values.areaIds.length, 'selected Area')}. Selected HQs without a chosen Area grant no whole-HQ responsibility.`}</span>
    </div>
    {mr && mr.coverageScope === null && <button type="button" className="territory-panel__clear" disabled={disabled} onClick={revertLegacy}>Keep legacy assignment instead</button>}
  </div>;
}
