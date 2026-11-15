import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';
import useCombinationPricing from './useCombinationPricing.js';
import usePricingCategories from './usePricingCategories.js';
import CombinationPricingHistory from './CombinationPricingHistory.jsx';
import CountTariffEvidence from './CountTariffEvidence.jsx';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { combinationAllergens, DOSAGES } from '../../services/serverCombinationPricing.js';
import '../../mr.css';

const SIZES = ['1 allergen', '2 allergens', '3 allergens'];
const ALL_CATEGORIES = { id: '__all__', name: 'All Categories', status: 'active' };
export default function PricingPolicyWorkspace({ record }) {
  const [, navigate] = useLocation();
  const editing = Boolean(record);
  const saved = record?.latest;
  const session = useAdminSession();
  const prefs = useAdminPreferences();
  const confirm = usePlatformConfirm();
  const choices = usePricingCategories();
  const [category, setCategory] = useState(() => saved ? { id: saved.categoryId, name: saved.categoryName, status: 'active' } : null);
  const allCategories = !editing && category?.id === ALL_CATEGORIES.id;
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
  const mode = editing ? 'exact' : allCategories ? 'all' : size === 1 ? 'individual' : combinationMode;
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
    ? { categoryId: allCategories ? null : category.id, ...(allCategories ? { categoryScope: 'all' } : {}),
      dosage, size, allergenIds: allCategories ? null : selection } : null, session.user.id,
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
    if (editing || allCategories || !category || category.status !== 'active') { setAllergens(null); setAllergenBusy(false); return undefined; }
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
    const next = id === ALL_CATEGORIES.id ? ALL_CATEGORIES : choices.items.find((c) => c.id === id) || null;
    if (id && !next) return;
    if (id === latest.current.category?.id) return;
    await change(() => {
      allergenController.current?.abort();
      setCategory(next); setSelection(null); setAllergens(null); setEligibleCount(null);
      setCombinationMode('all');
      if (next?.id === ALL_CATEGORIES.id && latest.current.size === 1) setSize(2);
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
  const affectedCount = tariff.attempt?.keys.length
    ?? (mode === 'choose' ? chosenCount : editing ? (tariff.page?.scopeTotal === 1 ? 1 : 0) : tariff.page?.scopeTotal ?? 0);
  const commonMrp = editing ? tariff.draft.edits[saved.memberIds.join(',')] ?? '' : tariff.draft.copyRate ?? '';
  const recoveryActions = <>
    {!tariff.blocked && <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
      data-testid="button-reload-pricing" onClick={tariff.retry}>Reload saved rates; keep draft</button>}
    <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
      data-testid="button-discard-pricing" onClick={discardAndReload}>Discard draft and reload masters</button>
  </>;
  return <>
    <div className="admin-page-head pricing-page-head"><div>
      <p className="admin-page-head__eyebrow">Configuration / Pricing / Pricing Rules</p><h1>{editing ? 'Edit Pricing Rule' : 'Add Pricing Rule'}</h1>
      <p>Configuration only. These prices are not applied to orders or quotations; activation requires separate authorization.</p>
    </div><button type="button" className="admin-button admin-button--secondary" disabled={disabled}
      onClick={() => navigate('/admin/pricing-rules')}><ArrowLeft size={16} /> Back to Pricing Rules</button></div>
    <section className="admin-panel pricing-policy-workspace pricing-combination-workspace pricing-rule-entry" aria-label="Pricing rule entry">
      <section className="pricing-entry-section" aria-labelledby="pricing-rule-details">
      <h2 id="pricing-rule-details">{editing ? 'Exact saved rule' : '1. Rule details'}</h2>
      {editing && <p>This rule is {record.status}. Saving a rate does not change its status. Category, dosage and exact membership cannot be changed here.
        Ineligible master records remain history-only until their eligibility is resolved separately.</p>}
      {editing && <ul className="pricing-combination-members" aria-label="Exact saved allergen membership">
        {saved.members.map((m) => <li key={m.id}>{m.name} · {m.mix ? 'Mix' : 'No Mix'}</li>)}
      </ul>}
      <div className="pricing-combination-controls">
        <div className="mr-form__field pricing-category-field"><label className="mr-form__label" htmlFor="combination-category">Product Category</label>
          <AllergenSearchableSelect id="combination-category" label="Product Category" testId="combination-category"
            value={category?.id || ''} selectedLabel={category ? `${category.name}${category.status === 'active' ? '' : ` (${category.status}; history only)`}` : undefined}
            options={[...(!editing ? [{ value: ALL_CATEGORIES.id, label: ALL_CATEGORIES.name }] : []),
              ...choices.items.map((c) => ({ value: c.id, label: `${c.name}${c.status === 'active' ? '' : ` (${c.status}; history only)`}` }))]}
            placeholder="Search and select a category" disabled={disabled || editing} onChange={chooseCategory}
            onSearch={choices.search} loading={choices.busy} error={choices.error} onRetry={() => choices.search(choices.query, true)}
            hasMore={choices.nextOffset !== null} onMore={choices.more} moreLabel="Load more categories" searchMaxLength={100} />
        </div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-dosage">Dosage</label>
          <select id="combination-dosage" data-testid="select-pricing-dosage" className="mr-form__control" value={dosage} disabled={disabled || editing}
            onChange={(e) => { const value = e.target.value; void change(() => setDosage(value), e.target); }}>
            {DOSAGES.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-size">Allergens per rule</label>
          <select id="combination-size" data-testid="select-pricing-rule-size" className="mr-form__control" value={size} disabled={disabled || editing}
            onChange={(e) => { const value = Number(e.target.value); void change(() => setSize(value), e.target); }}>
            {SIZES.map((name, i) => (!allCategories || i > 0) && <option key={name} value={i + 1}>{name}</option>)}</select></div>
      </div>
      </section>
      {!editing && <section className="pricing-entry-section" aria-labelledby="pricing-select-allergens">
      <h2 id="pricing-select-allergens">{allCategories ? '2. Review catalogue scope' : '2. Select allergens'}</h2>
      {!category && <p role="status">Choose a Product Category first. All eligible allergens will be selected by default.</p>}
      {category && category.status !== 'active' && <p role="status">This category is history-only. Choose an active category to add pricing rules.</p>}
      {allCategories && <>
        <p>Includes every active, nondeleted saved category and its eligible Mix allergens, excluding the bound Dilution material.
          Pairs and triples stay within each category; allergens from different categories are never combined.</p>
        <p>Search and paging only change the review shown, never this complete scope. Singleton and individually priced subsets require a single category.</p>
        {tariff.page && <div className="pricing-all-category-review" aria-label="Complete category scope">
          <p role="status"><strong>{tariff.page.categories.filter((c) => !c.skipped).length} categories with rules ·{' '}
            {tariff.page.categories.filter((c) => c.skipped).length} skipped · {tariff.page.scopeTotal} total rules</strong></p>
          <ul className="pricing-category-scope-list">{tariff.page.categories.map((c) => <li key={c.categoryId}>
            <strong>{c.categoryName}</strong><span>{c.eligibleMembers} eligible Mix allergens ·{' '}
              {c.skipped ? `Skipped: fewer than ${size} eligible Mix allergens` : `${c.ruleCount} rules`}</span>
          </li>)}</ul>
          {!tariff.page.categories.length && <p>No active saved categories. This empty scope cannot be saved.</p>}
        </div>}
      </>}
      {category?.status === 'active' && !allCategories && <fieldset className="pricing-combination-allergens" disabled={disabled}>
        <legend className="pricing-sr-only">Eligible allergens</legend>
        <p className="pricing-selection-summary" role="status" data-testid="status-allergen-selection">
          <strong>{selection === null ? eligibleCount === null ? 'All eligible allergens selected (default)' : `${eligibleCount} allergens selected · all eligible (default)` : `${selection.length} allergens selected across all pages`}</strong>
        </p>
        <p id="pricing-allergen-search-help">Search changes the choices shown, not your selection. Select all includes every eligible allergen, not just matches.
          {size > 1 ? ' Only Mix allergens can form combinations.' : ' Each selected allergen gets its own rule.'}</p>
        <div className="pricing-policy-controls">
          <label className="admin-search"><span className="pricing-sr-only">Search category allergens</span>
            <input type="search" data-testid="input-pricing-allergen-search" value={allergenQuery} maxLength={100} placeholder="Search allergens…" aria-describedby="pricing-allergen-search-help"
              onChange={(e) => changeAllergenView(() => { setAllergenQuery(e.target.value); setAllergenOffset(0); })} /></label>
          <button type="button" data-testid="button-select-all-pricing-allergens" className="admin-button admin-button--secondary" disabled={selection === null}
            onClick={(e) => change(() => setSelection(null), e.currentTarget)}>Select all</button>
          <button type="button" data-testid="button-clear-pricing-allergens" className="admin-button admin-button--secondary" disabled={selection?.length === 0}
            onClick={(e) => change(() => setSelection([]), e.currentTarget)}>Clear</button>
        </div>
        {allergenBusy ? <p role="status">Loading saved allergens…</p>
          : allergenError ? <div role="alert"><p>{allergenError}</p><button type="button" className="admin-button"
            onClick={() => changeAllergenView(() => setAllergenRetry((n) => n + 1))}>Retry allergen choices</button></div>
          : <><div className="pricing-combination-choices">{allergens?.items.map((m) => <label key={m.id}>
            <input type="checkbox" data-testid={`checkbox-pricing-allergen-${m.id}`} checked={selection === null || selection.includes(m.id)}
              onChange={(e) => toggleAllergen(m.id, e.target.checked, e.target)} />
            <span>{m.name}</span><small>{m.mix ? 'Mix' : 'No Mix'}</small></label>)}</div>
            {!allergens?.items.length && <p>No matching eligible allergens.</p>}
            {allergenQuery && <p role="status">{allergens?.total ?? 0} matching allergens.</p>}
            {(allergens?.total > 50 || allergenOffset > 0) && <div className="admin-pagination"><span>Page {Math.floor(allergenOffset / 50) + 1} · {allergens?.total ?? 0} matching allergens</span>
              <button type="button" className="admin-button admin-button--secondary" disabled={!allergenOffset}
                onClick={() => changeAllergenView(() => setAllergenOffset((n) => Math.max(0, n - 50)))}>Previous allergens</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={!allergens || allergenOffset + 50 >= allergens.total}
                onClick={() => changeAllergenView(() => setAllergenOffset((n) => n + 50))}>Next allergens</button></div>}</>}
      </fieldset>}
      </section>}
      <form onSubmit={(e) => { e.preventDefault(); if (!deciding.current && !tariff.attempt) void tariff.save(); }} className="pricing-combination-editor">
      <section className="pricing-entry-section" aria-labelledby="pricing-set-price">
      <h2 id="pricing-set-price">{editing ? 'Append a dated price' : '3. Set price'}</h2>
      <p id="pricing-mrp-help">MRP is the total for each resulting suborder, not per allergen or ml. Explicit 0 is valid; blank is not zero.</p>
      {!editing && !allCategories && size > 1 && category?.status === 'active' && <fieldset className="pricing-entry-modes" disabled={disabled || tariff.blocked}>
        <legend>Pricing mode</legend>
        {['all', 'choose'].map((value) => <label key={value}><input type="radio" name="pricing-entry-mode" data-testid={`radio-pricing-mode-${value}`}
          checked={combinationMode === value} onChange={(e) => change(() => setCombinationMode(value), e.target)} />
          {value === 'all' ? 'Same price for all combinations' : 'Set prices individually'}</label>)}
      </fieldset>}
      {tariff.busy && <p role="status">Loading or saving combination rates…</p>}
      {(tariff.error || localError) && <div className="admin-feedback admin-feedback--error" role="alert">
        {tariff.error && <p>{tariff.error}</p>}
        {localError && <p>{localError}</p>}
        {!tariff.attempt && category?.status === 'active' && <div className="pricing-entry-secondary-actions">{recoveryActions}</div>}
      </div>}
      {tariff.attempt && <div className="pricing-entry-recovery" data-testid="pricing-identical-retry">
        <p role="status">{tariff.busy ? 'Submitting the frozen pricing rules…' : 'Resolve this submission before editing or leaving. Retry sends exactly the original submission.'}</p>
        <button type="button" data-testid="button-retry-identical-pricing" className="admin-button" disabled={tariff.busy} onClick={tariff.save}>Retry same submission</button>
      </div>}
      {tariff.notice && <p role="status" className="admin-feedback">{tariff.notice}</p>}
      {!category && <p>Choose a category and allergens to enter a price.</p>}
      {tariff.page && <>
        {!tariff.page.scopeTotal && <p>No eligible targets in this scope. {allCategories
          ? `No category has at least ${size} eligible Mix allergens. Nothing can be saved.`
          : size > 1
          ? `Select at least ${size} eligible Mix allergens, or choose 1 allergen per rule.`
          : 'Select at least one eligible allergen.'}</p>}
        <div className="pricing-combination-batch">
          {mode !== 'choose' && <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-rate">Total MRP (₹)</label>
            <input id="combination-rate" data-testid="input-pricing-total-mrp" className="mr-form__control" inputMode="decimal" maxLength={15} required
              value={commonMrp} aria-describedby="pricing-mrp-help"
              disabled={disabled || tariff.blocked} onChange={(e) => editing
                ? tariff.edit(saved.memberIds.join(','), e.target.value) : tariff.rate(e.target.value)} /></div>}
          <div className="mr-form__field"><label className="mr-form__label" htmlFor="combination-effective">Effective from</label>
            <input id="combination-effective" data-testid="input-pricing-effective-from" className="mr-form__control" type="date" required value={tariff.draft.effectiveFrom}
              aria-describedby="pricing-date-help" disabled={disabled || tariff.blocked} onChange={(e) => tariff.date(e.target.value)} /></div>
        </div>
        <p id="pricing-date-help" className="pricing-rules-note">{editing ? 'Enter a new date for this exact rule. ' : 'The date applies to every rule in this save. '}
          Saving appends dated prices; a date already used by any target rule is rejected, never overwritten.</p>
        {(mode === 'choose' || allCategories) && <>
        <p id="pricing-combination-search-help" role="status" data-testid="status-combination-selection">{allCategories
          ? <strong>Review only: every one of the {tariff.page.scopeTotal} rules will receive the common MRP, regardless of search or page.</strong>
          : <><strong>{chosenCount} combinations checked across all pages.</strong> Enter a price for each. Search only changes the choices shown.</>}</p>
        <label className="admin-search pricing-combination-search"><span className="pricing-sr-only">{allCategories ? 'Search categories or combinations' : 'Search combinations'}</span>
          <input type="search" data-testid="input-pricing-combination-search" value={tariff.view.query} maxLength={100} placeholder={allCategories ? 'Search category or combination names…' : 'Search combination names…'} aria-describedby="pricing-combination-search-help"
            disabled={Boolean(tariff.attempt) || selecting || tariff.blocked}
            onChange={(e) => tariff.changeView({ query: e.target.value, offset: 0 })} /></label>
        <div className="pricing-chosen-list" aria-label="Choose combination rates" aria-busy={tariff.busy}>
          {!tariff.busy && tariff.page.items.map((row) => {
            const chosen = Object.hasOwn(tariff.draft.edits, row.key);
            const name = row.members.map((m) => m.name).join(' + ');
            return <div key={row.key} className="pricing-chosen-row">
              {allCategories ? <div className="pricing-chosen-members"><span><strong>{row.categoryName}</strong> · {name}</span></div>
                : <label className="pricing-chosen-members"><input type="checkbox" data-testid={`checkbox-pricing-combination-${row.key}`} checked={chosen} disabled={disabled || tariff.blocked}
                  onChange={(e) => toggleCombination(row.key, e.target.checked, e.target)} /><span>{name}</span></label>}
              {chosen && <label className="pricing-chosen-rate"><span>Total MRP (₹)<span className="pricing-sr-only"> for {name}</span></span>
                <input data-testid={`input-pricing-combination-mrp-${row.key}`} className="mr-form__control" inputMode="decimal" maxLength={15} required={chosen}
                  disabled={!chosen || disabled || tariff.blocked} value={tariff.draft.edits[row.key] ?? ''}
                  aria-describedby="pricing-mrp-help" placeholder="Enter total MRP" onChange={(e) => tariff.edit(row.key, e.target.value)} /></label>}
            </div>;
          })}
          {!tariff.busy && !tariff.page.items.length && <p>No matching eligible combinations. {allCategories
            ? 'Try another search; the complete save scope above is unchanged.' : 'Try another search or select more Mix allergens.'}</p>}
        </div>
        <p className="pricing-rules-note">{tariff.page.total} matching combinations / {tariff.page.scopeTotal} eligible combinations</p>
        {(tariff.page.total > tariff.view.limit || tariff.view.offset > 0) && <div className="admin-panel__foot admin-pagination">
          <span>Page {Math.floor(tariff.view.offset / tariff.view.limit) + 1}</span>
          <label>Rows per page <select value={tariff.view.limit} disabled={disabled || tariff.blocked}
            onChange={(e) => tariff.changeView({ limit: Number(e.target.value), offset: 0 })}>
            {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || !tariff.view.offset}
            onClick={() => tariff.changeView({ offset: Math.max(0, tariff.view.offset - tariff.view.limit) })}>Previous</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={disabled || tariff.blocked || tariff.view.offset + tariff.view.limit >= tariff.page.total}
            onClick={() => tariff.changeView({ offset: tariff.view.offset + tariff.view.limit })}>Next</button>
        </div>}</>}
      </>}
      </section>
      <div className="pricing-entry-footer">
        {tariff.dirty && <p className="pricing-rules-note" role="status">Unsaved changes</p>}
        <p className="pricing-target-summary" role="status" data-testid="pricing-save-summary">
          {category ? <>{category.name} · {dosage} · {SIZES[size - 1]} per rule.{' '}
            {tariff.attempt ? <strong>{affectedCount} pricing rule{affectedCount === 1 ? '' : 's'} in the frozen submission; {tariff.busy ? 'awaiting result' : 'outcome unknown'}.</strong>
              : tariff.page ? <strong>{affectedCount} pricing rule{affectedCount === 1 ? '' : 's'} {tariff.blocked ? 'selected; reload required before saving' : editing ? 'will receive a new dated price' : 'will be saved'}.</strong>
                : mode === 'choose' ? `${chosenCount} checked combinations retained; eligible rule count unavailable until choices load.`
                  : 'Rule count unavailable until eligible choices load.'}{' '}
            Effective from: {tariff.draft.effectiveFrom ? formatAdminDate(tariff.draft.effectiveFrom, prefs) || tariff.draft.effectiveFrom : 'not entered'}.
            {mode !== 'choose' && <> Total MRP (₹): {commonMrp.trim() || 'not entered'}{!editing && ' for each rule'}.</>}
            {allCategories && <> One-time application to the current eligible catalogue only: each category-specific rule receives this total suborder MRP.
              Future categories and allergens are not automatically priced. Saved orders and current order pricing are unchanged.</>}
          </> : 'Select a category to prepare pricing rules.'}
        </p>
        <div className="pricing-policy-actions"><button type="button" data-testid="button-cancel-pricing" className="admin-button admin-button--secondary" disabled={disabled}
          onClick={() => navigate('/admin/pricing-rules')}>Cancel</button>
          {!tariff.attempt && <button type="submit" data-testid="button-save-pricing" className="admin-button"
            disabled={disabled || tariff.blocked || !tariff.page || !affectedCount}>Save pricing rule{affectedCount === 1 ? '' : 's'}</button>}
        </div>
      </div>
      </form>
      {category && <details className="pricing-entry-more">
        <summary data-testid="toggle-pricing-more-options">More options</summary>
        <div className="pricing-entry-secondary-actions">
          {!tariff.attempt && !(tariff.error || localError) && category.status === 'active' && recoveryActions}
          {editing && <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
            onClick={(e) => showHistory(saved.memberIds.join(','), e.currentTarget)}>Review this rule’s history</button>}
          {!allCategories && <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
            onClick={(e) => showHistory('', e.currentTarget)}>Review saved {dosage} rules</button>}
        </div>
        {!editing && mode === 'choose' && tariff.page && <details className="pricing-count-history">
          <summary>History for combinations on this page</summary>
          <ul className="pricing-entry-history-list">{tariff.page.items.map((row) => <li key={row.key}>
            <button type="button" className="admin-button admin-button--secondary" disabled={disabled}
              onClick={(e) => showHistory(row.key, e.currentTarget)}>History: {row.members.map((m) => m.name).join(' + ')}</button>
          </li>)}</ul>
        </details>}
        {!allCategories && <details className="pricing-count-history" onToggle={(e) => setCountOpen(e.currentTarget.open)}>
        <summary>Historical category/count tariffs · read-only</summary>
        {countOpen && <CountTariffEvidence key={category.id} categoryId={category.id} />}
        </details>}
      </details>}
    </section>
    {history && <CombinationPricingHistory {...history} returnFocusRef={historyTrigger} onClose={() => setHistory(null)} />}
  </>;
}
