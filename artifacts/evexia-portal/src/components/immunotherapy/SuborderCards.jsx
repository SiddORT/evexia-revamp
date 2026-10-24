import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import SearchableSelect from '../admin/SearchableSelect.jsx';
import { DOSES, skinResultError } from '../../services/serverImmunotherapy.js';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';

// Canonical suborder cards: header SUB id + MRP, expandable rows. No bottle UI.
export default function SuborderCards({ groups, onChange, errors, disabled, readOnly, admin, allergenOptions, allergens, allergenList, dosage, entries, setEntries, onUpdate }) {
  const [open, setOpen] = useState(() => new Set(groups.slice(0, 1).map((g) => g.id)));
  const confirm = usePlatformConfirm();
  const [msg, setMsg] = useState({});
  useEffect(() => {
    setOpen((current) => new Set([...current, ...groups.filter((g) => Object.keys(errors).some((k) => k.includes(g.id))).map((g) => g.id)]));
  }, [errors]);
  const upd = (gid, fn) => onChange(groups.map((g) => g.id === gid ? fn(g) : g));
  const updItem = (gid, aid, patch) => upd(gid, (g) => ({ ...g, items: g.items.map((i) => i.allergenId === aid ? { ...i, ...patch } : i) }));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  function add(g) {
    const e = entries[g.id] || {};
    const problem = !DOSES.includes(dosage) ? 'Choose a dosage before adding an allergen.' : !e.allergenId || !e.allergen ? 'Select an Allergen Name.'
      : skinResultError(e.result || '') || (g.items.some((i) => i.allergenId === e.allergenId) ? 'Duplicate allergens within a suborder are not allowed.' : '')
        || (g.items.length >= 100 ? 'Use at most 100 children in one SUB.' : '')
        || (groups.reduce((n, x) => n + x.items.length, 0) >= 1000 ? 'Use at most 1,000 children per order.' : '');
    if (problem) { setMsg((m) => ({ ...m, [g.id]: problem })); return; }
    setMsg((m) => ({ ...m, [g.id]: '' }));
    upd(g.id, (x) => ({ ...x, items: [...x.items, { allergenId: e.allergenId, result: e.result, allergen: e.allergen, extract: null, dilution: null }] }));
    setEntries((s) => ({ ...s, [g.id]: { allergenId: '', result: '' } }));
  }
  async function remove(g, it) {
    if (g.items.length <= 1) return;
    if (!(await confirm(`Remove ${it.allergen?.name || 'this allergen'} from ${g.id}? The change applies only after saving the order.`, { title: 'Remove allergen?', actionLabel: 'Remove allergen' }))) return;
    upd(g.id, (x) => ({ ...x, items: x.items.filter((y) => y.allergenId !== it.allergenId) }));
    requestAnimationFrame(() => document.getElementById(`imm-sub-toggle-${g.id}`)?.focus());
  }
  return <div className="imm-sub-list" data-testid="list-imm-suborders">
    {groups.map((g, gi) => {
      const isOpen = open.has(g.id); const e = entries[g.id] || { allergenId: '', result: '' };
      return <div className="imm-sub" key={g.id} data-testid={`card-imm-suborder-${gi}`}>
        <div className="imm-sub__head">
          <button type="button" id={`imm-sub-toggle-${g.id}`} className="imm-sub__toggle" aria-expanded={isOpen} aria-controls={`imm-sub-body-${gi}`} onClick={() => toggle(g.id)} data-testid={`button-imm-sub-toggle-${gi}`}>
            <span className="imm-sub__id">Suborder Id : <b>{g.id}</b></span>
            <ChevronDown size={16} aria-hidden="true" className={isOpen ? 'imm-sub__chev imm-sub__chev--open' : 'imm-sub__chev'} />
          </button>
          {admin && <label className="imm-sub__mrp">MRP (INR)
            <input id={`imm-mrp-${g.id}`} inputMode="decimal" value={g.mrp ?? ''} disabled={disabled || readOnly} placeholder="Not recorded" aria-label={`MRP in INR for ${g.id}`} aria-invalid={Boolean(errors[`mrp-${g.id}`])} aria-describedby={errors[`mrp-${g.id}`] ? `imm-mrp-error-${gi}` : undefined}
              onChange={(ev) => upd(g.id, (x) => ({ ...x, mrp: ev.target.value }))} data-testid={`input-imm-mrp-${gi}`} /></label>}
        </div>
        {errors[`mrp-${g.id}`] && <p className="imm-error" id={`imm-mrp-error-${gi}`} role="alert">{errors[`mrp-${g.id}`]}</p>}
        {isOpen && <div className="imm-sub__body" id={`imm-sub-body-${gi}`}>
          <div className="imm-sub__table" role="table" aria-label={`Allergens in suborder ${g.id}`}>
            <div className="imm-sub__row imm-sub__row--head" role="row">{['Sr. No.', 'Allergen Name', 'Skin Test Result (mm)', 'Available quantity', 'Extract (ml)', 'Dilution (ml)', 'Action'].map((h) => <span role="columnheader" key={h}>{h}</span>)}</div>
            {g.items.map((it, ii) => { const k = `${g.id}-${it.allergenId}`; const rk = `result-${k}`;
              return <div className="imm-sub__row" role="row" key={it.allergenId}>
                <span role="cell" data-label="Sr. No.">{ii + 1}</span>
                <span role="cell" data-label="Allergen" className="imm-sub__name">{it.allergen?.name || allergenList.find((a) => a.id === it.allergenId)?.name || 'Saved allergen'}</span>
                <span data-label="Skin Test Result (mm)">{disabled || readOnly ? it.result : <input inputMode="decimal" id={`imm-r-${gi}-${ii}`} aria-label={`Skin test result in mm for ${it.allergen?.name || 'allergen'} in ${g.id}`} value={it.result} aria-invalid={Boolean(errors[rk])} onChange={(ev) => updItem(g.id, it.allergenId, { result: ev.target.value })} />}{errors[rk] && <em className="imm-error" role="alert">{errors[rk]}</em>}</span>
                <span data-label="Available quantity">Unavailable</span>
                {['extract', 'dilution'].map((f) => <span data-label={f === 'extract' ? 'Extract (ml)' : 'Dilution (ml)'} key={f}>{admin ? <>
                  <input inputMode="decimal" id={`imm-${f}-${k}`} aria-label={`${f} quantity in ml for ${it.allergen?.name || 'allergen'} in ${g.id}`} value={it[f] ?? ''} disabled={disabled || readOnly} placeholder="Not recorded" aria-invalid={Boolean(errors[`${f}-${k}`])} onChange={(ev) => updItem(g.id, it.allergenId, { [f]: ev.target.value })} data-testid={`input-imm-${f}-${gi}-${ii}`} />
                  {errors[`${f}-${k}`] && <em className="imm-error" role="alert">{errors[`${f}-${k}`]}</em>}</> : 'Admin review'}</span>)}
                <span data-label="Action">{!disabled && !readOnly && g.items.length > 1 && <button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove ${it.allergen?.name || 'allergen'} from suborder ${g.id}`} onClick={() => remove(g, it)}><Trash2 size={16} aria-hidden="true" /></button>}</span>
              </div>; })}
          </div>
          {!disabled && !readOnly && <div className="imm-allergen-entry">
            <div className="imm-field"><label htmlFor={`imm-add-${gi}`}>Allergen Name</label>
              <SearchableSelect viewportMenu id={`imm-add-${gi}`} label={`Allergen Name for suborder ${g.id}`} value={e.allergenId} options={allergenOptions} onSearch={allergens.onSearch} searchOptions={() => allergenOptions}
                onChange={(aid) => setEntries((s) => ({ ...s, [g.id]: { ...e, allergenId: aid, allergen: allergenList.find((a) => a.id === aid) } }))} placeholder="Select allergen" disabled={!dosage} /></div>
            <label className="imm-field">Skin Test Result (mm)<input inputMode="decimal" required value={e.result} disabled={!dosage} onChange={(ev) => setEntries((s) => ({ ...s, [g.id]: { ...e, result: ev.target.value } }))} /></label>
            <button type="button" className="admin-button" disabled={!dosage} onClick={() => add(g)} data-testid={`button-imm-add-allergen-${gi}`}><Plus size={15} aria-hidden="true" />Add Allergen</button>
            {(e.allergenId || e.result) && <button type="button" className="imm-link-btn" onClick={() => setEntries((s) => ({ ...s, [g.id]: { allergenId: '', result: '' } }))}>Clear entry</button>}
          </div>}
          {admin && !readOnly && <div className="imm-sub__update"><p className="imm-hint">Update saves this SUB’s MRP and all other pending order edits together, without a separate pricing approval. Extract and dilution may remain blank in a draft. Changes are saved only after the server confirms success; order status stays unchanged.</p><button type="button" className="admin-button" disabled={disabled} onClick={onUpdate} aria-label={`Update ${g.id} and all pending order edits`}>Update</button></div>}
          {msg[g.id] && <p className="imm-error" role="alert">{msg[g.id]}</p>}
          {errors[`group-${g.id}`] && <p className="imm-error" role="alert">{errors[`group-${g.id}`]}</p>}
        </div>}
      </div>; })}
  </div>;
}
