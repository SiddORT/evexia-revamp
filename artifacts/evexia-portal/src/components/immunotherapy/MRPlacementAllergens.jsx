import { Fragment, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import SearchableSelect from '../admin/SearchableSelect.jsx';
import { request, skinResultError } from '../../services/serverImmunotherapy.js';
import { arrangeMRSelections, hasGroupingMetadata } from '../../services/immunotherapyGrouping.js';

export default function MRPlacementAllergens({ groups, onChange, entries, setEntries, allergens, disabled, dosage, errors }) {
  const [message, setMessage] = useState('');
  const [metadataError, setMetadataError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const items = groups.flatMap((g) => g.items);
  const missing = [...new Set([...items, ...Object.values(entries)]
    .filter((i) => i.allergenId && !hasGroupingMetadata(i.allergen)).map((i) => i.allergenId))].sort().join(',');
  // Old incomplete drafts may not have eligibility metadata. Hydrate only their
  // explicitly selected UUIDs, at bounded concurrency; never walk the catalogue.
  useEffect(() => {
    if (!missing || disabled) {
      setLoading(false);
      if (!missing) setMetadataError('');
      return undefined;
    }
    const controller = new AbortController();
    const ids = missing.split(','), found = new Map();
    setLoading(true); setMetadataError('');
    async function hydrate() {
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (index < ids.length && !controller.signal.aborted) {
          const id = ids[index++];
          const page = await request('/references/allergens', { params: { selected: id, limit: 1 }, signal: controller.signal });
          const a = page.items.find((item) => item.id === id);
          if (!hasGroupingMetadata(a)) throw new Error('A selected allergen is unavailable. Remove it or select a current reference.');
          found.set(id, a);
        }
      }));
      if (!controller.signal.aborted) {
        onChange((current) => arrangeMRSelections(current.flatMap((g) => g.items)
          .map((i) => found.has(i.allergenId) ? { ...i, allergen: found.get(i.allergenId) } : i)));
        setEntries((current) => Object.fromEntries(Object.entries(current).map(([key, entry]) => [
          key, found.has(entry.allergenId) ? { ...entry, allergen: found.get(entry.allergenId) } : entry,
        ])));
      }
    }
    hydrate().catch((cause) => {
      if (!controller.signal.aborted) {
        setMetadataError(cause.message); setLoading(false);
        controller.abort();
      }
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [missing, disabled, revision]);
  const pending = Object.entries(entries).filter(([, e]) => e.allergenId || e.result);
  const entryRows = pending.length ? pending : [['mr-placement', { allergenId: '', result: '' }]];
  const options = allergens.items.map((a) => ({ value: a.id, label: a.name }));
  function add(key, entry) {
    const problem = !dosage ? 'Choose a dosage before adding an allergen.'
      : !entry.allergenId || !hasGroupingMetadata(entry.allergen) ? 'Select an available Allergen Name with category and Mix metadata.'
        : skinResultError(entry.result || '') || (items.length >= 1000 ? 'Use at most 1,000 allergen items per order.' : '');
    if (problem) { setMessage(problem); return; }
    const selectionOrder = Math.max(-1, ...items.map((i) => i.selectionOrder ?? 0)) + 1;
    onChange(arrangeMRSelections([...items, { allergenId: entry.allergenId, result: entry.result, allergen: entry.allergen, selectionOrder }]));
    setEntries((current) => { const next = { ...current }; delete next[key]; return next; });
    setMessage('');
  }
  return <div className="imm-allergen-results">
    {entryRows.map(([key, entry], index) => {
      const update = (patch) => setEntries((current) => ({ ...current, [key]: { ...entry, ...patch } }));
      return <div className="imm-allergen-entry" key={key}>
        <div className="imm-field"><label htmlFor={`imm-placement-allergen-${index}`}>Allergen Name</label>
          <SearchableSelect viewportMenu id={`imm-placement-allergen-${index}`} label="Allergen Name" value={entry.allergenId}
            options={options} onSearch={allergens.onSearch} searchOptions={() => options} disabled={disabled || !dosage || loading}
            onChange={(id) => update({ allergenId: id, allergen: allergens.items.find((a) => a.id === id) })} placeholder="Select allergen" /></div>
        <label className="imm-field">Skin Test Result (mm)<input inputMode="decimal" required value={entry.result}
          disabled={disabled || !dosage || loading} onChange={(e) => update({ result: e.target.value })} /></label>
        <button type="button" className="admin-button" disabled={disabled || !dosage || loading} onClick={() => add(key, entry)}><Plus size={15} aria-hidden="true" />Add</button>
        {(entry.allergenId || entry.result) && <button type="button" className="imm-link-btn" disabled={disabled} onClick={() => setEntries((current) => { const next = { ...current }; delete next[key]; return next; })}>Clear entry</button>}
      </div>;
    })}
    {message && <p className="imm-error" role="alert">{message}</p>}
    {loading && <p role="status">Loading grouping metadata for saved draft selections…</p>}
    {metadataError && <div role="alert"><p>{metadataError} No selected results have been discarded.</p><button type="button" className="imm-link-btn" disabled={disabled || loading} onClick={() => setRevision((n) => n + 1)}>Retry grouping metadata</button></div>}
    {!items.length && <p className="imm-hint">No allergens added.</p>}
    {groups.filter((g) => g.items.length).map((g, gi) => <Fragment key={g.id}>
      {errors[`group-${g.id}`] && <p className="imm-error" role="alert">{errors[`group-${g.id}`]}</p>}
      {g.items.map((item, ii) => {
        const ek = `result-${g.id}-${item.allergenId}`;
        return <div className="imm-item" key={`${item.allergenId}-${ii}`}>
          <div className="imm-item__name">{item.allergen?.name || 'Saved allergen'}
            {item.allergen?.concentration?.trim() && <span className="imm-cell-sub">Concentration: {item.allergen.concentration}</span>}
            {!hasGroupingMetadata(item.allergen) && <span className="imm-cell-sub">Grouping metadata pending</span>}</div>
          <div className="imm-field"><label htmlFor={`imm-r-${gi}-${ii}`}>Skin Test Result (mm)</label>
            <input id={`imm-r-${gi}-${ii}`} inputMode="decimal" required value={item.result} disabled={disabled || loading}
              aria-invalid={Boolean(errors[ek])} aria-describedby={errors[ek] ? `${ek}-err` : undefined}
              onChange={(e) => onChange(groups.map((group) => group.id !== g.id ? group : { ...group, items: group.items.map((i, index) => index === ii ? { ...i, result: e.target.value } : i) }))} />
            {errors[ek] && <p id={`${ek}-err`} className="imm-error" role="alert">{errors[ek]}</p>}</div>
          {!disabled && <button type="button" className="admin-icon-button admin-icon-button--danger" disabled={loading} aria-label={`Remove unsaved ${item.allergen?.name || 'allergen'}`}
            onClick={() => onChange(arrangeMRSelections(groups.flatMap((group) => group.items.filter((_, index) => group.id !== g.id || index !== ii))))}><Trash2 size={16} aria-hidden="true" /></button>}
        </div>;
      })}
    </Fragment>)}
  </div>;
}
