import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeIndianRupee, Copy, FolderOpen, Pencil, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import PricingMultiSelect from '../../components/admin/PricingMultiSelect.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import { formatAdminDate, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { catalogueRate, formatRate } from '../../services/rates.js';
import { MAX_ALLERGENS, fetchRuleAllergens, fetchRuleCategories, getPricingRule, listPricingRules, savePricingRule, validDate } from '../../services/serverPricingRules.js';
import '../../pricingRules.css';

const PAGE_SIZES = [10, 25, 50, 100];
const EMPTY = { categories: [], allergens: [], cutoff: '', beforeRate: '', afterRate: '' };
const shown = (rate) => { try { return formatRate(rate); } catch { return rate; } };
const showDate = (value, prefs) => { try { return formatAdminDate(value, prefs) || value; } catch { return value; } };
const refName = (r) => r.status === 'deleted' ? `${r.name} (deleted)` : r.status === 'inactive' ? `${r.name} (inactive)` : r.name;
const categoryNames = (rule) => rule.categories.map(refName).join(', ');
const allergenName = (rule, a) => `${rule.categories.find((c) => c.id === a.savedCategoryId)?.name || 'Saved category'}: ${refName(a)}${a.categoryId !== a.savedCategoryId ? ' (moved to another category)' : ''}`;

function classify(error) {
  // Session renewal can return 401 while an earlier save is still in flight.
  // Its explicit ambiguity takes precedence over ordinary 4xx classification.
  if (error?.malformed || error?.ambiguous) return 'uncertain';
  const status = Number(error?.status);
  const text = `${error?.code || ''} ${error?.message || ''}`;
  if (status === 409 && /stale|version/i.test(text)) return 'stale';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'definitive';
  return 'uncertain';
}

export default function PricingRules() {
  const session = useAdminSession();
  if (!isSuperAdminIdentity(session.user)) {
    return <AdminLayout title="Pricing Rules"><div className="admin-empty" role="alert" data-testid="status-pricing-rules-denied"><span className="admin-empty__icon"><BadgeIndianRupee size={21} aria-hidden="true" /></span><strong>Access is not available</strong><p>Pricing Rules can only be configured by a Super Admin.</p></div></AdminLayout>;
  }
  return <PricingWorkspace key={session.user?.id || 'signed-out'} />;
}

function PricingWorkspace() {
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(25);
  const [list, setList] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState(null);
  const prefs = useAdminPreferences();
  const mounted = useRef(true);
  const listCtl = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    listCtl.current = controller;
    let live = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => listPricingRules({ offset, limit, query: query.trim() }, controller.signal)
      .then((page) => { if (live && !controller.signal.aborted) { setList({ items: page.items, total: page.total }); setLoading(false); } })
      .catch((cause) => { if (live && !controller.signal.aborted) { setError(cause?.message || 'Pricing rules could not be loaded.'); setLoading(false); } }), query ? 250 : 0);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [offset, limit, reloadToken, query]);
  useEffect(() => { if (!loading && !error && offset > 0 && offset >= list.total) setOffset(Math.max(0, Math.floor((list.total - 1) / limit) * limit)); }, [loading, error, offset, list.total, limit]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);
  const open = (mode, rule = null) => {
    setFeedback('');
    const form = !rule ? EMPTY : mode === 'copy'
      ? { ...EMPTY, cutoff: rule.cutoff, beforeRate: rule.beforeRate, afterRate: rule.afterRate }
      : { categories: rule.categories.map((c) => ({ ...c })), allergens: rule.allergens.map((a) => ({ ...a })), cutoff: rule.cutoff, beforeRate: rule.beforeRate, afterRate: rule.afterRate };
    setEditor({ mode, rule, form, key: `${mode}-${rule?.id || 'new'}-${Date.now()}` });
  };
  const saved = (rule, mode) => {
    if (!mounted.current) return;
    setEditor(null);
    setFeedback(`Pricing rule for ${categoryNames(rule)} ${mode === 'edit' ? 'updated' : 'created'} (version ${rule.version}).`);
    retry();
  };

  const pageCount = Math.max(1, Math.ceil(list.total / limit));
  const page = Math.floor(offset / limit) + 1;
  const columns = [
    { key: 'serial', label: 'Sr. No.', render: (_, index) => index + 1 },
    { key: 'categories', label: 'Product categories', render: (rule) => <strong data-testid={`text-pricing-rule-category-${rule.id}`}>{categoryNames(rule)}</strong> },
    { key: 'allergens', label: 'Allergens', render: (rule) => <ul className="pricing-rule-row__chips pricing-rule-row__targets" aria-label="Allergens">{rule.allergens.map((a) => <li key={a.id} className={`pricing-chip${a.status !== 'active' || a.categoryId !== a.savedCategoryId ? ' pricing-chip--deleted' : ''}`}>{allergenName(rule, a)}</li>)}</ul> },
    { key: 'cutoff', label: 'Order date cutoff', render: (rule) => <time dateTime={rule.cutoff} data-testid={`text-pricing-rule-cutoff-${rule.id}`}>{showDate(rule.cutoff, prefs)}</time> },
    { key: 'before', label: 'Before date (INR)', render: (rule) => <span className="pricing-table__amount" data-testid={`text-pricing-rule-before-${rule.id}`}>{shown(rule.beforeRate)}</span> },
    { key: 'after', label: 'On/after date (INR)', render: (rule) => <span className="pricing-table__amount" data-testid={`text-pricing-rule-after-${rule.id}`}>{shown(rule.afterRate)}</span> },
    { key: 'version', label: 'Version', render: (rule) => rule.version },
    { key: 'actions', label: 'Actions', render: (rule) => <div className="pricing-rule-row__actions">
      <button type="button" className="admin-icon-button" disabled={Boolean(editor)} aria-label={`Edit pricing rule for ${categoryNames(rule)}`} title="Edit" onClick={() => open('edit', rule)} data-testid={`button-edit-pricing-rule-${rule.id}`}><Pencil size={16} aria-hidden="true" /></button>
      <button type="button" className="admin-icon-button" disabled={Boolean(editor)} aria-label={`Copy pricing rule for ${categoryNames(rule)}`} title="Copy" onClick={() => open('copy', rule)} data-testid={`button-copy-pricing-rule-${rule.id}`}><Copy size={16} aria-hidden="true" /></button>
    </div> },
  ];
  return <AdminLayout title="Pricing Rules"><div className="pricing-rules-page">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Configuration / Pricing</p><h1>Pricing Rules</h1><p className="admin-page-head__description">INR per ml for new MR Immunotherapy Extract and the separately bound Dilution material. Saved orders retain their applied rates; the exact cutoff date uses the on/after rate.</p></div>
      <div className="admin-target-head-actions">
        <button type="button" className="admin-button" disabled={Boolean(editor)} onClick={() => open('new')} data-testid="button-add-pricing-rule"><Plus size={16} aria-hidden="true" /> Add rule</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-pricing-rule-feedback">{feedback}</div>}
    {editor && <RuleEditor key={editor.key} editor={editor} onClose={() => setEditor(null)} onSaved={saved} />}
    <section className="admin-panel pricing-rules-panel" aria-label="Pricing rule list" aria-busy={loading}>
      <div className="admin-toolbar master-filter-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="pricing-sr-only">Search saved rules by category or allergen</span><input type="search" value={query} maxLength={100} placeholder="Search categories or allergens…" onChange={(e) => { listCtl.current?.abort(); setLoading(true); setError(''); setQuery(e.target.value); setOffset(0); }} data-testid="input-search-pricing-rules" /></label>
      </div></div>
      {loading ? <DataTable columns={columns} loading label="Pricing rules" testIdPrefix="pricing-rule" />
        : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>Pricing rules could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" style={{ marginTop: 16 }} onClick={retry} data-testid="button-retry-pricing-rules">Try again</button></div>
        : list.items.length ? <DataTable columns={columns} rows={list.items} rowKey={(rule) => rule.id} rowOffset={offset} label="Pricing rules" testIdPrefix="pricing-rule" />
        : <div className="admin-empty" data-testid={query.trim() ? 'status-pricing-rules-no-matches' : 'status-pricing-rules-empty'}><span className="admin-empty__icon"><BadgeIndianRupee size={21} aria-hidden="true" /></span><strong>{query.trim() ? 'No matching pricing rules' : list.total ? 'No rules on this page' : 'No pricing rules yet'}</strong><p>{query.trim() ? 'Try another category or allergen name.' : list.total ? 'Go back to an earlier page.' : 'Add a rule to configure selling prices.'}</p></div>}
      {!error && !loading && <div className="admin-panel__foot admin-pagination">
        <span data-testid="text-pricing-rules-count">{list.total ? `${offset + 1}-${Math.min(offset + list.items.length, list.total)} of ${list.total} ${query.trim() ? 'matching ' : ''}rules` : `0 ${query.trim() ? 'matching ' : ''}rules`}</span>
        <div className="admin-pagination__controls">
          <label className="admin-pagination__size">Rows per page <select value={limit} disabled={loading} onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }} data-testid="select-pricing-rules-page-size">{PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <nav className="admin-pagination__pages" aria-label="Pricing rule pages">
            <button type="button" disabled={loading || page <= 1} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-pricing-rules-prev">Previous</button>
            <button type="button" className="admin-pagination__current" aria-current="page" disabled>{page}</button>
            <button type="button" disabled={loading || page >= pageCount} onClick={() => setOffset(offset + limit)} data-testid="button-pricing-rules-next">Next</button>
          </nav>
          <span className="admin-pagination__total" aria-live="polite">Page {page} of {pageCount}</span>
        </div>
      </div>}
    </section>
  </div></AdminLayout>;
}

function RuleEditor({ editor, onClose, onSaved }) {
  const { mode, rule } = editor;
  const [form, setForm] = useState(editor.form);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [attempt, setAttempt] = useState(null); // { ruleId, body, state: 'uncertain' }
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const [latest, setLatest] = useState({ state: 'idle', rule: null, error: '' });
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const latestCtl = useRef(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const prefs = useAdminPreferences();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; latestCtl.current?.abort(); }; }, []);
  const baseline = useRef(JSON.stringify(editor.form));
  const dirty = JSON.stringify(form) !== baseline.current;
  const uncertain = attempt?.state === 'uncertain';
  const navState = useRef();
   navState.current = { dirty, busy: busy || selectingAll, uncertain };
  useConfirmedNavigation(() => navState.current, (st) => st.uncertain
    ? 'The last save could not be confirmed and may already have been saved. This attempt exists only on this page; leaving discards it and its safe retry. Check the rule list afterwards before saving again.'
    : 'Discard this unsaved pricing rule draft and leave this page?', undefined,
    { actionLabel: (st) => st.uncertain ? 'Abandon unconfirmed save and leave' : 'Discard and leave' });
  useEffect(() => {
    const unload = (event) => {
      if (!navState.current.dirty && !navState.current.busy && !navState.current.uncertain) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setErrors({}); };
  const changeCategories = (categories) => {
    setErrors({});
    setForm((f) => {
      const removed = f.categories.filter((c) => !categories.some((next) => next.id === c.id)).map((c) => c.id);
      return { ...f, categories, allergens: f.allergens.filter((a) => !removed.includes(a.savedCategoryId)) };
    });
  };
  const categoryKey = form.categories.map((c) => c.id).sort().join(',');
  const fetchAllergens = useCallback((q, o, signal) => fetchRuleAllergens(categoryKey.split(',').filter(Boolean), q, o, signal), [categoryKey]);

  function validate() {
    const next = {};
    if (!form.categories.length) next.category = 'Choose at least one category.';
    else if (form.categories.some((c) => c.status !== 'active')) next.category = 'Remove categories that are no longer active.';
    if (!form.allergens.length) next.allergens = 'Choose at least one allergen.';
    else if (form.allergens.length > MAX_ALLERGENS) next.allergens = `Choose at most ${MAX_ALLERGENS} allergens.`;
    else if (form.allergens.some((a) => a.status !== 'active')) next.allergens = 'Remove allergens that are no longer active.';
    else if (form.allergens.some((a) => a.categoryId !== a.savedCategoryId || !form.categories.some((c) => c.id === a.categoryId))) next.allergens = 'Some allergens moved category. Remove them and explicitly reselect if eligible.';
    if (!validDate(form.cutoff)) next.cutoff = 'Enter a valid date.';
    for (const k of ['beforeRate', 'afterRate']) {
      try { catalogueRate(form[k].trim()); } catch (cause) { next[k] = cause.message; }
    }
    setErrors(next);
    return !Object.keys(next).length;
  }

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current || selectingAll) return;
    if (stale) return;
    let current = attempt;
    if (!uncertain) {
      if (!validate()) return;
      const body = { categoryIds: Object.freeze(form.categories.map((c) => c.id).sort()), allergenIds: Object.freeze([...new Set(form.allergens.map((a) => a.id))].sort()), cutoff: form.cutoff,
        allergenCategoryIds: Object.freeze(Object.fromEntries(form.allergens.map((a) => [a.id, a.savedCategoryId]))),
        beforeRate: catalogueRate(form.beforeRate.trim()), afterRate: catalogueRate(form.afterRate.trim()), idempotencyKey: crypto.randomUUID() };
      if (mode === 'edit') body.expected_version = rule.version;
      current = Object.freeze({ ruleId: mode === 'edit' ? rule.id : null, body: Object.freeze(body), state: 'sending' });
    }
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const result = await savePricingRule(current);
      if (!mounted.current) return;
      busyRef.current = false; setBusy(false);
      onSaved(result, mode);
    } catch (cause) {
      if (!mounted.current) return;
      busyRef.current = false; setBusy(false);
      const kind = classify(cause);
      if (kind === 'uncertain' || uncertain) {
        // A later HTTP rejection alone does not settle an earlier unknown save.
        // Keep its exact frozen body/key/version; never unlock a fresh attempt.
        setAttempt(Object.freeze({ ...current, state: 'uncertain' }));
        setMessage('Save unconfirmed; the rule may already be saved. Your draft is preserved and fields are locked. Use Retry same submission to confirm the original outcome.');
      } else if (kind === 'stale') {
        setAttempt(null); setStale(true);
        setMessage('This rule was changed by someone else since you opened it. Your draft is preserved but cannot overwrite the newer version. View the latest saved rule, then close and edit again if needed.');
      } else {
        setAttempt(null);
        setMessage(cause?.message || 'The server rejected this rule. Correct the fields and save again.');
      }
    }
  }

  async function viewLatest() {
    latestCtl.current?.abort();
    const controller = new AbortController();
    latestCtl.current = controller;
    setLatest({ state: 'loading', rule: null, error: '' });
    try {
      const fresh = await getPricingRule(rule.id, controller.signal);
      if (mounted.current && latestCtl.current === controller) setLatest({ state: 'ready', rule: fresh, error: '' });
    } catch (cause) {
      if (mounted.current && latestCtl.current === controller && !controller.signal.aborted) setLatest({ state: 'error', rule: null, error: cause?.message || 'Latest rule could not be loaded.' });
    }
  }

  function close() {
    if (busyRef.current || selectingAll) return;
    if (dirty || uncertain) { setConfirmClose(true); return; }
    onClose();
  }

  const title = mode === 'edit' ? `Edit rule: ${categoryNames(rule)}` : mode === 'copy' ? `Copy rule from ${categoryNames(rule)}` : 'New pricing rule';
  const lockedPlaceholder = uncertain ? 'Save unconfirmed — retry below' : 'Saving…';
  const err = (k) => errors[k] && <span id={`pricing-${k}-error`} className="pricing-field__error" role="alert">{errors[k]}</span>;
  return <Dialog title={title} eyebrow="Configuration / Pricing" onClose={close} dismissDisabled={busy || selectingAll} className="pricing-editor-dialog"
    description={mode === 'copy' ? 'Rates and cutoff are copied. Choose categories and allergens for the new rule.' : mode === 'edit' ? `Update the selected allergens and date-based prices. Saved version ${rule.version}.` : 'Select categories and allergens, then set the cutoff date and selling prices.'}>
    <div className="pricing-editor" data-testid="form-pricing-rule">
    {message && <div className={`admin-feedback${uncertain || stale ? '' : ' admin-feedback--error'}`} role="alert" data-testid="status-pricing-rule-error">{message}</div>}
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy || uncertain}>
        <div className="pricing-editor__grid">
          <div className="pricing-field"><label htmlFor="pricing-category">Product Categories</label>
            <PricingMultiSelect id="pricing-category" label="Product Categories" values={form.categories} fetchPage={fetchRuleCategories} invalid={errors.category} describedBy={errors.category ? 'pricing-category-error' : undefined} disabled={busy || uncertain} disabledPlaceholder={lockedPlaceholder} onChange={changeCategories} />
            {err('category')}</div>
          <div className="pricing-field pricing-field--wide"><label htmlFor="pricing-allergen">Allergens</label>
            <PricingMultiSelect id="pricing-allergen" label="Allergens" values={form.allergens} categories={form.categories} scopeKey={categoryKey} fetchPage={fetchAllergens} invalid={errors.allergens} describedBy={errors.allergens ? 'pricing-allergens-error' : undefined} disabled={!categoryKey || busy || uncertain} disabledPlaceholder={busy || uncertain ? lockedPlaceholder : 'Choose active categories first'} onChange={(allergens) => set({ allergens })} onBusyChange={setSelectingAll} />
            {err('allergens')}</div>
        </div>
        <div className="pricing-editor__grid">
          <div className="pricing-field"><label htmlFor="pricing-cutoff">Order Date Cutoff</label>
            <input id="pricing-cutoff" type="date" className="pricing-input" value={form.cutoff} onChange={(e) => set({ cutoff: e.target.value })} aria-invalid={Boolean(errors.cutoff)} aria-describedby={`pricing-cutoff-help${errors.cutoff ? ' pricing-cutoff-error' : ''}`} required data-testid="input-pricing-cutoff" />
             <small id="pricing-cutoff-help">On/after includes this day.</small>{err('cutoff')}</div>
          <div className="pricing-field"><label htmlFor="pricing-before">Before date (INR)</label>
            <input id="pricing-before" inputMode="decimal" className="pricing-input" maxLength={64} value={form.beforeRate} onChange={(e) => set({ beforeRate: e.target.value })} aria-invalid={Boolean(errors.beforeRate)} aria-describedby={errors.beforeRate ? 'pricing-beforeRate-error' : undefined} required data-testid="input-pricing-before-rate" />{err('beforeRate')}</div>
          <div className="pricing-field"><label htmlFor="pricing-after">On/after date (INR)</label>
            <input id="pricing-after" inputMode="decimal" className="pricing-input" maxLength={64} value={form.afterRate} onChange={(e) => set({ afterRate: e.target.value })} aria-invalid={Boolean(errors.afterRate)} aria-describedby={errors.afterRate ? 'pricing-afterRate-error' : undefined} required data-testid="input-pricing-after-rate" />{err('afterRate')}</div>
        </div>
      </fieldset>
      {stale && <div className="pricing-latest" data-testid="panel-pricing-latest">
        <h3>Latest saved rule</h3>
        {latest.state === 'idle' && <button type="button" className="admin-button admin-button--secondary" onClick={viewLatest} data-testid="button-view-latest-pricing-rule">View latest saved rule</button>}
        {latest.state === 'loading' && <p role="status">Loading latest saved rule…</p>}
        {latest.state === 'error' && <p role="alert">{latest.error} <button type="button" className="admin-button admin-button--secondary" onClick={viewLatest}>Retry</button></p>}
        {latest.state === 'ready' && <dl className="pricing-rule-row__rates" data-testid="text-pricing-latest">
          <dt>Version</dt><dd>{latest.rule.version}</dd>
          <dt>Categories</dt><dd>{categoryNames(latest.rule)}</dd>
          <dt>Allergens</dt><dd>{latest.rule.allergens.map((a) => allergenName(latest.rule, a)).join(', ') || 'None'}</dd>
          <dt>Order Date Cutoff</dt><dd><time dateTime={latest.rule.cutoff}>{showDate(latest.rule.cutoff, prefs)}</time></dd>
          <dt>Before date (INR)</dt><dd>{shown(latest.rule.beforeRate)}</dd>
          <dt>On/after date (INR)</dt><dd>{shown(latest.rule.afterRate)}</dd>
        </dl>}
      </div>}
      <div className="pricing-editor__actions" style={{ marginTop: 16 }}>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || selectingAll} onClick={close} data-testid="button-cancel-pricing-rule">{stale ? 'Close draft' : 'Cancel'}</button>
        <button type="submit" className="admin-button" disabled={busy || stale || selectingAll} aria-disabled={busy || undefined} data-testid="button-save-pricing-rule">{busy ? 'Saving…' : uncertain ? 'Retry same submission' : mode === 'edit' ? 'Save changes' : 'Create rule'}</button>
      </div>
    </form>
    {confirmClose && <ConfirmationDialog destructive
      title={uncertain ? 'Abandon unconfirmed save?' : 'Discard pricing rule draft?'}
      description={uncertain ? 'The last save could not be confirmed and may already have been saved on the server. Closing discards this attempt and its safe retry; it exists only on this page. Prefer Retry same submission. If you close, check the rule list before saving again.' : 'Your unsaved changes to this pricing rule will be lost.'}
      actionLabel={uncertain ? 'Abandon unconfirmed save' : 'Discard draft'}
      onConfirm={() => { setConfirmClose(false); onClose(); }} onClose={() => setConfirmClose(false)} />}
    </div>
  </Dialog>;
}
