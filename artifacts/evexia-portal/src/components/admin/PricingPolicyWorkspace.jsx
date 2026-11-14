import { useEffect, useRef, useState } from 'react';
import DataTable from './DataTable.jsx';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';
import useCombinationPricing from './useCombinationPricing.js';
import usePricingCategories from './usePricingCategories.js';
import CombinationPricingHistory from './CombinationPricingHistory.jsx';
import CountTariffEvidence from './CountTariffEvidence.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { combinationAllergens, DOSAGES, exactCombinationRate } from '../../services/serverCombinationPricing.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';
import '../../mr.css';

const SIZES = ['Individual', 'Combination of 2', 'Combination of 3'];
export default function PricingPolicyWorkspace() {
  const session = useAdminSession();
  const confirm = usePlatformConfirm();
  const prefs = useAdminPreferences();
  const choices = usePricingCategories();
  const [category, setCategory] = useState(null);
  const [dosage, setDosage] = useState('PD');
  const [size, setSize] = useState(1);
  const [selection, setSelection] = useState(null);
  const [allergenQuery, setAllergenQuery] = useState('');
  const [allergenOffset, setAllergenOffset] = useState(0);
  const [allergens, setAllergens] = useState(null);
  const [allergenBusy, setAllergenBusy] = useState(false);
  const [allergenError, setAllergenError] = useState('');
  const [allergenRetry, setAllergenRetry] = useState(0);
  const [copySource, setCopySource] = useState('');
  const [localError, setLocalError] = useState('');
  const [history, setHistory] = useState(null);
  const [countOpen, setCountOpen] = useState(false);
  const historyTrigger = useRef(null);
  const pendingFocus = useRef(null);
  const wasWorking = useRef(false);
  const deciding = useRef(false);
  const selectionBusy = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const sequence = useRef(0);
  const tariff = useCombinationPricing(category?.status === 'active'
    ? { categoryId: category.id, dosage, size, allergenIds: selection } : null, session.user.id);
  const latest = useRef({});
  latest.current = { tariff, category, selection, dosage, size };
  const guard = () => ({ ...latest.current.tariff.getGuardState(),
    busy: latest.current.tariff.getGuardState().busy || selectionBusy.current });
  useConfirmedNavigation(guard, 'Discard unsaved combination rates and leave Pricing Rules?');
  useEffect(() => {
    const unload = (event) => {
      const state = guard();
      if (state.dirty || state.busy || state.uncertain) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => { sequence.current++; window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => {
    if (!category || category.status !== 'active') { setAllergens(null); return undefined; }
    const ctl = new AbortController(); setAllergenBusy(true); setAllergens(null); setAllergenError('');
    const timer = setTimeout(() => combinationAllergens(category.id,
      { query: allergenQuery, offset: allergenOffset, limit: 50 }, ctl.signal)
      .then((value) => { if (!ctl.signal.aborted) setAllergens(value); })
      .catch((cause) => { if (!ctl.signal.aborted) setAllergenError(cause.message); })
      .finally(() => { if (!ctl.signal.aborted) setAllergenBusy(false); }), allergenQuery ? 250 : 0);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [category?.id, category?.status, allergenQuery, allergenOffset, allergenRetry]);
  async function allowDiscard(message) {
    if (deciding.current || guard().busy || guard().uncertain) return false;
    if (!guard().dirty) return true;
    deciding.current = true;
    try {
      const yes = await confirm(message);
      return yes && !guard().busy && !guard().uncertain;
    } finally { deciding.current = false; }
  }
  async function change(action, trigger) {
    trigger?.focus();
    const seq = ++sequence.current;
    if (!await allowDiscard('Discard unsaved rates and date before changing this pricing scope?')) return;
    if (seq !== sequence.current) return;
    pendingFocus.current = trigger;
    action(); setCopySource(''); setLocalError('');
  }
  async function chooseCategory(id) {
    const next = choices.items.find((c) => c.id === id) || null;
    if (id && !next) return;
    if (id === latest.current.category?.id) return;
    await change(() => {
      setCategory(next); setSelection(null); setAllergenQuery(''); setAllergenOffset(0); setCountOpen(false);
    }, document.getElementById('combination-category'));
  }
  async function toggleAllergen(id, checked, trigger) {
    trigger?.focus();
    const seq = ++sequence.current;
    if (!await allowDiscard('Discard unsaved rates and date before changing the allergen subset?')) return;
    if (seq !== sequence.current) return;
    pendingFocus.current = trigger;
    const current = latest.current;
    let ids = current.selection;
    if (ids === null) {
      // A deliberate deselection from All must collect the complete bounded
      // category, never treat the visible/search-matching page as the selection.
      selectionBusy.current = true; setSelecting(true); setLocalError('');
      try {
        ids = [];
        let offset = 0;
        do {
          const page = await combinationAllergens(current.category.id, { query: '', offset, limit: 100 });
          if (seq !== sequence.current) return;
          if (page.total > 500) throw new Error('This category exceeds 500 eligible allergens. Use “Clear all; choose subset”, then select up to 500 members from the paged list.');
          ids.push(...page.items.map((m) => m.id)); offset += page.items.length;
          if (offset >= page.total) break;
          if (!page.items.length) throw new Error('Allergen selection changed while loading. Retry choices; no selection was changed.');
        } while (true);
        if (new Set(ids).size !== ids.length) throw new Error('Allergen pages changed while loading. Retry; no selection was changed.');
      } catch (cause) { setLocalError(cause.message); return; }
      finally { selectionBusy.current = false; setSelecting(false); }
    }
    const next = checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
    if (next.length > 500) { setLocalError('Select at most 500 allergens in one explicit subset.'); return; }
    setSelection(next.sort()); setCopySource(''); setLocalError('');
  }
  async function copy() {
    if (deciding.current || guard().busy || guard().uncertain || tariff.blocked || !tariff.page?.scopeTotal) return;
    let amount;
    try { amount = exactCombinationRate(copySource); } catch (cause) { setLocalError(cause.message); return; }
    deciding.current = true;
    const expected = tariff.page;
    try {
      const old = tariff.draft;
      const differing = Object.values(old.edits).some((v) => {
        try { return exactCombinationRate(v) !== amount; } catch { return true; }
      }) || (old.copyRate !== null && old.copyRate !== amount);
      if (differing && !await confirm(`Overwrite differing draft values for all ${expected.scopeTotal} generated rows, including nonvisible and search-hidden rows, with ₹${amount}? This changes this category, dosage, allergen selection and size only. Save is still required.`)) return;
      if (latest.current.tariff.page !== expected || guard().busy || guard().uncertain) return;
      tariff.copy(amount); setLocalError('');
    } finally { deciding.current = false; }
  }
  async function discardAndReload() {
    if (!await allowDiscard('Discard every unsaved rate, copied value and date, then load current master eligibility and saved rates?')) return;
    tariff.reset(); setCopySource(''); setLocalError('');
    setAllergenRetry((n) => n + 1);
  }
  function showHistory(key, trigger) {
    historyTrigger.current = trigger;
    setHistory({ categoryId: category.id, dosage, memberKey: key });
  }
  const disabled = tariff.locked || selecting;
  useEffect(() => {
    if (wasWorking.current && !disabled) {
      const target = pendingFocus.current;
      const focused = document.activeElement;
      if (target?.isConnected && !target.matches(':disabled')
        && (!focused || focused === document.body || focused.matches(':disabled'))) target.focus();
      pendingFocus.current = null;
    }
    wasWorking.current = disabled;
  }, [disabled]);
  const rateFor = (row) => Object.hasOwn(tariff.draft.edits, row.key) ? tariff.draft.edits[row.key]
    : tariff.draft.copyRate ?? '';
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_r, index) => index + 1 },
    { key: 'members', label: 'Allergen membership', render: (r) => <ul className="pricing-combination-members">
      {r.members.map((m) => <li key={m.id}><span>{m.name}</span><small>{m.mix ? 'Mix' : 'No Mix'}</small></li>)}</ul> },
    { key: 'saved', label: 'Latest recorded MRP / history', render: (r) => <>
      {r.latest ? <><strong>₹{r.latest.totalMrp}</strong><small>From {formatAdminDate(r.latest.effectiveFrom, prefs) || r.latest.effectiveFrom} · v{r.latest.version}</small></> : <span>Unconfigured</span>}
      <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
        onClick={(e) => showHistory(r.key, e.currentTarget)}>History</button></> },
    { key: 'rate', label: 'Rate / Total Suborder MRP (INR)', render: (r) => <input className="mr-form__control pricing-combination-rate"
      aria-label={`Draft total suborder MRP in INR for ${r.members.map((m) => m.name).join(' + ')}`}
      inputMode="decimal" maxLength={15} value={rateFor(r)} disabled={disabled || tariff.blocked}
      placeholder="Unconfigured" onChange={(e) => tariff.edit(r.key, e.target.value)} /> },
  ];
  return <>
    <div className="admin-page-head pricing-page-head"><div>
      <p className="admin-page-head__eyebrow">Configuration / Pricing</p><h1>Pricing Rules</h1>
      <p>Combination Pricing Master · total suborder MRP in INR, never per ml or per allergen. Saved orders and current order quotation are unchanged.</p>
    </div></div>
    <section className="admin-panel pricing-policy-workspace pricing-combination-workspace" aria-label="Combination Pricing Master">
      <h2>Category → Allergens → Dosage → Combination size</h2>
      <p>Configuration only. Activating these prices in order placement or quotation needs separate authorization. No Extract or Dilution quantities are loaded, inferred or changed.</p>
      <div className="pricing-combination-controls">
        <div className="mr-form__field pricing-category-field"><label className="mr-form__label" htmlFor="combination-category">Product Category</label>
          <AllergenSearchableSelect id="combination-category" label="Product Category" testId="combination-category"
            value={category?.id || ''} selectedLabel={category ? `${category.name}${category.status === 'active' ? '' : ` (${category.status}; history only)`}` : undefined}
            options={choices.items.map((c) => ({ value: c.id, label: `${c.name}${c.status === 'active' ? '' : ` (${c.status}; history only)`}` }))}
            placeholder="Search and select a category" disabled={disabled} onChange={chooseCategory}
            onSearch={choices.search} loading={choices.busy} error={choices.error} onRetry={() => choices.search(choices.query, true)}
            hasMore={choices.nextOffset !== null} onMore={choices.more} moreLabel="Load more categories" searchMaxLength={100} />
        </div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-dosage">Dosage</label>
          <select id="combination-dosage" className="mr-form__control" value={dosage} disabled={disabled}
            onChange={(e) => { const value = e.target.value; void change(() => setDosage(value), e.target); }}>
            {DOSAGES.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-size">Combination size</label>
          <select id="combination-size" className="mr-form__control" value={size} disabled={disabled}
            onChange={(e) => { const value = Number(e.target.value); void change(() => setSize(value), e.target); }}>
            {SIZES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></div>
      </div>
      {!category && <p role="status">Choose a category to load its saved eligible allergens. Initially all eligible members are selected.</p>}
      {category?.status === 'active' && <fieldset className="pricing-combination-allergens" disabled={disabled}>
        <legend>Allergens · {selection === null ? 'All eligible members selected' : `${selection.length} selected`}</legend>
        <p>Mix / No Mix is read-only from Allergen Master. No Mix is individual-only. The bound Dilution inventory material is excluded. Search does not change selection.</p>
        <div className="pricing-policy-controls">
          <label className="admin-search"><span className="pricing-sr-only">Search category allergens</span>
            <input type="search" value={allergenQuery} maxLength={100} placeholder="Search allergens…"
              onChange={(e) => { setAllergenQuery(e.target.value); setAllergenOffset(0); }} /></label>
          <button type="button" className="admin-button admin-button--secondary" disabled={selection === null}
            onClick={(e) => change(() => setSelection(null), e.currentTarget)}>Select all eligible</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={selection?.length === 0}
            onClick={(e) => change(() => setSelection([]), e.currentTarget)}>Clear all; choose subset</button>
        </div>
        {allergenBusy ? <p role="status">Loading saved allergens…</p>
          : allergenError ? <div role="alert"><p>{allergenError}</p><button type="button" className="admin-button"
            onClick={() => setAllergenRetry((n) => n + 1)}>Retry allergen choices</button></div>
          : <><div className="pricing-combination-choices">{allergens?.items.map((m) => <label key={m.id}>
            <input type="checkbox" checked={selection === null || selection.includes(m.id)}
              onChange={(e) => toggleAllergen(m.id, e.target.checked, e.target)} />
            <span>{m.name}</span><small>{m.mix ? 'Mix' : 'No Mix'}</small></label>)}</div>
            {!allergens?.items.length && <p>No matching eligible allergens.</p>}
            <div className="admin-pagination"><span>{allergens?.total ?? 0} search matches; selection includes nonvisible pages.</span>
              <button type="button" className="admin-button admin-button--secondary" disabled={!allergenOffset}
                onClick={() => setAllergenOffset((n) => Math.max(0, n - 50))}>Previous allergens</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={!allergens || allergenOffset + 50 >= allergens.total}
                onClick={() => setAllergenOffset((n) => n + 50)}>Next allergens</button></div></>}
      </fieldset>}
      {tariff.busy && <p role="status">Loading or saving combination rates…</p>}
      {(tariff.error || localError) && <p role="alert" className="admin-feedback admin-feedback--error">{localError || tariff.error}</p>}
      {tariff.notice && <p role="status" className="admin-feedback">{tariff.notice}</p>}
      {tariff.dirty && <p role="status">Unsaved draft. Blank untouched rates remain unconfigured; explicit 0 is valid. Changing scope requires discarding this draft after confirmation.</p>}
      {tariff.attempt ? <button type="button" className="admin-button" disabled={tariff.busy} onClick={tariff.save}>Retry same submission</button>
        : category?.status === 'active' && <div className="pricing-policy-actions">
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
            onClick={tariff.retry}>Reload saved rates; keep draft</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
            onClick={discardAndReload}>Discard draft and reload masters</button></div>}
      {tariff.page && <form onSubmit={(e) => { e.preventDefault(); void tariff.save(); }} className="pricing-combination-editor">
        <p>{category.name} · {dosage} · {SIZES[size - 1]} · {tariff.page.scopeTotal} eligible generated rows.
          Latest recorded is not necessarily the rate effective today; review dated history.</p>
        <div className="pricing-combination-batch">
          <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-copy">Source rate (INR)</label>
            <input id="combination-copy" className="mr-form__control" inputMode="decimal" maxLength={15}
              value={copySource} disabled={disabled || tariff.blocked} onChange={(e) => setCopySource(e.target.value)} /></div>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || !tariff.page.scopeTotal}
            onClick={copy}>Copy rate to all {tariff.page.scopeTotal} rows</button>
          <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-effective">Effective From</label>
            <input id="combination-effective" className="mr-form__control" type="date" required value={tariff.draft.effectiveFrom}
              disabled={disabled || tariff.blocked} onChange={(e) => tariff.date(e.target.value)} /></div>
        </div>
        <p className="pricing-rules-note">Copy applies only to every generated row for this category, dosage, allergen selection and size, including hidden pages and search-hidden rows. It is draft-only. A row override after Copy replaces that row’s draft amount. Save appends dated revisions; it never overwrites history.</p>
        <label className="admin-search pricing-combination-search"><span className="pricing-sr-only">Search generated combinations</span>
          <input type="search" value={tariff.view.query} maxLength={100} placeholder="Search generated membership…"
            disabled={Boolean(tariff.attempt) || selecting || tariff.blocked}
            onChange={(e) => tariff.changeView({ query: e.target.value, offset: 0 })} /></label>
        <DataTable columns={columns} rows={tariff.page.items} rowKey={(r) => r.key} rowOffset={tariff.page.offset}
          loading={tariff.busy} label="Generated combination rates" testIdPrefix="combination-rate"
          empty={<p>No eligible combinations match. No Mix members cannot form pairs/triples. Select eligible Mix members or Individual.</p>} />
        <div className="admin-panel__foot admin-pagination">
          <span>{tariff.page.total} search matches / {tariff.page.scopeTotal} scope rows</span>
          <label>Rows per page <select value={tariff.view.limit} disabled={disabled || tariff.blocked}
            onChange={(e) => tariff.changeView({ limit: Number(e.target.value), offset: 0 })}>
            {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || !tariff.view.offset}
            onClick={() => tariff.changeView({ offset: Math.max(0, tariff.view.offset - tariff.view.limit) })}>Previous</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || tariff.view.offset + tariff.view.limit >= tariff.page.total}
            onClick={() => tariff.changeView({ offset: tariff.view.offset + tariff.view.limit })}>Next</button>
        </div>
        <div className="pricing-policy-actions"><button type="submit" className="admin-button"
          disabled={disabled || tariff.blocked || !tariff.page.scopeTotal}>Save dated rates</button></div>
      </form>}
      {category && <div className="pricing-policy-actions"><button type="button" className="admin-button admin-button--secondary"
        disabled={disabled} onClick={(e) => showHistory('', e.currentTarget)}>Review all saved {dosage} combinations</button></div>}
      {category && <details className="pricing-count-history" onToggle={(e) => setCountOpen(e.currentTarget.open)}>
        <summary>Historical category/count tariffs · read-only</summary>
        {countOpen && <CountTariffEvidence key={category.id} categoryId={category.id} />}
      </details>}
    </section>
    {history && <CombinationPricingHistory {...history} returnFocusRef={historyTrigger} onClose={() => setHistory(null)} />}
  </>;
}
