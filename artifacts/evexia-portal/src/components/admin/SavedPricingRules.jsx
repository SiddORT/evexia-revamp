import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, History, Pencil, Plus, Search } from 'lucide-react';
import DataTable from './DataTable.jsx';
import TablePagination from './TablePagination.jsx';
import StatusBadge from './StatusBadge.jsx';
import MasterFilterReset from './MasterFilterReset.jsx';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import CombinationPricingHistory from './CombinationPricingHistory.jsx';
import CountTariffEvidence from './CountTariffEvidence.jsx';
import usePricingCategories from './usePricingCategories.js';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { listSavedCombinationRules, changeCombinationRuleStatus } from '../../services/serverCombinationPricing.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';
import '../../mr.css';

export default function SavedPricingRules() {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const prefs = useAdminPreferences();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [result, setResult] = useState({ items: [], total: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState(null);
  const historyTrigger = useRef(null);
  const [confirming, setConfirming] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [countOpen, setCountOpen] = useState(false);
  const action = useRef({ busy: false, attempt: null });
  const alive = useRef(true);
  const controller = useRef(null);
  useConfirmedNavigation(() => ({ busy: action.current.busy, blocked: Boolean(action.current.attempt),
    uncertain: Boolean(action.current.attempt) }), 'Resolve the pending status submission before leaving.');
  useEffect(() => {
    alive.current = true;
    const unload = (event) => {
      if (action.current.busy || action.current.attempt) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => { alive.current = false; window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => {
    const ctl = new AbortController(); controller.current = ctl;
    setLoading(true); setError('');
    const timer = setTimeout(() => listSavedCombinationRules({
      query: query.trim(), status, offset: (page - 1) * pageSize, limit: pageSize,
    }, ctl.signal).then((value) => { if (!ctl.signal.aborted) setResult(value); })
      .catch((cause) => { if (!ctl.signal.aborted) setError(cause.message); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); }), query ? 250 : 0);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [query, status, page, pageSize, reload]);
  const pageCount = Math.max(1, Math.ceil(result.filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  const locked = pending || Boolean(attempt);
  function refresh() {
    if (action.current.busy || action.current.attempt) return;
    controller.current?.abort(); setLoading(true); setReload((n) => n + 1);
  }
  function filter(change) {
    if (action.current.busy || action.current.attempt) return;
    controller.current?.abort(); setLoading(true); change(); setPage(1);
  }
  async function submitStatus() {
    if (action.current.busy || blocked) return;
    const guard = reportingIdentityGuard();
    let frozen = action.current.attempt;
    if (!frozen) {
      const record = confirming;
      frozen = { record, body: Object.freeze({ status: record.status === 'active' ? 'inactive' : 'active',
        expectedVersion: record.statusVersion, idempotencyKey: crypto.randomUUID() }) };
    }
    action.current = { busy: true, attempt: frozen }; setAttempt(frozen); setPending(true); setActionError('');
    try {
      await changeCombinationRuleStatus(frozen.record, frozen.body, session.user.id);
      guard(); if (!alive.current) return;
      action.current.attempt = null; setAttempt(null); setConfirming(null);
      setNotice(`Rule ${frozen.body.status === 'active' ? 'activated' : 'deactivated'}. Configuration only; order pricing is unchanged.`);
      setReload((n) => n + 1); setLoading(true);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (!alive.current) return;
      if (cause.terminal || (!attempt && !cause.ambiguous && !cause.malformed && cause.status
        && cause.status < 500 && ![408, 429].includes(cause.status))) {
        action.current.attempt = null; setAttempt(null); setBlocked(true);
        setActionError(`${cause.message} No new status outcome is pending. Close, refresh records and review before another action.`);
      } else {
        setActionError('Status outcome is unknown. Navigation and other actions are locked. Retry the same submission to recover its original outcome; Cancel will not discard it.');
      }
    } finally {
      action.current.busy = false;
      if (alive.current) setPending(false);
    }
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_r, i) => i + 1 },
    { key: 'category', label: 'Product Category', render: (r) => <strong>{r.latest.categoryName}</strong> },
    { key: 'members', label: 'Allergens', render: (r) => <ul className="pricing-combination-members">{r.latest.members.map((m) =>
      <li key={m.id}>{m.name}<small>{m.mix ? 'Mix' : 'No Mix'}</small></li>)}</ul> },
    { key: 'dosage', label: 'Dosage', render: (r) => r.latest.dosage },
    { key: 'size', label: 'Combination Size', render: (r) => r.latest.memberIds.length },
    { key: 'mrp', label: 'Latest Recorded MRP', render: (r) => `₹${r.latest.totalMrp}` },
    { key: 'date', label: 'Effective From', render: (r) => <time dateTime={r.latest.effectiveFrom}>{formatAdminDate(r.latest.effectiveFrom, prefs) || r.latest.effectiveFrom}</time> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.latest.id} /> },
    { key: 'actions', label: 'Actions', render: (r) => <div className="pricing-saved-actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || loading}
        aria-label={`Edit ${r.latest.categoryName}, ${r.latest.dosage}, ${r.latest.members.map((m) => m.name).join(' + ')}`}
        onClick={() => navigate(`/admin/pricing-rules/${r.latest.id}/edit`)}><Pencil size={15} /> Edit</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || loading}
        onClick={() => { setConfirming(r); setActionError(''); setBlocked(false); }}><CirclePower size={15} /> {r.status === 'active' ? 'Deactivate' : 'Activate'}</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={locked || loading}
        onClick={(e) => { historyTrigger.current = e.currentTarget; setHistory(r); }}><History size={15} /> History</button>
    </div> },
  ];
  const verb = confirming?.status === 'active' ? 'Deactivate' : 'Activate';
  return <>
    <div className="admin-page-head pricing-page-head"><div><p className="admin-page-head__eyebrow">Configuration / Pricing</p>
      <h1>Pricing Rules</h1><p className="admin-page-head__description">Saved combination configuration only. Latest recorded MRP is not necessarily effective today.
        Rate and status changes do not change saved orders or current order pricing.</p></div>
      <button type="button" className="admin-button" disabled={locked} onClick={() => navigate('/admin/pricing-rules/new')}><Plus size={16} /> Add Rule</button>
    </div>
    {notice && <p role="status" className="admin-feedback">{notice}</p>}
    <section className="admin-panel pricing-saved-panel" aria-label="Saved pricing rules">
      <div className="admin-toolbar master-filter-toolbar">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading || locked} onClick={refresh}>Refresh records</button>
        <div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} aria-hidden="true" />
          <span className="pricing-sr-only">Search saved categories, allergens or dosage</span>
          <input type="search" maxLength={100} value={query} disabled={locked} placeholder="Search category, allergens or dosage"
            onChange={(e) => filter(() => setQuery(e.target.value))} /></label>
          <div className="admin-filter"><label htmlFor="pricing-status">Status</label>
            <select id="pricing-status" className="admin-select" value={status} disabled={locked} onChange={(e) => filter(() => setStatus(e.target.value))}>
              <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select></div></div>
        <MasterFilterReset disabled={locked || (!query && status === 'all')} onClick={() => filter(() => { setQuery(''); setStatus('all'); })} />
      </div>
      {error ? <div className="admin-empty" role="alert"><strong>Pricing Rules could not be loaded</strong><p>{error}</p>
        <button type="button" className="admin-button" disabled={locked} onClick={refresh}>Try again</button></div>
        : <><DataTable columns={columns} rows={result.items} rowKey={(r) => r.latest.id} rowOffset={(page - 1) * pageSize}
          loading={loading} label="Saved combination pricing rules" testIdPrefix="saved-pricing"
          empty={<div className="admin-empty"><strong>{result.total ? 'No matching pricing rules' : 'No pricing rules yet'}</strong>
            <p>{result.total ? 'Try another category, allergen, dosage or status.' : 'Use Add Rule to configure dated combination rates.'}</p></div>} />
          {!loading && <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={result.filtered} total={result.total}
            label="pricing rules" testId="text-pricing-rule-count" onPageChange={(n) => { if (!locked) { setLoading(true); setPage(n); } }}
            onPageSizeChange={(n) => filter(() => setPageSize(n))} />}
        </>}
    </section>
    <details className="admin-panel pricing-legacy-disclosure" onToggle={(e) => setCountOpen(e.currentTarget.open)}><summary>Historical category/count tariffs · read-only</summary>
      {countOpen && <CountEvidencePicker />}
    </details>
    {history && <CombinationPricingHistory categoryId={history.latest.categoryId} dosage={history.latest.dosage}
      memberKey={history.latest.memberIds.join(',')} ruleId={history.latest.id}
      returnFocusRef={historyTrigger} onClose={() => setHistory(null)} />}
    {confirming && <ConfirmationDialog title={`${verb} pricing rule?`}
      description={`${verb} ${confirming.latest.categoryName} · ${confirming.latest.dosage} · ${confirming.latest.members.map((m) => m.name).join(' + ')}? This changes configuration status only, not catalogue status, saved orders or current order pricing.`}
      actionLabel={attempt ? 'Retry same submission' : `${verb} rule`} pending={pending} blocked={blocked} error={actionError}
      onConfirm={submitStatus} onClose={() => { if (!action.current.busy && !action.current.attempt) { setConfirming(null); setActionError(''); } }} />}
  </>;
}

function CountEvidencePicker() {
  const categories = usePricingCategories();
  const [category, setCategory] = useState(null);
  return <div className="pricing-policy-workspace">
    <AllergenSearchableSelect id="pricing-count-evidence-category" label="Historical tariff category"
      value={category?.id || ''} selectedLabel={category?.name}
      options={categories.items.map((c) => ({ value: c.id, label: c.name }))}
      onChange={(id) => setCategory(categories.items.find((c) => c.id === id) || null)}
      placeholder="Choose a category for read-only count history" onSearch={categories.search}
      loading={categories.busy} error={categories.error} onRetry={() => categories.search(categories.query, true)}
      hasMore={categories.nextOffset !== null} onMore={categories.more} />
    {category && <CountTariffEvidence key={category.id} categoryId={category.id} />}
  </div>;
}
