import { useEffect, useRef, useState } from 'react';
import MRReferenceSelect from './MRReferenceSelect.jsx';
import TerritoryMultiSelect from './TerritoryMultiSelect.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { mrTerritoryChoices } from '../../services/serverMRs.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const choiceDisabled = (item, saved) => item.deleted || (item.status !== 'active' && item.id !== saved);

// Explicit MR coverage: one Zone, optional HQs in that Zone, optional Areas in
// those HQs. Empty lower levels are deliberate broader responsibility.
export default function MRCoverageFields({ mr, values, patch, errors, disabled, onBusyChange }) {
  const confirm = usePlatformConfirm();
  // Area -> parent HQ, from saved assignments and every hydrated reference page.
  const areaParent = useRef(Object.fromEntries((mr?.assignedAreas || []).filter((area) => area.headquarterId).map((area) => [area.id, area.headquarterId])));
  const rememberAreas = (rows) => rows.forEach((row) => { if (row.headquarterId) areaParent.current[row.id] = row.headquarterId; });
  const hqKey = `hq-${values.zoneId}`;
  const areaKey = `area-${values.zoneId}-${values.hqIds.join(',')}`;
  const [hqLoad, setHqLoad] = useState(null);
  const [areaLoad, setAreaLoad] = useState(null);
  const hqState = hqLoad?.key === hqKey ? hqLoad.state : 'loading';
  const areaState = areaLoad?.key === areaKey ? areaLoad.state : 'loading';
  const explicitMode = values.coverageScope !== null;
  const unsettled = explicitMode && Boolean(values.zoneId) && (hqState !== 'ready' || (values.hqIds.length > 0 && areaState !== 'ready'));
  const busyRef = useRef(onBusyChange);
  busyRef.current = onBusyChange;
  useEffect(() => { busyRef.current?.(unsettled); }, [unsettled]);
  useEffect(() => () => busyRef.current?.(false), []);
  const savedZones = mr?.assignedZones?.length ? mr.assignedZones : (mr?.zoneIds || []).map((id) => ({ id, name: id === mr?.zoneId ? mr.zoneName : '' }));
  const savedHQs = mr?.assignedHeadquarters?.length ? mr.assignedHeadquarters
    : mr?.hq ? [{ id: mr.hq, name: mr.hqName }] : [];
  const zoneReq = (kind, params, signal) => mrTerritoryChoices('zones', params, signal);
  const hqReq = (kind, params, signal) => mrTerritoryChoices('headquarters', { ...params, zoneId: values.zoneId }, signal);
  const areaReq = (kind, params, signal) => mrTerritoryChoices('areas', { ...params, zoneId: values.zoneId, hqIds: values.hqIds }, signal);

  async function changeZone(next) {
    if (next === values.zoneId) return;
    const lost = values.hqIds.length + values.areaIds.length;
    const multiple = savedZones.length > 1 && !values.zoneId;
    if ((lost || multiple) && !await confirm(`${multiple ? 'Choosing one Zone replaces all saved Zone assignments when you save. ' : ''}Changing the Zone clears ${plural(values.hqIds.length, 'selected HQ')} and ${plural(values.areaIds.length, 'selected Area')}. Coverage becomes Entire Zone until you choose again.`, { actionLabel: 'Change Zone and clear' })) return;
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

  return <div className="mr-form__field mr-form__field--wide territory-panel" data-testid="mr-coverage">
    <div className="territory-panel__grid">
      <div className="territory-panel__level">
        <label className="mr-form__label" htmlFor="mr-zoneId">Zone <span className="mr-form__required" aria-hidden="true">*</span></label>
        <MRReferenceSelect id="mr-zoneId" kind="zones" label="Zone" value={values.zoneId} savedName={savedZones.find((zone) => zone.id === values.zoneId)?.name || (values.zoneId === mr?.zoneId ? mr?.zoneName : undefined)}
          onChange={changeZone} requestChoices={zoneReq} placeholder="Select one Zone" required disabled={disabled}
          isDisabled={choiceDisabled} invalid={Boolean(errors.zoneId)} describedBy={errors.zoneId ? 'mr-zoneId-error' : undefined}
          emptyGuidance="No Zones available. Add one in Zone Master first." testId="select-mr-zone" />
        {errors.zoneId && <p id="mr-zoneId-error" className="mr-form__error" role="alert">{errors.zoneId}</p>}
        {savedZones.length > 1 && !values.zoneId && <p className="mr-form__hint">Saved Zones: {savedZones.map((zone) => zone.name || 'Unavailable Zone').join(', ')}. Choose one Zone before changing territory. Unrelated edits keep all saved assignments.</p>}
      </div>
      <div className="territory-panel__level">
        <div className="territory-panel__level-head"><label className="mr-form__label" htmlFor="mr-hqIds">HQs <span className="territory-panel__opt">optional</span></label>
          {values.hqIds.length > 0 && <button type="button" className="territory-panel__clear" disabled={disabled || !values.zoneId} onClick={() => clearAll('hqs')}>Clear all</button>}</div>
        <TerritoryMultiSelect scopeKey={hqKey} id="mr-hqIds" kind="headquarters" label="HQs" noun="HQ" values={values.hqIds}
          savedChoices={savedHQs} requestChoices={hqReq} disabled={disabled || !values.zoneId}
          disabledReason={values.zoneId ? '' : 'Choose a Zone first.'} onAdd={(id) => patch({ hqIds: [...values.hqIds, id] })} onRemove={removeHQ} onStateChange={(state) => setHqLoad({ key: hqKey, state })}
          invalid={Boolean(errors.hqIds)} emptyGuidance="No HQs in this Zone." />
        {(errors.hqIds || errors.hq) && <p className="mr-form__error" role="alert">{errors.hqIds || errors.hq}</p>}
      </div>
      <div className="territory-panel__level">
        <div className="territory-panel__level-head"><label className="mr-form__label" htmlFor="mr-areaIds">Areas <span className="territory-panel__opt">optional</span></label>
          {values.areaIds.length > 0 && <button type="button" className="territory-panel__clear" disabled={disabled || !values.zoneId} onClick={() => clearAll('areas')}>Clear all</button>}</div>
        <TerritoryMultiSelect scopeKey={areaKey} id="mr-areaIds" kind="areas" label="Areas" noun="Area" values={values.areaIds}
          savedChoices={mr?.assignedAreas || []} requestChoices={areaReq} disabled={disabled || !values.zoneId || !values.hqIds.length}
          disabledReason={!values.zoneId ? 'Choose a Zone first.' : values.hqIds.length ? '' : 'Areas require at least one selected HQ.'} onAdd={(id) => patch({ areaIds: [...values.areaIds, id] })} onRemove={removeArea} onKnown={rememberAreas} onStateChange={(state) => setAreaLoad({ key: areaKey, state })}
          invalid={Boolean(errors.areaIds)} emptyGuidance="No Areas in the selected HQs." />
        {errors.areaIds && <p className="mr-form__error" role="alert">{errors.areaIds}</p>}
      </div>
    </div>
  </div>;
}
