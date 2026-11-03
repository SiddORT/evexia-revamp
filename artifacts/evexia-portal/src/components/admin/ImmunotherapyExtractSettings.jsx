import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { extractCategories, loadExtractSettings, saveExtractSettings } from '../../services/serverImmunotherapyExtract.js';
import { quantityError } from '../../services/serverImmunotherapy.js';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';

const editable = (rows) => rows.map((row) => ({ extract: row.extract ?? '', dilution: row.dilution ?? '' }));
const equal = (saved, rows) => saved && JSON.stringify(editable(saved.rows)) === JSON.stringify(rows);
const categoryLabel = (category) => `${category.name}${category.status !== 'active' ? ' (inactive)' : ''}`;
const savedQuantity = (value) => value == null || value === '' ? 'Not recorded' : value;

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
  async function load(category = selected, keep = Boolean(rows)) {
    if (!category || state.current.busy) return;
    const seq = ++sequence.current;
    state.current.busy = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await loadExtractSettings(category.id);
      if (seq !== sequence.current) return;
      setSaved(value);
      if (!keep) setRows(editable(value.rows));
      setBlocked(false);
      if (keep) setNotice('Saved version loaded. Your edits are kept. Compare the saved values table with your editable values before saving, or cancel edits to use the saved values.');
    } catch (cause) {
      if (seq === sequence.current) { setError(cause.message); setBlocked(true); }
    } finally { if (seq === sequence.current) { state.current.busy = false; setBusy(false); } }
  }
  async function choose(id) {
    if (state.current.busy || id === selected?.id) return;
    // Capture the item before the shared picker resets its search/results.
    const category = categories.items.find((item) => item.id === id);
    if (id && !category) return;
    const choice = ++choiceSequence.current;
    if (state.current.dirty) {
      // The menu search input unmounts on choice; give confirmation a stable
      // return target before it captures the currently focused element.
      document.getElementById('imm-extract-category')?.focus();
      if (!(await confirm('Discard unsaved Extract & Dilution changes for this category?'))) return;
    }
    if (state.current.busy || choice !== choiceSequence.current) return;
    setSelected(category || null); setSaved(null); setRows(null); setBlocked(false); setNotice(''); setError('');
    if (category) await load(category, false);
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
      const value = await saveExtractSettings(selected.id, { expected_version: saved.version,
        rows: rows.map((row) => ({ extract: row.extract === '' ? null : row.extract, dilution: row.dilution === '' ? null : row.dilution })) });
      if (seq !== sequence.current) return;
      setSaved(value); setRows(editable(value.rows));
      setNotice('Shared settings saved. Only new applicable final placements use these values; saved orders are unchanged.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      setError(cause.message);
      if (cause.status === 409 || cause.ambiguous || !cause.status || cause.status >= 500) setBlocked(true);
    } finally { if (seq === sequence.current) { state.current.busy = false; setBusy(false); } }
  }
  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>Immunotherapy — Extract & Dilution</h2><p role="alert">Only Super Admin can configure these shared values.</p></section>;
  const options = categories.items.map((item) => ({ value: item.id, label: categoryLabel(item) }));
  return <section className="admin-panel admin-settings__section imm-extract-settings" aria-busy={busy}>
    <h2>Immunotherapy — Extract & Dilution</h2>
    <p>Set shared quantities by category for new applicable placements. Saved orders are unchanged.</p>
    <details className="imm-extract-settings__disclosure">
      <summary>Ranking &amp; entry guidance</summary>
      <p id="imm-extract-precision">Use up to six whole digits and three decimal places in ml. No quantities are prefilled or calculated. Incomplete rows are allowed; missing order quantities need Admin completion before approval.</p>
      <p>New MR category/Mix bottles rank allergens by numeric Skin Test Result, highest first, within each existing bottle. Ties keep their order. One allergen uses rank 1; two use ranks 1–2; three use all ranks. Overflow bottles and No Mix restart at rank 1. Admin can edit saved quantities; order approval remains explicit.</p>
    </details>
    <div className="imm-extract-settings__categories">
      <div className="imm-extract-settings__field">
        <label htmlFor="imm-extract-category">Saved category</label>
        <AllergenSearchableSelect id="imm-extract-category" label="Saved category" value={selected?.id || ''}
          options={options} selectedLabel={selected ? categoryLabel(selected) : undefined}
          placeholder="Select a category" disabled={busy} onChange={choose} onSearch={search}
          loading={listBusy} error={listError} onRetry={() => search(query, true)}
          hasMore={categories.nextOffset !== null} moreLabel="Load more categories" onMore={more}
          empty={!categories.items.length} />
      </div>
    </div>
    {busy && <p role="status">Loading or saving shared settings…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {rows && <form onSubmit={save}>
      <h3 id="imm-extract-category-heading" className="imm-extract-settings__category-heading">{selected.name}</h3>
      {saved && <section className="imm-extract-settings__saved" aria-labelledby="imm-extract-saved-heading">
        <h4 id="imm-extract-saved-heading">Saved values — last loaded snapshot</h4>
        <p className="imm-extract-settings__hint">{saved.version === 0 ? 'Unconfigured category — no quantities have been saved.' : `Last loaded version ${saved.version}.`} Editing below does not change this snapshot. A confirmed save or explicit reload updates it.</p>
        <div className="imm-extract-settings__table-wrap" role="region" aria-label="Saved ranked quantities" tabIndex={0}>
          <table className="imm-extract-settings__table imm-extract-settings__saved-table">
            <caption className="imm-extract-settings__sr-only">Saved Extract &amp; Dilution quantities in ml for {selected.name}</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Extract (ml)</th><th scope="col">Dilution (ml)</th></tr></thead>
            <tbody>{saved.rows.map((row, index) => <tr key={index}><th scope="row">{index + 1}</th>
              <td>{savedQuantity(row.extract)}</td><td>{savedQuantity(row.dilution)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
      <fieldset disabled={busy} aria-describedby="imm-extract-category-heading">
        <legend className="imm-extract-settings__editor-heading">Editable values — not saved until confirmed</legend>
        <p id="imm-extract-help" className="imm-extract-settings__hint">Blank means not recorded, not zero.</p>
        <div className="imm-extract-settings__table-wrap" role="region" aria-label="Ranked quantities" tabIndex={0}><table className="imm-extract-settings__table">
          <caption className="imm-extract-settings__sr-only">Ranked Extract &amp; Dilution quantities in ml for {selected.name}</caption>
          <thead><tr><th scope="col">Rank</th><th scope="col">Extract (ml)</th><th scope="col">Dilution (ml)</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{index + 1}{(row.extract === '' || row.dilution === '') && <small>Incomplete</small>}</th>
            {['extract', 'dilution'].map((field) => <td key={field}><input inputMode="decimal" value={row[field]} placeholder="Not recorded" aria-label={`${field === 'extract' ? 'Extract' : 'Dilution'} in ml, rank ${index + 1}`}
              aria-describedby="imm-extract-help imm-extract-precision" aria-invalid={Boolean(quantityError(row[field]))} onChange={(event) => { const value = event.target.value; setRows((old) => old.map((item, rank) => rank === index ? { ...item, [field]: value } : item)); setNotice(''); }} /></td>)}
          </tr>)}</tbody>
        </table></div>
      </fieldset>
      {blocked && <p className="admin-feedback admin-feedback--error" role="alert">Load saved settings before saving again. Your edits will be kept for comparison.</p>}
      <div className="imm-extract-settings__actions">
        <button type="submit" className="admin-button" disabled={busy || blocked || !dirty}>Save Extract &amp; Dilution</button>
        <div className="imm-extract-settings__secondary-actions">
          <button type="button" className="admin-button admin-button--secondary" disabled={busy || !saved} onClick={() => { setRows(editable(saved.rows)); setNotice('Unsaved edits cancelled.'); setError(''); }}>Cancel edits</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load()}>Load saved settings</button>
        </div>
      </div>
    </form>}
    {selected && !rows && !busy && <button type="button" className="admin-button" onClick={() => load(selected, false)}>Load saved settings</button>}
  </section>;
}
