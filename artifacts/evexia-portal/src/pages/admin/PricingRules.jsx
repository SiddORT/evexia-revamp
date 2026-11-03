import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeIndianRupee, Copy, FolderOpen, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import RemoteSelect from '../../components/admin/RemoteSelect.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import { formatAdminDate, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { catalogueRate, formatRate } from '../../services/rates.js';
import { MAX_ALLERGENS, fetchRuleAllergens, fetchRuleCategories, getPricingRule, listPricingRules, savePricingRule, validDate } from '../../services/serverPricingRules.js';
import '../../pricingRules.css';

const PAGE_SIZES = [10, 25, 50, 100];
const EMPTY = { category: null, allergens: [], cutoff: '', beforeRate: '', afterRate: '' };
const shown = (rate) => { try { return formatRate(rate); } catch { return rate; } };
const showDate = (value, prefs) => { try { return formatAdminDate(value, prefs) || value; } catch { return value; } };
const refName = (r) => r.status === 'deleted' ? `${r.name} (deleted)` : r.status === 'inactive' ? `${r.name} (inactive)` : r.name;

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
  const [limit, setLimit] = useState(25);
  const [list, setList] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState(null);
  const prefs = useAdminPreferences();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true); setError('');
    listPricingRules({ offset, limit }, controller.signal)
      .then((page) => { if (live) { setList({ items: page.items, total: page.total }); setLoading(false); } })
      .catch((cause) => { if (live && !controller.signal.aborted) { setError(cause?.message || 'Pricing rules could not be loaded.'); setLoading(false); } });
    return () => { live = false; controller.abort(); };
  }, [offset, limit, reloadToken]);
  useEffect(() => { if (!loading && !error && offset > 0 && offset >= list.total) setOffset(Math.max(0, Math.floor((list.total - 1) / limit) * limit)); }, [loading, error, offset, list.total, limit]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);
  const open = (mode, rule = null) => {
    setFeedback('');
    const form = !rule ? EMPTY : mode === 'copy'
      ? { ...EMPTY, cutoff: rule.cutoff, beforeRate: rule.beforeRate, afterRate: rule.afterRate }
      : { category: { id: rule.category.id, name: rule.category.name, status: rule.category.status }, allergens: rule.allergens.map((a) => ({ id: a.id, name: a.name, status: a.status, categoryId: a.categoryId })), cutoff: rule.cutoff, beforeRate: rule.beforeRate, afterRate: rule.afterRate };
    setEditor({ mode, rule, form, key: `${mode}-${rule?.id || 'new'}-${Date.now()}` });
  };
  const saved = (rule, mode) => {
    if (!mounted.current) return;
    setEditor(null);
    setFeedback(`Pricing rule for ${rule.category.name} ${mode === 'edit' ? 'updated' : 'created'} (version ${rule.version}).`);
    retry();
  };

  const pageCount = Math.max(1, Math.ceil(list.total / limit));
  const page = Math.floor(offset / limit) + 1;
  return <AdminLayout title="Pricing Rules"><div className="pricing-rules-page">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Configuration / Pricing</p><h1>Pricing Rules</h1><p className="admin-page-head__description">Date-based selling prices for a category and its allergens.</p></div>
      <div className="admin-target-head-actions">
        <button type="button" className="admin-button" disabled={Boolean(editor)} onClick={() => open('new')} data-testid="button-add-pricing-rule"><Plus size={16} aria-hidden="true" /> Add rule</button>
      </div>
    </div>
    <p className="pricing-rules-note" data-testid="text-pricing-rules-note">Each rule configures two alternative selling prices: one for the range before the cutoff date and one for the on/after range. Configured on/after range includes the cutoff day. One configuration per category and allergen: the server rejects any overlapping target, with no precedence. No order currently applies these rules.</p>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-pricing-rule-feedback">{feedback}</div>}
    {editor && <RuleEditor key={editor.key} editor={editor} onClose={() => setEditor(null)} onSaved={saved} />}
    <section className="admin-panel" aria-label="Pricing rule list" aria-busy={loading}>
      <div className="admin-target-toolbar"><div className="admin-target-toolbar__search-row master-filter-toolbar">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry} data-testid="button-refresh-pricing-rules"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
      </div></div>
      {loading ? <div role="status" aria-label="Loading pricing rules" className="pricing-rules-list">{[0, 1, 2].map((i) => <div key={i} className="pricing-skeleton" />)}</div>
        : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>Pricing rules could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" style={{ marginTop: 16 }} onClick={retry} data-testid="button-retry-pricing-rules">Try again</button></div>
        : list.items.length ? <ul className="pricing-rules-list" aria-label="Pricing rules">{list.items.map((rule) => <li key={rule.id} className="pricing-rule-row" data-testid={`row-pricing-rule-${rule.id}`}>
          <div>
            <h2 data-testid={`text-pricing-rule-category-${rule.id}`}>{refName(rule.category)}</h2>
            <ul className="pricing-rule-row__chips" aria-label="Allergens">{rule.allergens.map((a) => <li key={a.id} className={`pricing-chip${a.status === 'deleted' || a.categoryId !== rule.category.id ? ' pricing-chip--deleted' : ''}`}>{refName(a)}{a.categoryId !== rule.category.id && ' (moved to another category)'}</li>)}</ul>
          </div>
          <dl className="pricing-rule-row__rates">
            <dt>Order Date Cutoff</dt><dd data-testid={`text-pricing-rule-cutoff-${rule.id}`}><time dateTime={rule.cutoff}>{showDate(rule.cutoff, prefs)}</time></dd>
            <dt>Before date (INR)</dt><dd data-testid={`text-pricing-rule-before-${rule.id}`}>{shown(rule.beforeRate)}</dd>
            <dt>On/after date (INR)</dt><dd data-testid={`text-pricing-rule-after-${rule.id}`}>{shown(rule.afterRate)}</dd>
            <dt>Version</dt><dd>{rule.version}</dd>
          </dl>
          <div className="pricing-rule-row__actions">
            <button type="button" className="admin-icon-button" disabled={Boolean(editor)} aria-label={`Edit pricing rule for ${rule.category.name}`} title="Edit" onClick={() => open('edit', rule)} data-testid={`button-edit-pricing-rule-${rule.id}`}><Pencil size={16} aria-hidden="true" /></button>
            <button type="button" className="admin-icon-button" disabled={Boolean(editor)} aria-label={`Copy pricing rule for ${rule.category.name}`} title="Copy" onClick={() => open('copy', rule)} data-testid={`button-copy-pricing-rule-${rule.id}`}><Copy size={16} aria-hidden="true" /></button>
          </div>
        </li>)}</ul>
        : <div className="admin-empty" data-testid="status-pricing-rules-empty"><span className="admin-empty__icon"><BadgeIndianRupee size={21} aria-hidden="true" /></span><strong>{list.total ? 'No rules on this page' : 'No pricing rules yet'}</strong><p>{list.total ? 'Go back to an earlier page.' : 'Add a rule to set before and on/after selling prices for a category.'}</p></div>}
      {!error && <div className="pricing-pager">
        <span data-testid="text-pricing-rules-count">{list.total ? `${offset + 1}-${Math.min(offset + list.items.length, list.total)} of ${list.total} rules` : '0 rules'}</span>
        <label>Rows <select className="admin-select" value={limit} disabled={loading} onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }} data-testid="select-pricing-rules-page-size">{PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <div>
          <button type="button" className="admin-button admin-button--secondary" disabled={loading || page <= 1} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-pricing-rules-prev">Previous</button>
          <span aria-live="polite" style={{ alignSelf: 'center' }}>Page {page} of {pageCount}</span>
          <button type="button" className="admin-button admin-button--secondary" disabled={loading || page >= pageCount} onClick={() => setOffset(offset + limit)} data-testid="button-pricing-rules-next">Next</button>
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
  navState.current = { dirty, busy, uncertain };
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
  const changeCategory = (item) => set({ category: item ? { id: item.value, name: item.label, status: item.raw?.status || 'active' } : null, allergens: [] });
  const addAllergen = (item) => {
    if (!item) return;
    setForm((f) => f.allergens.some((a) => a.id === item.value) || f.allergens.length >= MAX_ALLERGENS ? f
      : { ...f, allergens: [...f.allergens, { id: item.value, name: item.label, status: item.raw?.status || 'active', categoryId: item.raw?.categoryId }] });
    setErrors({});
  };
  const removeAllergen = (id) => set({ allergens: form.allergens.filter((a) => a.id !== id) });
  const categoryId = form.category?.id || '';
  const fetchAllergens = useCallback((q, o, signal) => fetchRuleAllergens(categoryId, q, o, signal), [categoryId]);

  function validate() {
    const next = {};
    if (!form.category) next.category = 'Choose a category.';
    else if (form.category.status !== 'active') next.category = 'This category is no longer active. Choose an active category.';
    if (!form.allergens.length) next.allergens = 'Choose at least one allergen.';
    else if (form.allergens.length > MAX_ALLERGENS) next.allergens = `Choose at most ${MAX_ALLERGENS} allergens.`;
    else if (form.allergens.some((a) => a.status !== 'active')) next.allergens = 'Remove allergens that are no longer active.';
    else if (form.category && form.allergens.some((a) => a.categoryId !== form.category.id)) next.allergens = 'Some allergens now belong to another category. Remove them and reselect from this category.';
    if (!validDate(form.cutoff)) next.cutoff = 'Enter a valid date.';
    for (const k of ['beforeRate', 'afterRate']) {
      try { catalogueRate(form[k].trim()); } catch (cause) { next[k] = cause.message; }
    }
    setErrors(next);
    return !Object.keys(next).length;
  }

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    if (stale) return;
    let current = attempt;
    if (!uncertain) {
      if (!validate()) return;
      const body = { categoryId: form.category.id, allergenIds: [...new Set(form.allergens.map((a) => a.id))], cutoff: form.cutoff,
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
      if (kind === 'uncertain') {
        setAttempt({ ...current, state: 'uncertain' });
        setMessage(`The save outcome could not be confirmed${cause?.message ? `: ${cause.message}` : ''}. The rule may or may not have been saved. Retry the exact same submission; fields are locked so the server can recognise it.`);
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
    if (busyRef.current) return;
    if (dirty || uncertain) { setConfirmClose(true); return; }
    onClose();
  }

  const title = mode === 'edit' ? `Edit rule: ${rule.category.name}` : mode === 'copy' ? `Copy rule from ${rule.category.name}` : 'New pricing rule';
  const err = (k) => errors[k] && <span id={`pricing-${k}-error`} className="pricing-field__error" role="alert">{errors[k]}</span>;
  return <section className="admin-panel pricing-editor" aria-labelledby="pricing-editor-title" data-testid="form-pricing-rule">
    <div className="admin-page-head" style={{ margin: 0 }}><div><p className="admin-page-head__eyebrow">{mode === 'copy' ? 'Copy: rates and cutoff copied, choose a new target' : mode === 'edit' ? `Version ${rule.version}` : 'Pricing rule'}</p><h2 id="pricing-editor-title">{title}</h2></div></div>
    {message && <div className={`admin-feedback${uncertain || stale ? '' : ' admin-feedback--error'}`} role="alert" data-testid="status-pricing-rule-error">{message}</div>}
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy || uncertain}>
        <div className="pricing-editor__grid">
          <div className="pricing-field"><label htmlFor="pricing-category">Category</label>
            <RemoteSelect id="pricing-category" label="Category" describeSelection required value={categoryId} selected={form.category ? { value: form.category.id, label: refName(form.category) } : null} fetchPage={fetchRuleCategories} placeholder="Choose active category" invalid={errors.category} describedBy={errors.category ? 'pricing-category-error' : undefined} disabled={busy || uncertain} onChange={changeCategory} />
            <small>Changing the category clears selected allergens.</small>{err('category')}</div>
          <div className="pricing-field pricing-field--wide"><label htmlFor="pricing-allergen">Allergens ({form.allergens.length} selected, max {MAX_ALLERGENS})</label>
            <RemoteSelect id="pricing-allergen" label="Add allergen" value="" selected={null} resetKey={categoryId} fetchPage={fetchAllergens} placeholder={categoryId ? 'Search active allergens to add' : 'Choose a category first'} invalid={errors.allergens} describedBy={errors.allergens ? 'pricing-allergens-error' : undefined} disabled={!categoryId || busy || uncertain || form.allergens.length >= MAX_ALLERGENS} onChange={addAllergen} />
            {form.allergens.length > 0 && <ul className="pricing-rule-row__chips" aria-label="Selected allergens">{form.allergens.map((a) => <li key={a.id} className={`pricing-chip${a.status !== 'active' || (form.category && a.categoryId !== form.category.id) ? ' pricing-chip--deleted' : ''}`} data-testid={`chip-pricing-allergen-${a.id}`}>{refName(a)}{form.category && a.categoryId !== form.category.id && <span className="pricing-chip__warn"> (now in another category; remove and reselect)</span>}<button type="button" aria-label={`Remove ${a.name}`} onClick={() => removeAllergen(a.id)} data-testid={`button-remove-pricing-allergen-${a.id}`}><X size={12} aria-hidden="true" /></button></li>)}</ul>}
            {err('allergens')}</div>
        </div>
        <div className="pricing-editor__grid">
          <div className="pricing-field"><label htmlFor="pricing-cutoff">Order Date Cutoff</label>
            <input id="pricing-cutoff" type="date" className="pricing-input" value={form.cutoff} onChange={(e) => set({ cutoff: e.target.value })} aria-invalid={Boolean(errors.cutoff)} aria-describedby={`pricing-cutoff-help${errors.cutoff ? ' pricing-cutoff-error' : ''}`} required data-testid="input-pricing-cutoff" />
            <small id="pricing-cutoff-help">Configured on/after range includes the cutoff day. No order currently applies this rule.</small>{err('cutoff')}</div>
          <div className="pricing-field"><label htmlFor="pricing-before">Selling Price Before Date (INR)</label>
            <input id="pricing-before" inputMode="decimal" className="pricing-input" maxLength={64} value={form.beforeRate} onChange={(e) => set({ beforeRate: e.target.value })} aria-invalid={Boolean(errors.beforeRate)} aria-describedby={errors.beforeRate ? 'pricing-beforeRate-error' : undefined} required data-testid="input-pricing-before-rate" />{err('beforeRate')}</div>
          <div className="pricing-field"><label htmlFor="pricing-after">Selling Price On/After Date (INR)</label>
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
          <dt>Category</dt><dd>{refName(latest.rule.category)}</dd>
          <dt>Allergens</dt><dd>{latest.rule.allergens.map(refName).join(', ') || 'None'}</dd>
          <dt>Order Date Cutoff</dt><dd><time dateTime={latest.rule.cutoff}>{showDate(latest.rule.cutoff, prefs)}</time></dd>
          <dt>Before date (INR)</dt><dd>{shown(latest.rule.beforeRate)}</dd>
          <dt>On/after date (INR)</dt><dd>{shown(latest.rule.afterRate)}</dd>
        </dl>}
      </div>}
      <div className="pricing-editor__actions" style={{ marginTop: 16 }}>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={close} data-testid="button-cancel-pricing-rule">{stale ? 'Close draft' : 'Cancel'}</button>
        <button type="submit" className="admin-button" disabled={busy || stale} aria-disabled={busy || undefined} data-testid="button-save-pricing-rule">{busy ? 'Saving…' : uncertain ? 'Retry same submission' : mode === 'edit' ? 'Save changes' : 'Create rule'}</button>
      </div>
    </form>
    {confirmClose && <ConfirmationDialog destructive
      title={uncertain ? 'Abandon unconfirmed save?' : 'Discard pricing rule draft?'}
      description={uncertain ? 'The last save could not be confirmed and may already have been saved on the server. Closing discards this attempt and its safe retry; it exists only on this page. Prefer Retry same submission. If you close, check the rule list before saving again.' : 'Your unsaved changes to this pricing rule will be lost.'}
      actionLabel={uncertain ? 'Abandon unconfirmed save' : 'Discard draft'}
      onConfirm={() => { setConfirmClose(false); onClose(); }} onClose={() => setConfirmClose(false)} />}
  </section>;
}
