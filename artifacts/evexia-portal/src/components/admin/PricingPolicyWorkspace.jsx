import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Dialog from './Dialog.jsx';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';
import useCountTariffs from './useCountTariffs.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { tariffCategories } from '../../services/serverCountTariffs.js';

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
  const [selected, setSelected] = useState(null);
  const [savedOnly, setSavedOnly] = useState(true);
  const [revision, setRevision] = useState(0);
  const choices = useTariffCategories(editorOpen ? false : savedOnly, revision);
  const tariff = useCountTariffs(selected?.id, true, session.user?.id, { pricingOnly: true });
  const prefs = useAdminPreferences();
  const date = (value) => formatAdminDate(value, prefs) || value;
  const addButton = useRef(null);
  const editButton = useRef(null);
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
  function openEditor(create) {
    const state = tariff.getGuardState();
    if (confirming.current || state.busy || state.uncertain || state.dirty) return;
    returnFocus.current = create ? addButton.current : editButton.current;
    choices.search('');
    if (create) setSelected(null);
    setEditorOpen(true);
  }
  const picker = <div className="pricing-field pricing-category-field">
    <label htmlFor={pickerId}>Product Category</label>
    <AllergenSearchableSelect id={pickerId} label="Product Category" value={selected?.id || ''}
      selectedLabel={selected ? categoryLabel(selected) : undefined}
      options={choices.items.map((item) => ({ value: item.id, label: categoryLabel(item) }))}
      placeholder={editorOpen ? 'Search and select a category' : 'Select a category to review'}
      disabled={tariff.locked} onChange={choose} onSearch={choices.search}
      loading={choices.busy} error={choices.error} onRetry={() => choices.search(choices.query, true)}
      hasMore={choices.nextOffset !== null} onMore={choices.more} moreLabel="Load more categories" />
  </div>;
  const status = <>
    {tariff.busy && <p className="pricing-policy-status" role="status">Loading or saving MRP…</p>}
    {tariff.error && <p className="pricing-policy-status admin-feedback--error" role="alert">{tariff.error}</p>}
    {tariff.notice && <p className="pricing-policy-status" role="status">{tariff.notice}</p>}
    {tariff.dirty && <p className="pricing-policy-status" role="status">Unsaved MRP changes. Each count is saved separately.</p>}
  </>;
  return <>
    <div className="admin-page-head pricing-page-head"><div>
      <p className="admin-page-head__eyebrow">Configuration / Pricing</p><h1>Pricing Rules</h1>
      <p className="admin-page-head__description">Total suborder MRP by category and exact allergen count. Dated revisions keep saved orders unchanged.</p>
    </div><button ref={addButton} type="button" className="admin-button" disabled={tariff.locked}
      onClick={() => openEditor(true)}><Plus size={16} aria-hidden="true" />Add Pricing Policy</button></div>
    <section className="admin-panel pricing-policy-workspace" aria-label="Saved MRP policies">
      <h2>Saved pricing policies</h2>
      <p className="pricing-rules-note">Review a category’s MRP and dated history. Each amount is the total suborder MRP in INR, not per ml or per allergen.</p>
      {!editorOpen && <div className="pricing-policy-controls">{picker}
        <label className="pricing-saved-filter"><input type="checkbox" checked={savedOnly} disabled={tariff.locked}
          onChange={(event) => { choices.search('', true); setSavedOnly(event.target.checked); }} />Saved tariffs only</label>
      </div>}
      <div hidden={editorOpen}>
        {!selected && <p className="pricing-policy-status">{choices.busy ? 'Loading category choices…'
          : choices.error ? 'Category choices could not be loaded. Open the selector to retry.'
            : !choices.items.length ? 'No matching categories. Turn off “Saved tariffs only” to browse all categories, or add a pricing policy.'
              : 'Choose a category above to review saved MRP, or add a pricing policy.'}</p>}
        {status}
        {selected && <div className="pricing-policy-review-head"><h3>{categoryLabel(selected)}</h3>
          <button ref={editButton} type="button" className="admin-button admin-button--secondary" disabled={tariff.locked || !tariff.saved}
            onClick={() => openEditor(false)}>Add dated MRP</button></div>}
        {tariff.saved && <div className="pricing-policy-summary">{counts.map((count) => {
          const history = historyFor(tariff, count);
          return <section className="pricing-policy-summary__row" key={count}>
            <h3>{countName(count)} · {count} {count === 1 ? 'allergen' : 'allergens'}</h3>
            {!history.length ? <p>No saved MRP for this count.</p> : <>
              <strong>₹{history[history.length - 1].totalMrp} MRP</strong>
              <p>Latest dated revision from <time dateTime={history[history.length - 1].effectiveFrom}>
                {date(history[history.length - 1].effectiveFrom)}</time></p>
              <details className="pricing-count-history"><summary>Saved MRP history ({history.length})</summary>
                <TariffHistory history={history} date={date} />
              </details>
            </>}
          </section>;
        })}</div>}
        {selected && !tariff.saved && !tariff.busy && <button className="admin-button admin-button--secondary" type="button"
          onClick={() => tariff.reload()}>Retry MRP history</button>}
      </div>
    </section>
    {editorOpen && <Dialog className="pricing-policy-dialog" title="Pricing Policy" eyebrow="Category / MRP"
      description="Set total suborder MRP in INR for Single, Double and Triple. Save each count with its own explicit Effective From date. Zero is a valid explicit amount."
      onClose={closeEditor} dismissDisabled={tariff.locked} returnFocusRef={returnFocus}>
      <div className="pricing-policy-editor">
        {picker}
        {!selected && <p className="pricing-rules-note">Select a category to create or review its dated MRP policy.</p>}
        {status}
        {tariff.blocked && !tariff.attempt && <p className="pricing-policy-status admin-feedback--error" role="alert">
          Saving is paused. Reload MRP history, compare the retained amounts and dates with saved history, then save a new revision.
        </p>}
        {selected && <div className="pricing-policy-actions">
          {tariff.attempt ? <button className="admin-button" type="button" disabled={tariff.busy}
            onClick={() => tariff.save(tariff.attempt.allergenCount)}>Retry same MRP submission</button> : <>
            <button className="admin-button admin-button--secondary" type="button" disabled={tariff.busy}
              onClick={() => tariff.reload()}>Reload MRP history; keep edits</button>
            <button className="admin-button admin-button--secondary" type="button" disabled={tariff.busy || !tariff.dirty}
              onClick={tariff.cancel}>Cancel MRP edits</button>
          </>}
        </div>}
        {tariff.saved && tariff.drafts && <div className="pricing-policy-rows">{counts.map((count) =>
          <PricingCountRow key={count} count={count} tariff={tariff} date={date} />)}</div>}
        <div className="pricing-policy-actions"><button className="admin-button admin-button--secondary" type="button"
          disabled={tariff.locked} onClick={closeEditor}>Close editor</button></div>
      </div>
    </Dialog>}
  </>;
}

function PricingCountRow({ count, tariff, date }) {
  const draft = tariff.drafts[count];
  const history = historyFor(tariff, count);
  return <section className="pricing-count-row" aria-labelledby={`pricing-count-${count}`}>
    <h3 id={`pricing-count-${count}`}>{countName(count)} · {count} {count === 1 ? 'allergen' : 'allergens'}</h3>
    <div className="pricing-count-row__fields">
      <div className="pricing-field"><label htmlFor={`pricing-mrp-${count}`}>{countName(count)} MRP (INR)</label>
        <input className="pricing-input" id={`pricing-mrp-${count}`} inputMode="decimal" maxLength={64}
          value={draft.totalMrp} disabled={tariff.locked} aria-describedby={`pricing-hint-${count}`}
          onChange={(event) => tariff.edit(count, 'totalMrp', event.target.value)} /></div>
      <div className="pricing-field"><label htmlFor={`pricing-date-${count}`}>Effective From</label>
        <input className="pricing-input" id={`pricing-date-${count}`} type="date" value={draft.effectiveFrom}
          aria-label={`${countName(count)} MRP Effective From`} disabled={tariff.locked}
          onChange={(event) => tariff.edit(count, 'effectiveFrom', event.target.value)} /></div>
      <button type="button" className="admin-button" disabled={tariff.locked || tariff.blocked}
        onClick={() => tariff.save(count)}>Save {countName(count)} MRP</button>
    </div>
    <p id={`pricing-hint-${count}`} className="pricing-count-row__hint">
      {!history.length ? tariff.saved.suggestedUnitPrice === null
        ? `${tariff.saved.suggestionError} Enter an explicit MRP.`
        : `Editable Unit Price suggestion: ₹${tariff.saved.suggestedUnitPrice} from ${tariff.saved.categoryName} (category version ${tariff.saved.categoryVersion}). Not saved or multiplied by count.`
        : 'Saved MRP shown. Enter an explicit date to append a revision; existing history cannot be overwritten.'}
    </p>
    <details className="pricing-count-history"><summary>MRP history ({history.length})</summary>
      <TariffHistory history={history} date={date} />
    </details>
  </section>;
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
