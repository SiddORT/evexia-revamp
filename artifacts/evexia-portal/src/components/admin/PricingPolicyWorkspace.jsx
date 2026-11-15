import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';
import useCombinationPricing from './useCombinationPricing.js';
import usePricingCategories from './usePricingCategories.js';
import CombinationPricingHistory from './CombinationPricingHistory.jsx';
import CountTariffEvidence from './CountTariffEvidence.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { combinationAllergens, DOSAGES } from '../../services/serverCombinationPricing.js';
import '../../mr.css';

const SIZES = ['Individual', 'Combination of 2', 'Combination of 3'];
export default function PricingPolicyWorkspace({ record }) {
  const [, navigate] = useLocation();
  const editing = Boolean(record);
  const saved = record?.latest;
  const session = useAdminSession();
  const confirm = usePlatformConfirm();
  const choices = usePricingCategories();
  const [category, setCategory] = useState(() => saved ? { id: saved.categoryId, name: saved.categoryName, status: 'active' } : null);
  const [dosage, setDosage] = useState(saved?.dosage || 'PD');
  const [size, setSize] = useState(saved?.memberIds.length || 1);
  const [selection, setSelection] = useState(saved?.memberIds || null);
  const [allergenQuery, setAllergenQuery] = useState('');
  const [allergenOffset, setAllergenOffset] = useState(0);
  const [allergens, setAllergens] = useState(null);
  const [eligibleCount, setEligibleCount] = useState(null);
  const [allergenBusy, setAllergenBusy] = useState(false);
  const [allergenError, setAllergenError] = useState('');
  const [allergenRetry, setAllergenRetry] = useState(0);
  const [combinationMode, setCombinationMode] = useState('all');
  const mode = editing ? 'exact' : size === 1 ? 'individual' : combinationMode;
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
  const allergenController = useRef(null);
  const tariff = useCombinationPricing(category?.status === 'active'
    ? { categoryId: category.id, dosage, size, allergenIds: selection } : null, session.user.id,
  () => navigate('/admin/pricing-rules'), mode);
  const seeded = useRef(false);
  useEffect(() => {
    if (editing && tariff.page && !tariff.busy && !seeded.current) {
      seeded.current = true;
      tariff.edit(saved.memberIds.join(','), tariff.page.items[0]?.latest?.totalMrp ?? saved.totalMrp);
    }
  }, [editing, tariff.page, tariff.busy]);
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
    if (editing || !category || category.status !== 'active') { setAllergens(null); return undefined; }
    const ctl = new AbortController(); allergenController.current = ctl;
    setAllergenBusy(true); setAllergens(null); setAllergenError('');
    const timer = setTimeout(() => combinationAllergens(category.id,
      { query: allergenQuery, offset: allergenOffset, limit: 50 }, ctl.signal)
      .then((value) => {
        if (ctl.signal.aborted) return;
        setAllergens(value);
        if (!allergenQuery.trim()) setEligibleCount(value.total);
      })
      .catch((cause) => { if (!ctl.signal.aborted) setAllergenError(cause.message); })
      .finally(() => { if (!ctl.signal.aborted) setAllergenBusy(false); }), allergenQuery ? 250 : 0);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [editing, category?.id, category?.status, allergenQuery, allergenOffset, allergenRetry]);
  function changeAllergenView(action) {
    // Isolate stale responses immediately, including during the debounce window.
    allergenController.current?.abort();
    setAllergenBusy(true); setAllergens(null); setAllergenError('');
    action();
  }
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
    action(); setLocalError('');
  }
  async function chooseCategory(id) {
    const next = choices.items.find((c) => c.id === id) || null;
    if (id && !next) return;
    if (id === latest.current.category?.id) return;
    await change(() => {
      allergenController.current?.abort();
      setCategory(next); setSelection(null); setAllergens(null); setEligibleCount(null);
      setAllergenQuery(''); setAllergenOffset(0); setCountOpen(false);
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
          if (page.total > 500) throw new Error('This category exceeds 500 eligible allergens. Use Clear, then select a smaller subset from the paged list.');
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
    setSelection(next.sort()); setLocalError('');
  }
  async function toggleCombination(key, checked, trigger) {
    if (deciding.current || guard().busy || guard().uncertain || tariff.blocked) return;
    if (checked) { tariff.edit(key, ''); return; }
    const identity = tariff.page;
    const value = tariff.draft.edits[key];
    deciding.current = true;
    try {
      if (value?.trim() && !await confirm('Remove this combination and discard its unsaved rate? Other chosen combinations and the shared date will be kept.')) return;
      if (latest.current.tariff.page !== identity || guard().busy || guard().uncertain) return;
      tariff.remove(key); trigger?.focus();
    } finally { deciding.current = false; }
  }
  async function discardAndReload() {
    if (!await allowDiscard('Discard every unsaved rate, chosen combination and date, then load current master eligibility and saved rates?')) return;
    seeded.current = false;
    tariff.reset(); setLocalError('');
    setAllergenRetry((n) => n + 1);
  }
  function showHistory(key, trigger) {
    historyTrigger.current = trigger;
    setHistory({ categoryId: category.id, dosage, memberKey: key,
      ruleId: editing && key === saved.memberIds.join(',') ? saved.id : undefined });
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
  const chosenCount = Object.keys(tariff.draft.edits).length;
  const affectedCount = mode === 'choose' ? chosenCount : editing ? (tariff.page?.scopeTotal === 1 ? 1 : 0) : tariff.page?.scopeTotal ?? 0;
  return <>
    <div className="admin-page-head pricing-page-head"><div>
      <p className="admin-page-head__eyebrow">Configuration / Pricing / Pricing Rules</p><h1>{editing ? 'Edit Pricing Rule' : 'Add Pricing Rule'}</h1>
      <p>Combination Pricing Master · total suborder MRP in INR, never per ml or per allergen. Saved orders and current order quotation are unchanged.</p>
    </div><button type="button" className="admin-button admin-button--secondary" disabled={disabled}
      onClick={() => navigate('/admin/pricing-rules')}><ArrowLeft size={16} /> Back to Pricing Rules</button></div>
    <section className="admin-panel pricing-policy-workspace pricing-combination-workspace" aria-label="Combination Pricing Master">
      <h2>{editing ? 'Exact saved rule · append a dated rate' : 'Choose pricing scope'}</h2>
      <p>Configuration only. Activating these prices in order placement or quotation needs separate authorization. No Extract or Dilution quantities are loaded, inferred or changed.</p>
      {editing && <p>This rule is {record.status}. Saving a rate does not change its status. Category, dosage and exact membership cannot be changed here.
        Enter a new Effective From date not already used by this rule; the existing date cannot be overwritten.
        Ineligible master records remain history-only until their eligibility is resolved separately.</p>}
      {editing && <ul className="pricing-combination-members" aria-label="Exact saved allergen membership">
        {saved.members.map((m) => <li key={m.id}>{m.name} · {m.mix ? 'Mix' : 'No Mix'}</li>)}
      </ul>}
      <div className="pricing-combination-controls">
        <div className="mr-form__field pricing-category-field"><label className="mr-form__label" htmlFor="combination-category">Product Category</label>
          <AllergenSearchableSelect id="combination-category" label="Product Category" testId="combination-category"
            value={category?.id || ''} selectedLabel={category ? `${category.name}${category.status === 'active' ? '' : ` (${category.status}; history only)`}` : undefined}
            options={choices.items.map((c) => ({ value: c.id, label: `${c.name}${c.status === 'active' ? '' : ` (${c.status}; history only)`}` }))}
            placeholder="Search and select a category" disabled={disabled || editing} onChange={chooseCategory}
            onSearch={choices.search} loading={choices.busy} error={choices.error} onRetry={() => choices.search(choices.query, true)}
            hasMore={choices.nextOffset !== null} onMore={choices.more} moreLabel="Load more categories" searchMaxLength={100} />
        </div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-dosage">Dosage</label>
          <select id="combination-dosage" className="mr-form__control" value={dosage} disabled={disabled || editing}
            onChange={(e) => { const value = e.target.value; void change(() => setDosage(value), e.target); }}>
            {DOSAGES.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-size">Combination size</label>
          <select id="combination-size" className="mr-form__control" value={size} disabled={disabled || editing}
            onChange={(e) => { const value = Number(e.target.value); void change(() => setSize(value), e.target); }}>
            {SIZES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></div>
      </div>
      {!category && <p role="status">Choose a category to load its saved eligible allergens. Initially all eligible members are selected.</p>}
      {!editing && category?.status === 'active' && <fieldset className="pricing-combination-allergens" disabled={disabled}>
        <legend>Allergens · {selection === null ? eligibleCount === null ? 'All eligible members selected' : `${eligibleCount} selected (all eligible)` : `${selection.length} selected`}</legend>
        <div className="pricing-policy-controls">
          <label className="admin-search"><span className="pricing-sr-only">Search category allergens</span>
            <input type="search" value={allergenQuery} maxLength={100} placeholder="Search allergens…"
              onChange={(e) => changeAllergenView(() => { setAllergenQuery(e.target.value); setAllergenOffset(0); })} /></label>
          <button type="button" className="admin-button admin-button--secondary" disabled={selection === null}
            onClick={(e) => change(() => setSelection(null), e.currentTarget)}>Select all</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={selection?.length === 0}
            onClick={(e) => change(() => setSelection([]), e.currentTarget)}>Clear</button>
        </div>
        {allergenBusy ? <p role="status">Loading saved allergens…</p>
          : allergenError ? <div role="alert"><p>{allergenError}</p><button type="button" className="admin-button"
            onClick={() => changeAllergenView(() => setAllergenRetry((n) => n + 1))}>Retry allergen choices</button></div>
          : <><div className="pricing-combination-choices">{allergens?.items.map((m) => <label key={m.id}>
            <input type="checkbox" checked={selection === null || selection.includes(m.id)}
              onChange={(e) => toggleAllergen(m.id, e.target.checked, e.target)} />
            <span>{m.name}</span><small>{m.mix ? 'Mix' : 'No Mix'}</small></label>)}</div>
            {!allergens?.items.length && <p>No matching eligible allergens.</p>}
            <div className="admin-pagination"><span>{allergens?.total ?? 0} search matches; selection includes nonvisible pages.</span>
              <button type="button" className="admin-button admin-button--secondary" disabled={!allergenOffset}
                onClick={() => changeAllergenView(() => setAllergenOffset((n) => Math.max(0, n - 50)))}>Previous allergens</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={!allergens || allergenOffset + 50 >= allergens.total}
                onClick={() => changeAllergenView(() => setAllergenOffset((n) => n + 50))}>Next allergens</button></div></>}
      </fieldset>}
      {!editing && size > 1 && category?.status === 'active' && <fieldset className="pricing-entry-modes" disabled={disabled || tariff.blocked}>
        <legend>Apply rates to</legend>
        {['all', 'choose'].map((value) => <label key={value}><input type="radio" name="pricing-entry-mode"
          checked={combinationMode === value} onChange={(e) => change(() => setCombinationMode(value), e.target)} />
          {value === 'all' ? 'All combinations' : 'Choose combinations'}</label>)}
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
      {tariff.page && <form onSubmit={(e) => { e.preventDefault(); if (!deciding.current) void tariff.save(); }} className="pricing-combination-editor">
        <p>{category.name} · {dosage} · {SIZES[size - 1]}</p>
        <p className="pricing-target-summary" role="status"><strong>{affectedCount} {mode === 'individual' ? 'individual allergen rule' : 'combination rule'}{affectedCount === 1 ? '' : 's'} will be affected.</strong>{' '}
          {mode === 'choose' ? 'Only checked combinations are saved, including selections on other pages. Enter a rate for each.' :
            editing ? 'This exact saved membership only; status is preserved.' :
              'One rate applies to every eligible target in this scope, including nonvisible pages and search-hidden targets.'}</p>
        {!tariff.page.scopeTotal && <p>No eligible targets in this scope. {size > 1
          ? `Select at least ${size} eligible Mix allergens, or choose Individual for singleton rates.`
          : 'Select at least one eligible allergen.'}</p>}
        <div className="pricing-combination-batch">
          {mode !== 'choose' && <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-rate">Rate (INR)</label>
            <input id="combination-rate" className="mr-form__control" inputMode="decimal" maxLength={15} required
              value={editing ? tariff.draft.edits[saved.memberIds.join(',')] ?? '' : tariff.draft.copyRate ?? ''}
              disabled={disabled || tariff.blocked} onChange={(e) => editing
                ? tariff.edit(saved.memberIds.join(','), e.target.value) : tariff.rate(e.target.value)} /></div>}
          <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-effective">{mode === 'choose' ? 'Shared applicable date for this save' : editing ? 'New applicable date' : 'Applicable date'}</label>
            <input id="combination-effective" className="mr-form__control" type="date" required value={tariff.draft.effectiveFrom}
              disabled={disabled || tariff.blocked} onChange={(e) => tariff.date(e.target.value)} /></div>
        </div>
        <p className="pricing-rules-note">Rate means total suborder MRP, not a per-ml or per-allergen charge. Explicit 0 is valid; blank is not zero.
          Save appends dated revisions. A date already used for a target is rejected, never overwritten.</p>
        {mode === 'choose' && <><label className="admin-search pricing-combination-search"><span className="pricing-sr-only">Search combinations</span>
          <input type="search" value={tariff.view.query} maxLength={100} placeholder="Search combination names…"
            disabled={Boolean(tariff.attempt) || selecting || tariff.blocked}
            onChange={(e) => tariff.changeView({ query: e.target.value, offset: 0 })} /></label>
        <div className="pricing-chosen-list" aria-label="Choose combination rates" aria-busy={tariff.busy}>
          {!tariff.busy && tariff.page.items.map((row) => {
            const chosen = Object.hasOwn(tariff.draft.edits, row.key);
            const name = row.members.map((m) => m.name).join(' + ');
            return <div key={row.key} className="pricing-chosen-row">
              <label className="pricing-chosen-members"><input type="checkbox" checked={chosen} disabled={disabled || tariff.blocked}
                onChange={(e) => toggleCombination(row.key, e.target.checked, e.target)} /><span>{name}</span></label>
              <label className="pricing-chosen-rate"><span>Rate (INR)<span className="pricing-sr-only"> for {name}</span></span>
                <input className="mr-form__control" inputMode="decimal" maxLength={15} required={chosen}
                  disabled={!chosen || disabled || tariff.blocked} value={tariff.draft.edits[row.key] ?? ''}
                  placeholder={chosen ? 'Enter rate' : 'Select first'} onChange={(e) => tariff.edit(row.key, e.target.value)} /></label>
              <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
                aria-label={`History for ${name}`} onClick={(e) => showHistory(row.key, e.currentTarget)}>History</button>
            </div>;
          })}
          {!tariff.busy && !tariff.page.items.length && <p>No matching eligible combinations. Try another search or select more Mix allergens.</p>}
        </div>
        <div className="admin-panel__foot admin-pagination">
          <span>{tariff.page.total} search matches / {tariff.page.scopeTotal} scope rows</span>
          <label>Rows per page <select value={tariff.view.limit} disabled={disabled || tariff.blocked}
            onChange={(e) => tariff.changeView({ limit: Number(e.target.value), offset: 0 })}>
            {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || !tariff.view.offset}
            onClick={() => tariff.changeView({ offset: Math.max(0, tariff.view.offset - tariff.view.limit) })}>Previous</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || tariff.view.offset + tariff.view.limit >= tariff.page.total}
            onClick={() => tariff.changeView({ offset: tariff.view.offset + tariff.view.limit })}>Next</button>
        </div></>}
        <div className="pricing-policy-actions"><button type="button" className="admin-button admin-button--secondary" disabled={disabled}
          onClick={() => navigate('/admin/pricing-rules')}>Cancel</button><button type="submit" className="admin-button"
          disabled={disabled || tariff.blocked || !affectedCount}>Save {affectedCount} dated rate{affectedCount === 1 ? '' : 's'}</button></div>
      </form>}
      {!tariff.page && <div className="pricing-policy-actions"><button type="button" className="admin-button admin-button--secondary" disabled={disabled}
        onClick={() => navigate('/admin/pricing-rules')}>Cancel</button></div>}
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
