import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { EXTRACT_POLICY, EXTRACT_POSITIONS, extractCategories, loadExtractSettings, saveExtractSettings } from '../../services/serverImmunotherapyExtract.js';
import { DOSES, quantityError } from '../../services/serverImmunotherapy.js';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';

const editable = (rows) => rows.map((row) => ({ extract: row.extract ?? '', dilution: row.dilution ?? '' }));
const equal = (saved, rows) => saved && JSON.stringify(editable(saved.rows)) === JSON.stringify(rows);
const categoryLabel = (category) => `${category.name}${category.status !== 'active' ? ' (inactive)' : ''}`;
const savedQuantity = (value) => value == null || value === '' ? 'Not recorded' : value;
const groupLabel = (size) => ['', 'Single — 1 allergen', 'Double — 2 allergens', 'Triple — 3 allergens'][size];
const rankLabel = (rank) => ['', '1st allergen', '2nd allergen', '3rd allergen'][rank];

export default function ImmunotherapyExtractSettings({ onGuardChange }) {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const owner = session?.user?.id;
  const confirm = usePlatformConfirm();
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState({ items: [], nextOffset: null });
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState('');
  const [listRevision, setListRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [dosage, setDosage] = useState('PD');
  const [saved, setSaved] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const listSequence = useRef(0);
  const listPending = useRef(false);
  const choiceSequence = useRef(0);
  const state = useRef({});
  const dirty = Boolean(rows && !equal(saved, rows));
  state.current = { busy, dirty };

  useEffect(() => {
    setSelected(null); setSaved(null); setRows(null); setError(''); setNotice(''); setBusy(false); setBlocked(false);
    return () => { sequence.current++; choiceSequence.current++; };
  }, [allowed, owner]);
  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    const seq = ++listSequence.current;
    listPending.current = true;
    setListBusy(true); setListError(''); setCategories({ items: [], nextOffset: null });
    const timer = setTimeout(() => extractCategories({ query, limit: 50 }, controller.signal)
      .then((value) => { if (seq === listSequence.current) setCategories(value); })
      .catch((cause) => { if (!controller.signal.aborted && seq === listSequence.current) setListError(cause.message); })
      .finally(() => { if (seq === listSequence.current) { listPending.current = false; setListBusy(false); } }), 200);
    return () => { clearTimeout(timer); controller.abort(); listSequence.current++; };
  }, [allowed, owner, query, listRevision]);
  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy) return false;
      const ok = !state.current.dirty || await confirm('Discard unsaved Immunotherapy Extract & Dilution changes?');
      return ok && !state.current.busy;
    });
    return () => onGuardChange?.(null);
  }, [onGuardChange, confirm]);

  function search(text, retry = false) {
    if (!retry && text === query) return;
    // Invalidate before React effect cleanup, including the picker's search reset.
    listSequence.current++;
    listPending.current = true;
    setCategories({ items: [], nextOffset: null }); setListBusy(true); setListError('');
    if (retry) setListRevision((n) => n + 1);
    else setQuery(text);
  }
  async function more() {
    if (listPending.current || categories.nextOffset === null) return;
    const seq = listSequence.current;
    listPending.current = true;
    setListBusy(true); setListError('');
    try {
      const value = await extractCategories({ query, offset: categories.nextOffset, limit: 50 });
      if (seq === listSequence.current) setCategories((old) => ({ ...value, items: [...old.items, ...value.items.filter((item) => !old.items.some((known) => known.id === item.id))] }));
    } catch (cause) { if (seq === listSequence.current) setListError(cause.message); }
    finally { if (seq === listSequence.current) { listPending.current = false; setListBusy(false); } }
  }
  async function load(category = selected, keep = Boolean(rows), dose = dosage) {
    if (!category || state.current.busy) return;
    const seq = ++sequence.current;
    state.current.busy = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await loadExtractSettings(category.id, dose);
      if (seq !== sequence.current) return;
      setSaved(value);
      if (!keep) setRows(editable(value.rows));
      setBlocked(false);
      if (keep) setNotice('Saved values reloaded; edits retained. Compare beneath each input, or cancel edits to use the saved values.');
    } catch (cause) {
      if (seq === sequence.current) { setError(cause.message); setBlocked(true); }
    } finally { if (seq === sequence.current) { state.current.busy = false; setBusy(false); } }
  }
  async function choose(id, dose = dosage) {
    if (state.current.busy || (id === selected?.id && dose === dosage)) return;
    // Capture the item before the shared picker resets its search/results.
    const category = id === selected?.id ? selected : categories.items.find((item) => item.id === id);
    if (id && !category) return;
    const choice = ++choiceSequence.current;
    if (state.current.dirty) {
      // The menu search input unmounts on choice; give confirmation a stable
      // return target before it captures the currently focused element.
      document.getElementById('imm-extract-category')?.focus();
      if (!(await confirm('Discard unsaved Extract & Dilution changes for this category and dosage?'))) return;
    }
    if (state.current.busy || choice !== choiceSequence.current) return;
    sequence.current++;
    setSelected(category || null); setDosage(dose); setSaved(null); setRows(null); setBlocked(false); setNotice(''); setError('');
    if (category) await load(category, false, dose);
  }
  async function save(event) {
    event.preventDefault();
    if (busy || blocked || !saved || !dirty) return;
    if (rows.some((row) => quantityError(row.extract) || quantityError(row.dilution))) {
      setError('Use up to six whole digits and three decimals in ml. Blank means not recorded; no quantities are calculated.'); return;
    }
    const seq = ++sequence.current;
    state.current.busy = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await saveExtractSettings(selected.id, { policy: EXTRACT_POLICY, dosage, expected_version: saved.version,
        rows: rows.map((row, index) => ({ compositionSize: EXTRACT_POSITIONS[index][0], rank: EXTRACT_POSITIONS[index][1],
          extract: row.extract === '' ? null : row.extract, dilution: row.dilution === '' ? null : row.dilution })) });
      if (seq !== sequence.current) return;
      setSaved(value); setRows(editable(value.rows));
      setNotice('Saved for this category and dosage only. New applicable placements use these values; saved orders are unchanged.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      setError(cause.message);
      if (cause.status === 409 || cause.ambiguous || !cause.status || cause.status >= 500) setBlocked(true);
    } finally { if (seq === sequence.current) { state.current.busy = false; setBusy(false); } }
  }
  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>Immunotherapy — Extract & Dilution</h2><p role="alert">Only Super Admin can configure these shared values.</p></section>;
  const options = categories.items.map((item) => ({ value: item.id, label: categoryLabel(item) }));
  return <section className="admin-panel admin-settings__section imm-extract-settings" aria-busy={busy}>
    <h2>Extract &amp; Dilution</h2>
    <p className="imm-extract-settings__purpose">Set quantities by product category, dosage and allergens in each suborder. Saved orders stay unchanged.</p>
    <div className="imm-extract-settings__categories">
      <div className="imm-extract-settings__field">
        <label htmlFor="imm-extract-category">Product Category</label>
        <AllergenSearchableSelect id="imm-extract-category" label="Product Category" value={selected?.id || ''}
          options={options} selectedLabel={selected ? categoryLabel(selected) : undefined}
          placeholder="Select a category" disabled={busy} onChange={choose} onSearch={search}
          loading={listBusy} error={listError} onRetry={() => search(query, true)}
          hasMore={categories.nextOffset !== null} moreLabel="Load more categories" onMore={more}
          empty={!categories.items.length} />
      </div>
      <div className="imm-extract-settings__field">
        <label htmlFor="imm-extract-dosage">Dosage</label>
        <select id="imm-extract-dosage" value={dosage} disabled={busy} onChange={(event) => {
          if (selected) choose(selected.id, event.target.value);
          else setDosage(event.target.value);
        }}>{DOSES.map((dose) => <option key={dose} value={dose}>{dose}</option>)}</select>
      </div>
    </div>
    {selected && <p className="imm-extract-settings__context"><strong>{selected.name} · {dosage}</strong></p>}
    {busy && <p className="admin-feedback" role="status">Loading or saving…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {rows && <form onSubmit={save}>
      <div className="imm-extract-settings__form-status">
        <p id="imm-extract-help" className="imm-extract-settings__hint">Ranked by Skin Test Result, highest first. Blank means not recorded, not zero.</p>
        <span className="imm-extract-settings__status" role="status">
          {saved?.version === 0 && <span>Not configured</span>}
          {dirty && <span>Unsaved changes</span>}
          {!dirty && saved?.version > 0 && <span>Saved</span>}
        </span>
      </div>
      <fieldset disabled={busy}>
        <legend className="imm-extract-settings__sr-only">Edit ranked quantities</legend>
        <div className="imm-extract-settings__table-wrap" role="region" aria-label="Ranked quantities" tabIndex={0}><table className="imm-extract-settings__table">
          <caption className="imm-extract-settings__sr-only">Ranked Extract &amp; Dilution quantities in ml for {selected.name}, {dosage}</caption>
          <thead><tr><th scope="col">Allergens in suborder</th><th scope="col">Allergen rank</th><th scope="col">Extract (ml)</th><th scope="col">Dilution (ml)</th></tr></thead>
          { [1, 2, 3].map((size) => <tbody key={size}>{rows.map((row, index) => {
            const [count, rank] = EXTRACT_POSITIONS[index];
            if (count !== size) return null;
            return <tr key={index}>
            {rank === 1 && <th scope="rowgroup" rowSpan={size}>{groupLabel(size)}</th>}
            <th scope="row">{rankLabel(rank)}</th>
            {['extract', 'dilution'].map((field) => <td key={field}><input inputMode="decimal" value={row[field]} placeholder="Not recorded" aria-label={`${field === 'extract' ? 'Extract' : 'Dilution'} in ml, ${groupLabel(size)}, ${rankLabel(rank)}, ${dosage}`}
              aria-describedby={`imm-extract-help imm-extract-saved-${index}-${field}`} aria-invalid={Boolean(quantityError(row[field]))} onChange={(event) => { const value = event.target.value; setRows((old) => old.map((item, rank) => rank === index ? { ...item, [field]: value } : item)); setNotice(''); }} />
              <small id={`imm-extract-saved-${index}-${field}`} className="imm-extract-settings__saved-value">Saved: <span>{savedQuantity(saved?.rows[index]?.[field])}</span></small>
            </td>)}
          </tr>; })}</tbody>)}
        </table></div>
      </fieldset>
      {blocked && <p className="admin-feedback admin-feedback--error" role="alert">Your edits were retained. Choose “Reload saved” before saving again, then compare the saved values beneath each input.</p>}
      <div className="imm-extract-settings__actions">
        <button type="submit" className="admin-button" disabled={busy || blocked || !dirty}>Save changes</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || !saved} onClick={() => { setRows(editable(saved.rows)); setNotice('Unsaved edits cancelled.'); setError(''); }}>Cancel edits</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load()}>Reload saved</button>
      </div>
      <p className="imm-extract-settings__hint">Saving affects {selected.name} · {dosage} only.</p>
    </form>}
    {selected && !rows && !busy && <button type="button" className="admin-button" onClick={() => load(selected, false)}>Reload saved</button>}
  </section>;
}
