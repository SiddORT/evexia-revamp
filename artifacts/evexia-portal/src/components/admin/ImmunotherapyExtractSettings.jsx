import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { extractCategories, loadExtractSettings, saveExtractSettings } from '../../services/serverImmunotherapyExtract.js';
import { quantityError } from '../../services/serverImmunotherapy.js';

const editable = (rows) => rows.map((row) => ({ extract: row.extract ?? '', dilution: row.dilution ?? '' }));
const equal = (saved, rows) => saved && JSON.stringify(editable(saved.rows)) === JSON.stringify(rows);

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
  const state = useRef({});
  const dirty = Boolean(rows && !equal(saved, rows));
  state.current = { busy, dirty };

  useEffect(() => {
    setSelected(null); setSaved(null); setRows(null); setError(''); setNotice(''); setBusy(false); setBlocked(false);
    return () => { sequence.current++; };
  }, [allowed, owner]);
  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    const seq = ++listSequence.current;
    setListBusy(true); setListError(''); setCategories({ items: [], nextOffset: null });
    const timer = setTimeout(() => extractCategories({ query, limit: 50 }, controller.signal)
      .then((value) => { if (seq === listSequence.current) setCategories(value); })
      .catch((cause) => { if (!controller.signal.aborted && seq === listSequence.current) setListError(cause.message); })
      .finally(() => { if (seq === listSequence.current) setListBusy(false); }), 200);
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

  async function more() {
    if (listBusy || categories.nextOffset === null) return;
    const seq = listSequence.current;
    setListBusy(true); setListError('');
    try {
      const value = await extractCategories({ query, offset: categories.nextOffset, limit: 50 });
      if (seq === listSequence.current) setCategories((old) => ({ ...value, items: [...old.items, ...value.items] }));
    } catch (cause) { if (seq === listSequence.current) setListError(cause.message); }
    finally { if (seq === listSequence.current) setListBusy(false); }
  }
  async function load(category = selected, keep = Boolean(rows)) {
    if (!category || state.current.busy) return;
    const seq = ++sequence.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await loadExtractSettings(category.id);
      if (seq !== sequence.current) return;
      setSaved(value);
      if (!keep) setRows(editable(value.rows));
      setBlocked(false);
      if (keep) setNotice('Saved version loaded. Your edits are kept. Compare the saved rows below before saving, or cancel edits to use them.');
    } catch (cause) {
      if (seq === sequence.current) { setError(cause.message); setBlocked(true); }
    } finally { if (seq === sequence.current) setBusy(false); }
  }
  async function choose(id) {
    if (state.current.busy || id === selected?.id) return;
    if (state.current.dirty && !(await confirm('Discard unsaved Extract & Dilution changes for this category?'))) return;
    if (state.current.busy) return;
    const category = categories.items.find((item) => item.id === id);
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
    } finally { if (seq === sequence.current) setBusy(false); }
  }
  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>Immunotherapy — Extract & Dilution</h2><p role="alert">Only Super Admin can configure these shared values.</p></section>;
  const options = selected && !categories.items.some((item) => item.id === selected.id) ? [selected, ...categories.items] : categories.items;
  return <section className="admin-panel admin-settings__section imm-extract-settings" aria-busy={busy}>
    <h2>Immunotherapy — Extract & Dilution</h2>
    <p>Set shared quantities by category for new applicable placements. Saved orders are unchanged.</p>
    <details className="imm-extract-settings__disclosure">
      <summary>Ranking &amp; entry guidance</summary>
      <p id="imm-extract-precision">Use up to six whole digits and three decimal places in ml. No quantities are prefilled or calculated. Incomplete rows are allowed; missing order quantities need Admin completion before approval.</p>
      <p>New MR category/Mix bottles rank allergens by numeric Skin Test Result, highest first, within each existing bottle. Ties keep their order. One allergen uses rank 1; two use ranks 1–2; three use all ranks. Overflow bottles and No Mix restart at rank 1. Admin can edit saved quantities; order approval remains explicit.</p>
    </details>
    <div className="imm-extract-settings__categories">
      <div className="imm-extract-settings__category-fields">
        <label className="imm-extract-settings__field">Search saved categories<input type="search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="imm-extract-settings__field">Saved category<select value={selected?.id || ''} disabled={busy} onChange={(event) => choose(event.target.value)}>
          <option value="">Select a category</option>
          {options.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}
        </select></label>
      </div>
      {listBusy && <p role="status">Loading categories…</p>}
      {listError && <div className="admin-feedback admin-feedback--error" role="alert">{listError} <button type="button" className="admin-button admin-button--secondary" onClick={() => setListRevision((n) => n + 1)}>Retry category search</button></div>}
      {!listBusy && !listError && !categories.items.length && <p role="status">No saved categories match this search.</p>}
      {categories.nextOffset !== null && <button type="button" className="admin-button admin-button--secondary" disabled={listBusy} onClick={more}>Load more categories</button>}
    </div>
    {busy && <p role="status">Loading or saving shared settings…</p>}
    {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {rows && <form onSubmit={save}>
      <h3 id="imm-extract-category-heading" className="imm-extract-settings__category-heading">{selected.name}</h3>
      <fieldset disabled={busy} aria-labelledby="imm-extract-category-heading">
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
      {saved && <details className="imm-extract-settings__disclosure">
        <summary>Saved values</summary>
        <p>Last loaded version {saved.version}{saved.version === 0 ? ' — unconfigured' : ''}. Compare with your edits above.</p>
        <ul>{saved.rows.map((row, index) => <li key={index}>Rank {index + 1}: Extract {row.extract ?? 'not recorded'} ml; Dilution {row.dilution ?? 'not recorded'} ml.</li>)}</ul>
      </details>}
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
