import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Dialog from './Dialog.jsx';
import DataTable from './DataTable.jsx';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';
import useCountTariffs from './useCountTariffs.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { tariffCategories } from '../../services/serverCountTariffs.js';
import '../../mr.css';

const counts = [1, 2, 3];
const countName = (count) => ['', 'Single', 'Double', 'Triple'][count];
const categoryLabel = (category) => `${category.name}${category.status === 'active' ? '' : ' (inactive)'}`;
const historyFor = (tariff, count) => (tariff.saved?.history || [])
  .filter((row) => row.allergenCount === count).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

// Category discovery remains scoped and paged through the existing tariff API.
function useTariffCategories(savedOnly, revision) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState({ items: [], nextOffset: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const seq = ++sequence.current;
    pending.current = true;
    setPage({ items: [], nextOffset: null }); setBusy(true); setError('');
    const timer = setTimeout(() => tariffCategories({ query, savedOnly, limit: 50 }, controller.signal)
      .then((value) => { if (seq === sequence.current) setPage(value); })
      .catch((cause) => { if (!controller.signal.aborted && seq === sequence.current) setError(cause.message); })
      .finally(() => { if (seq === sequence.current) { pending.current = false; setBusy(false); } }), 200);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; };
  }, [query, savedOnly, revision, retry]);
  function search(text, force = false) {
    if (!force && text === query) return;
    sequence.current++; pending.current = true;
    setPage({ items: [], nextOffset: null }); setBusy(true); setError('');
    if (force) setRetry((value) => value + 1);
    else setQuery(text);
  }
  async function more() {
    if (pending.current || page.nextOffset === null) return;
    const seq = sequence.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const value = await tariffCategories({ query, savedOnly, offset: page.nextOffset, limit: 50 });
      if (seq === sequence.current) setPage((old) => ({ ...value,
        items: [...old.items, ...value.items.filter((item) => !old.items.some((known) => known.id === item.id))] }));
    } catch (cause) { if (seq === sequence.current) setError(cause.message); }
    finally { if (seq === sequence.current) { pending.current = false; setBusy(false); } }
  }
  return { ...page, query, busy, error, search, more };
}

export default function PricingPolicyWorkspace() {
  const session = useAdminSession();
  const confirm = usePlatformConfirm();
  const [editorOpen, setEditorOpen] = useState(false);
  const [allergenCount, setAllergenCount] = useState('');
  const [selected, setSelected] = useState(null);
  const [savedOnly, setSavedOnly] = useState(true);
  const [revision, setRevision] = useState(0);
  const choices = useTariffCategories(editorOpen ? false : savedOnly, revision);
  const tariff = useCountTariffs(selected?.id, true, session.user?.id, { pricingOnly: true });
  const prefs = useAdminPreferences();
  const date = (value) => formatAdminDate(value, prefs) || value;
  const addButton = useRef(null);
  const returnFocus = useRef(null);
  const pickerId = editorOpen ? 'pricing-policy-category' : 'pricing-review-category';
  const choiceSequence = useRef(0);
  const confirming = useRef(false);
  const latest = useRef({});
  latest.current = { tariff, selected, editorOpen, pickerId };
  useConfirmedNavigation(() => latest.current.tariff.getGuardState(), 'Discard unsaved MRP changes and leave Pricing Rules?');
  useEffect(() => {
    const unload = (event) => {
      const state = latest.current.tariff.getGuardState();
      if (!state.dirty && !state.busy && !state.uncertain) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('beforeunload', unload); choiceSequence.current++; };
  }, []);
  // Refresh saved-only discovery after a confirmed append without touching drafts.
  const historySize = tariff.saved?.history.length || 0;
  const observed = useRef({ categoryId: null, historySize: 0 });
  useEffect(() => {
    if (observed.current.categoryId === selected?.id && historySize > observed.current.historySize) {
      setRevision((value) => value + 1);
    }
    observed.current = { categoryId: selected?.id, historySize };
  }, [selected?.id, historySize]);

  async function allowDiscard(message) {
    const state = latest.current.tariff.getGuardState();
    if (confirming.current || state.busy || state.uncertain) return false;
    if (!state.dirty) return true;
    confirming.current = true;
    try {
      const accepted = await confirm(message);
      const now = latest.current.tariff.getGuardState();
      return accepted && !now.busy && !now.uncertain;
    } finally { confirming.current = false; }
  }
  async function choose(id) {
    if (id === latest.current.selected?.id) return;
    // Capture before the shared picker resets the menu's search results.
    const category = choices.items.find((item) => item.id === id) || null;
    if (id && !category) return;
    const choice = ++choiceSequence.current;
    document.getElementById(latest.current.pickerId)?.focus();
    if (!await allowDiscard('Discard unsaved MRP amounts and dates for this category?')) return;
    const now = latest.current.tariff.getGuardState();
    if (choice !== choiceSequence.current || now.busy || now.uncertain) return;
    setSelected(category);
  }
  async function closeEditor() {
    if (!await allowDiscard('Discard unsaved MRP amounts and dates and close the editor?')) return;
    const now = latest.current.tariff.getGuardState();
    if (now.busy || now.uncertain) return;
    choiceSequence.current++;
    if (!returnFocus.current?.isConnected) returnFocus.current = addButton.current;
    latest.current.tariff.cancel();
    choices.search('');
    setEditorOpen(false);
  }
  function openEditor(count = '', trigger = addButton.current) {
    const state = tariff.getGuardState();
    if (confirming.current || state.busy || state.uncertain || state.dirty) return;
    returnFocus.current = trigger;
    choices.search('');
    if (!count) setSelected(null);
    setAllergenCount(count);
    setEditorOpen(true);
  }
  function chooseCount(value) {
    const state = latest.current.tariff.getGuardState();
    if (confirming.current || state.busy || state.uncertain) return;
    // Keep every count's draft in the existing hook; switching only changes
    // which draft is visible, never its amount/date or an unresolved request.
    setAllergenCount(value ? Number(value) : '');
  }
  function submit(event) {
    event.preventDefault();
    const state = latest.current.tariff.getGuardState();
    if (confirming.current || state.busy) return;
    if (tariff.attempt) { void tariff.save(tariff.attempt.allergenCount); return; }
    if (selected && counts.includes(allergenCount)) void tariff.save(allergenCount);
  }
  const picker = <div className="mr-form__field pricing-category-field">
    <label className="mr-form__label" htmlFor={pickerId}>Product Category{editorOpen ? ' *' : ''}</label>
    <AllergenSearchableSelect id={pickerId} label="Product Category" value={selected?.id || ''}
      testId={pickerId}
      selectedLabel={selected ? categoryLabel(selected) : undefined}
      options={choices.items.map((item) => ({ value: item.id, label: categoryLabel(item) }))}
      placeholder={editorOpen ? 'Search and select a category' : 'Select a category to review'}
      disabled={tariff.locked} onChange={choose} onSearch={choices.search} searchMaxLength={100}
      loading={choices.busy} error={choices.error} onRetry={() => choices.search(choices.query, true)}
      hasMore={choices.nextOffset !== null} onMore={choices.more} moreLabel="Load more categories" />
  </div>;
  const categoryError = !choices.busy && choices.error && <div className="admin-feedback admin-feedback--error pricing-category-error">
    <p role="alert">Category choices could not be loaded. {choices.error}</p>
    <button type="button" className="admin-button admin-button--secondary" disabled={tariff.locked}
      onClick={() => choices.search(choices.query, true)}>Retry category choices</button>
  </div>;
  const status = <>
    {tariff.busy && <p className="admin-feedback" role="status">Loading or saving MRP…</p>}
    {tariff.error && <p className="admin-feedback admin-feedback--error" role="alert">{tariff.error}</p>}
    {tariff.notice && <p className="admin-feedback" role="status">{tariff.notice}</p>}
    {tariff.dirty && <p className="admin-feedback" role="status">Unsaved MRP changes. Switching counts keeps each count’s edits; Save applies only to the selected count. Changing category or cancelling discards all unsaved counts only after confirmation.</p>}
  </>;
  const rows = tariff.saved ? counts.map((count) => {
    const history = historyFor(tariff, count);
    return { count, history, latest: history[history.length - 1] };
  }) : [];
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_row, index) => index + 1 },
    { key: 'category', label: 'Product Category', render: () => categoryLabel(selected) },
    { key: 'count', label: 'Allergen Count', render: (row) => `${row.count} (${countName(row.count)})` },
    { key: 'rate', label: 'Rate / Total Suborder MRP (INR)', render: (row) => row.latest
      ? <span className="pricing-table__amount">₹{row.latest.totalMrp}</span> : 'Unconfigured' },
    { key: 'effectiveFrom', label: 'Effective From', render: (row) => row.latest
      ? <><time dateTime={row.latest.effectiveFrom}>{date(row.latest.effectiveFrom)}</time><p className="pricing-rules-note">Latest dated revision; not necessarily effective today.</p></>
      : 'No saved date' },
    { key: 'actions', label: 'Actions / History', render: (row) => <>
      <button type="button" className="admin-button admin-button--secondary" disabled={tariff.locked}
        data-testid={`button-pricing-revision-${row.count}`}
        aria-label={`${row.latest ? 'Add dated rate' : 'Configure rate'} for ${row.count} ${row.count === 1 ? 'allergen' : 'allergens'}`}
        onClick={(event) => openEditor(row.count, event.currentTarget)}>{row.latest ? 'Add dated rate' : 'Configure rate'}</button>
      {row.history.length > 0 && <details className="pricing-count-history"><summary>Saved history ({row.history.length})</summary>
        <TariffHistory history={row.history} date={date} />
      </details>}
    </> },
  ];
  return <>
    <div className="admin-page-head pricing-page-head"><div>
      <p className="admin-page-head__eyebrow">Configuration / Pricing</p><h1>Pricing Rules</h1>
      <p className="admin-page-head__description">Total suborder MRP by category and exact allergen count. Dated revisions keep saved orders unchanged.</p>
    </div><button ref={addButton} type="button" className="admin-button" disabled={tariff.locked}
      data-testid="button-add-pricing-rule" onClick={() => openEditor()}><Plus size={16} aria-hidden="true" />Add Pricing Rule</button></div>
    <section className="admin-panel pricing-policy-workspace" aria-label="Saved pricing rules">
      <h2>Saved pricing rules</h2>
      <p className="pricing-rules-note">Review a category’s MRP and dated history. Each amount is the total suborder MRP in INR, not per ml or per allergen.</p>
      {!editorOpen && <div className="pricing-policy-controls">{picker}
        <label className="pricing-saved-filter"><input type="checkbox" checked={savedOnly} disabled={tariff.locked}
          data-testid="checkbox-pricing-saved-only"
          onChange={(event) => { choices.search('', true); setSavedOnly(event.target.checked); }} />Saved tariffs only</label>
      </div>}
      {!editorOpen && categoryError}
      <div hidden={editorOpen}>
        {!selected && !choices.error && <p className="admin-feedback" role="status">{choices.busy ? 'Loading category choices…'
          : !choices.items.length ? 'No matching categories. Turn off “Saved tariffs only” to browse all categories, or add a pricing rule.'
              : 'Choose a category above to review saved MRP, or add a pricing rule.'}</p>}
        {status}
        {selected && <DataTable columns={columns} rows={rows} rowKey={(row) => row.count}
          label="Selected category pricing rules" testIdPrefix="pricing-count" loading={tariff.busy && !tariff.saved}
          loadingLabel="Loading category pricing rules…" empty={<p>No saved pricing history is available. Retry loading this category.</p>} />}
        {selected && !tariff.saved && !tariff.busy && <button className="admin-button admin-button--secondary" type="button"
          data-testid="button-retry-pricing-history"
          onClick={() => tariff.reload()}>Retry MRP history</button>}
      </div>
    </section>
    {editorOpen && <Dialog className="pricing-policy-dialog" title="Add Pricing Rule" eyebrow="Category / MRP"
      description="Choose one category and allergen count. Enter total suborder MRP in INR and an explicit Effective From date. Zero is a valid amount; saved history cannot be overwritten."
      onClose={closeEditor} dismissDisabled={tariff.locked} returnFocusRef={returnFocus}>
      <form className="pricing-policy-editor" onSubmit={submit}>
        <div className="mr-form__grid pricing-policy-form-grid">
          {picker}
          <div className="mr-form__field">
            <label className="mr-form__label" htmlFor="pricing-policy-count">Allergen Count *</label>
            <select id="pricing-policy-count" className="mr-form__control" required value={allergenCount}
              disabled={tariff.locked} onChange={(event) => chooseCount(event.target.value)} data-testid="select-pricing-count">
              <option value="" disabled>Select allergen count</option>
              {counts.map((count) => <option key={count} value={count}>{count} ({countName(count)})</option>)}
            </select>
          </div>
          {tariff.saved && tariff.drafts && counts.includes(allergenCount) &&
            <PricingCountFields key={`${selected.id}-${allergenCount}`} count={allergenCount} tariff={tariff} />}
        </div>
        {categoryError}
        {!selected && <p className="pricing-rules-note">Select a category to create or review its dated MRP policy.</p>}
        {status}
        {tariff.blocked && !tariff.attempt && <p className="admin-feedback admin-feedback--error" role="alert">
          Saving is paused. Reload MRP history, compare the retained amounts and dates with saved history, then save a new revision.
        </p>}
        {selected && <div className="pricing-policy-actions">
          {tariff.attempt ? <button className="admin-button" type="button" disabled={tariff.busy}
            data-testid="button-retry-pricing-submission"
            onClick={() => tariff.save(tariff.attempt.allergenCount)}>Retry same MRP submission</button> :
            <button className="admin-button admin-button--secondary" type="button" disabled={tariff.busy}
              data-testid="button-reload-pricing-history"
              onClick={() => tariff.reload()}>Reload MRP history; keep edits</button>
          }
        </div>}
        {tariff.saved && counts.includes(allergenCount) && <details key={`${selected.id}-${allergenCount}`}
          className="pricing-count-history"><summary>Saved history for count {allergenCount} ({historyFor(tariff, allergenCount).length})</summary>
          <TariffHistory history={historyFor(tariff, allergenCount)} date={date} />
        </details>}
        <div className="admin-dialog__actions">
          <button className="admin-button admin-button--secondary" type="button" data-testid="button-cancel-pricing-rule"
            disabled={tariff.locked} onClick={closeEditor}>Cancel</button>
          <button className="admin-button" type="submit" data-testid="button-save-pricing-rule"
            disabled={tariff.locked || tariff.blocked || !tariff.saved || !tariff.drafts || !selected || !counts.includes(allergenCount)}>Save</button>
        </div>
      </form>
    </Dialog>}
  </>;
}

function PricingCountFields({ count, tariff }) {
  const draft = tariff.drafts[count];
  const history = historyFor(tariff, count);
  return <>
      <div className="mr-form__field"><label className="mr-form__label" htmlFor={`pricing-mrp-${count}`}>Rate / Total Suborder MRP (INR) *</label>
        <input className="mr-form__control" id={`pricing-mrp-${count}`} inputMode="decimal" maxLength={64} required
          data-testid={`input-pricing-mrp-${count}`}
          value={draft.totalMrp} disabled={tariff.locked} aria-describedby={`pricing-hint-${count}`}
          onChange={(event) => tariff.edit(count, 'totalMrp', event.target.value)} /></div>
      <div className="mr-form__field"><label className="mr-form__label" htmlFor={`pricing-date-${count}`}>Effective From *</label>
        <input className="mr-form__control" id={`pricing-date-${count}`} type="date" value={draft.effectiveFrom} required
          data-testid={`input-pricing-date-${count}`}
          aria-label={`${countName(count)} MRP Effective From`} disabled={tariff.locked}
          onChange={(event) => tariff.edit(count, 'effectiveFrom', event.target.value)} /></div>
    <p id={`pricing-hint-${count}`} className="mr-form__hint mr-form__field--wide">
      {!history.length ? tariff.saved.suggestedUnitPrice === null
        ? `${tariff.saved.suggestionError} Enter an explicit MRP.`
        : `Editable Unit Price suggestion: ₹${tariff.saved.suggestedUnitPrice} from ${tariff.saved.categoryName} (category version ${tariff.saved.categoryVersion}). Not saved or multiplied by count.`
        : 'Latest dated MRP shown, not necessarily effective today. Enter an explicit date to append a revision; existing history cannot be overwritten.'}
    </p>
  </>;
}

function TariffHistory({ history, date }) {
  if (!history.length) return <p>No saved MRP. An unsaved suggestion cannot price an order.</p>;
  return <ol>{history.map((row, index) => <li key={row.id}>
    <strong>₹{row.totalMrp} MRP</strong>{' · From '}
    <time dateTime={row.effectiveFrom}>{date(row.effectiveFrom)}</time>
    {history[index + 1] ? ` until before ${date(history[index + 1].effectiveFrom)}` : ' onwards'} (starting day included).
    <small>Version {row.version}; revision {row.id}. Actor {row.actorId}; recorded {row.recordedAt}.</small>
  </li>)}</ol>;
}
