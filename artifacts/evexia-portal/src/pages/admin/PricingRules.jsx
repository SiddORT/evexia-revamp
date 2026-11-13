import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeIndianRupee, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import ImmunotherapyExtractSettings from '../../components/admin/ImmunotherapyExtractSettings.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import useConfirmedNavigation from '../../auth/useConfirmedNavigation.js';
import { formatAdminDate, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { formatRate } from '../../services/rates.js';
import { listPricingRules } from '../../services/serverPricingRules.js';
import '../../pricingRules.css';

const PAGE_SIZES = [10, 25, 50, 100];
const refName = (r) => `${r.name}${r.status === 'active' ? '' : ` (${r.status})`}`;

export default function PricingRules() {
  const session = useAdminSession();
  if (!isSuperAdminIdentity(session.user)) {
    return <AdminLayout title="Pricing Rules"><div className="admin-empty" role="alert" data-testid="status-pricing-rules-denied">
      <BadgeIndianRupee size={21} aria-hidden="true" /><strong>Access is not available</strong>
      <p>Pricing Rules can only be configured by a Super Admin.</p>
    </div></AdminLayout>;
  }
  return <PricingWorkspace key={session.user?.id || 'signed-out'} />;
}

function PricingWorkspace() {
  const status = useRef({});
  const registerGuard = useCallback((guard, state) => { status.current = state || {}; }, []);
  useConfirmedNavigation(() => status.current, 'Discard unsaved pricing or quantity changes and leave this page?');
  useEffect(() => {
    const unload = (event) => {
      if (!status.current.dirty && !status.current.busy && !status.current.uncertain) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  return <AdminLayout title="Pricing Rules"><div className="pricing-rules-page">
    <div className="admin-page-head"><div>
      <p className="admin-page-head__eyebrow">Configuration / Pricing</p><h1>Pricing Rules</h1>
      <p className="admin-page-head__description">Dated Total Suborder MRP by Product Category and exact clinical allergen count.
        Extract and Dilution quantities remain dosage-specific, independently ranked and inventory-bound. Saved orders are not repriced.</p>
    </div></div>
    <ImmunotherapyExtractSettings withPricing onGuardChange={registerGuard} />
    <LegacyPricingEvidence />
  </div></AdminLayout>;
}

function LegacyPricingEvidence() {
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(25);
  const [list, setList] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const prefs = useAdminPreferences();
  const controller = useRef(null);
  useEffect(() => {
    const ctl = new AbortController(); controller.current = ctl;
    setLoading(true); setError('');
    const timer = setTimeout(() => listPricingRules({ offset, limit, query: query.trim() }, ctl.signal)
      .then((page) => { if (!ctl.signal.aborted) { setList(page); setLoading(false); } })
      .catch((cause) => { if (!ctl.signal.aborted) { setError(cause.message); setLoading(false); } }), query ? 250 : 0);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [offset, limit, query, reload]);
  useEffect(() => {
    if (!loading && !error && offset > 0 && offset >= list.total) {
      setOffset(Math.max(0, Math.floor((list.total - 1) / limit) * limit));
    }
  }, [loading, error, offset, list.total, limit]);
  const columns = [
    { key: 'categories', label: 'Legacy categories', render: (r) => r.categories.map(refName).join(', ') },
    { key: 'allergens', label: 'Legacy allergens', render: (r) => <ul className="pricing-rule-row__targets">{r.allergens.map((a) =>
      <li key={a.id}>{r.categories.find((c) => c.id === a.savedCategoryId)?.name}: {refName(a)}
        {a.categoryId !== a.savedCategoryId ? ' (moved category)' : ''}</li>)}</ul> },
    { key: 'cutoff', label: 'Saved cutoff', render: (r) => <time dateTime={r.cutoff}>{formatAdminDate(r.cutoff, prefs) || r.cutoff}</time> },
    { key: 'beforeRate', label: 'Before (INR/ml)', render: (r) => formatRate(r.beforeRate) },
    { key: 'afterRate', label: 'On/after (INR/ml)', render: (r) => formatRate(r.afterRate) },
    { key: 'version', label: 'Legacy version', render: (r) => r.version },
  ];
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(list.total / limit));
  return <section className="admin-panel pricing-rules-panel" aria-label="Legacy pricing evidence" aria-busy={loading}>
    <h2>Legacy material-price evidence (read-only)</h2>
    <p>Retained for historical orders only. These rules never supply a fallback for new category/count tariffs.</p>
    <div className="admin-toolbar master-filter-toolbar"><label className="admin-search">
      <Search size={16} aria-hidden="true" /><span className="pricing-sr-only">Search legacy rules by category or allergen</span>
      <input type="search" maxLength={100} value={query} placeholder="Search legacy categories or allergens…"
        onChange={(e) => { controller.current?.abort(); setLoading(true); setQuery(e.target.value); setOffset(0); }} />
    </label></div>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="admin-button" onClick={() => setReload((n) => n + 1)}>Retry legacy list</button></div>
      : loading || list.items.length ? <DataTable columns={columns} rows={list.items} loading={loading}
        rowKey={(row) => row.id} rowOffset={offset} label="Legacy pricing rules" testIdPrefix="pricing-rule" />
        : <p>{query.trim() ? 'No matching legacy rules.' : 'No legacy rules saved.'}</p>}
    {!loading && !error && <div className="admin-panel__foot admin-pagination">
      <span>{list.total} legacy rules</span><div className="admin-pagination__controls">
        <label>Rows per page <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <nav aria-label="Legacy pricing pages">
          <button type="button" disabled={page <= 1} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
          <span> {page} of {pages} </span>
          <button type="button" disabled={page >= pages} onClick={() => setOffset(offset + limit)}>Next</button>
        </nav>
      </div>
    </div>}
  </section>;
}
