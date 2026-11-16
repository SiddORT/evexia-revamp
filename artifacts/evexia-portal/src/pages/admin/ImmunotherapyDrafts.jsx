import { useEffect, useRef, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { Search } from 'lucide-react';
import { contactReadScope, purchaseOrderRequest } from '../../auth/adminSession.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { canReadResource, hasCapability } from '../../auth/capabilities.js';
import OrderPortalLayout, { useOrderPortal } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useOrderListFreshness } from '../../services/orderFreshness.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import '../../immunotherapy.css';
import '../../kitsOrders.css';

const PAGE_SIZES = [2, 5, 10, 25];
const KINDS = Object.freeze({
  immunotherapy: { label: 'Immunotherapy', slug: 'immunotherapy', resource: 'immunotherapy' },
  spt: { label: 'SPT', slug: 'spt', resource: 'spt' },
  lupin: { label: 'Lupin', slug: 'lupin', resource: 'lupin' },
  kits: { label: 'Kits & Consumables', slug: 'kits-consumables', resource: 'kits' },
});
const LISTINGS = ['immunotherapy', 'spt', 'lupin', 'kits-consumables'];
const SLUG_RESOURCE = { immunotherapy: 'immunotherapy', spt: 'spt', lupin: 'lupin', 'kits-consumables': 'kits' };
const EMPTY = { kind: '', search: '', from_date: '', to_date: '' };
const MAX_CURSOR = 4096, MAX_TEXT = 262144, MAX_SCANNED = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// These are saved, user-authored text fields, rendered only as React text.
// Do not reject legitimate long remarks or change their original characters.
const safeText = (value) => value === null || (typeof value === 'string' && value.length <= MAX_TEXT);
const validDay = (value) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validStamp = (value) => value === null || (typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)));
const shown = (value) => (value && value.trim() ? value : null);

function validItem(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.id === 'string' && UUID.test(item.id)
    && Object.hasOwn(KINDS, item.kind)
    && Number.isSafeInteger(item.version) && item.version > 0
    && validStamp(item.updatedAt)
    && (item.kind === 'spt' || item.identifier === null)
    && ['identifier', 'doctor', 'mr', 'patient', 'details', 'remarks'].every((key) => safeText(item[key]))
    && typeof item.canResume === 'boolean';
}

function validPage(data, query) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || data.items.length > query.pageSize) return false;
  if (!data.items.every(validItem)) return false;
  if (new Set(data.items.map((item) => `${item.kind}:${item.id}`)).size !== data.items.length) return false;
  if (query.filters.kind && data.items.some((item) => item.kind !== query.filters.kind)) return false;
  if (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !data.nextCursor
    || data.nextCursor.length > MAX_CURSOR || CONTROL.test(data.nextCursor) || data.nextCursor === query.cursor)) return false;
  if (typeof data.scanLimited !== 'boolean') return false;
  return Number.isSafeInteger(data.scannedCount) && data.scannedCount >= data.items.length && data.scannedCount <= MAX_SCANNED
    && (!data.scanLimited || (data.scannedCount === MAX_SCANNED && data.nextCursor !== null));
}

function resolveReturn(raw, portal, user) {
  const readable = (slug) => portal === 'mr' || canReadResource(user, SLUG_RESOURCE[slug]);
  const match = typeof raw === 'string' ? /^\/(admin|mr)\/orders\/([a-z-]+)$/.exec(raw) : null;
  if (match && match[1] === portal && LISTINGS.includes(match[2]) && readable(match[2])) return raw;
  if (portal === 'mr') return '/mr/orders';
  const first = LISTINGS.find(readable);
  return first ? `/admin/orders/${first}` : '/admin';
}

export default function DraftOrders() {
  const { portal } = useOrderPortal();
  const { user } = useAdminSession();
  const scope = contactReadScope(user);
  const permissions = JSON.stringify([...(user?.permissions || [])].sort());
  const params = new URLSearchParams(useSearch());
  const back = resolveReturn(params.get('returnTo'), portal, user);
  const kinds = Object.keys(KINDS).filter((kind) => portal === 'mr'
    || (kind === 'spt' ? canReadResource(user, kind) : hasCapability(user, kind, 'add')));
  return <OrderPortalLayout title="DRAFT ORDERS"><div className="imm kits kits-listing">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders</p><h1>Draft Orders</h1>
        <p className="admin-page-head__description">Resume incomplete Immunotherapy, SPT, Lupin and Kits &amp; Consumables orders. Private entry drafts are visible only to their creator; SPT drafts retain their existing order access rules.</p></div>
      <Link href={back} className="admin-button admin-button--secondary" data-testid="link-drafts-back">Back to orders</Link>
    </div>
    <DraftWorkspace key={`${portal}|${scope}|${permissions}`} portal={portal} kinds={kinds} />
  </div></OrderPortalLayout>;
}

function DraftWorkspace({ portal, kinds }) {
  const { timestamp } = useAdminDateFormatters();
  const [draft, setDraft] = useState(EMPTY);
  const [query, setQuery] = useState(() => ({ filters: EMPTY, cursor: null, offset: 0, page: 1, pageSize: 25, history: [{ cursor: null, offset: 0 }] }));
  const [result, setResult] = useState({ query: null, data: null, error: '' });
  // Rows belong to the exact request object; any new request hides them at once.
  const busy = result.query !== query;
  const data = busy ? null : result.data;
  const error = busy ? '' : result.error;
  const items = data?.items || [];
  const filtered = Boolean(query.filters.kind || query.filters.search || query.filters.from_date || query.filters.to_date);

  useEffect(() => {
    const controller = new AbortController();
    const { filters } = query;
    const params = { kind: filters.kind, search: filters.search, from_date: filters.from_date, to_date: filters.to_date, limit: query.pageSize };
    if (query.cursor) params.cursor = query.cursor;
    purchaseOrderRequest('', { params, signal: controller.signal }, 'order-drafts')
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!validPage(response, query)) throw new Error('The saved draft list could not be read safely. Retry to load this section again.');
        setResult({ query, data: response, error: '' });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setResult({ query, data: null, error: cause?.message || 'Drafts could not be retrieved.' });
      });
    return () => controller.abort();
  }, [query]);

  const start = (filters, pageSize = query.pageSize) => setQuery({ filters, cursor: null, offset: 0, page: 1, pageSize, history: [{ cursor: null, offset: 0 }] });
  const refresh = () => start(query.filters);
  const retry = () => setQuery({ ...query });
  // Background freshness refreshes only the first section so it never moves a user who is paging.
  const pageRef = useRef(query.page);
  pageRef.current = query.page;
  const freshRef = useRef(refresh);
  freshRef.current = refresh;
  useOrderListFreshness('drafts', () => { if (pageRef.current === 1) freshRef.current(); });

  const changePage = (next) => {
    if (busy) return;
    if (next === query.page + 1 && data?.nextCursor) {
      const entry = { cursor: data.nextCursor, offset: query.offset + items.length };
      const history = [...query.history.slice(0, query.page), entry];
      setQuery({ ...query, cursor: entry.cursor, offset: entry.offset, page: next, history });
    } else if (next >= 1 && next < query.page) {
      const entry = query.history[next - 1];
      setQuery({ ...query, cursor: entry.cursor, offset: entry.offset, page: next });
    }
  };

  const set = (patch) => setDraft((value) => ({ ...value, ...patch }));
  const apply = (event) => {
    event.preventDefault();
    const clean = {
      kind: Object.hasOwn(KINDS, draft.kind) ? draft.kind : '',
      search: draft.search.trim().slice(0, 200),
      from_date: validDay(draft.from_date) ? draft.from_date : '',
      to_date: validDay(draft.to_date) ? draft.to_date : '',
    };
    start(clean);
  };
  const reset = () => { setDraft(EMPTY); start(EMPTY); };

  const resumeHref = (item) => {
    const slug = KINDS[item.kind].slug;
    const id = encodeURIComponent(item.id);
    return item.kind === 'spt' ? `/${portal}/orders/spt/${id}/edit` : `/${portal}/orders/${slug}/new?draft=${id}`;
  };
  const saved = (item) => item.updatedAt ? timestamp(item.updatedAt) : 'Not recorded';
  const columns = [
    { key: 'serial', label: 'Sr. No.', render: (_item, index) => index + 1 },
    { key: 'kind', label: 'Order type', render: (item) => <><strong>{KINDS[item.kind].label}</strong>{shown(item.identifier) && <span className="kits-sub">{item.identifier}</span>}</> },
    { key: 'who', label: 'Doctor / MR / Patient', render: (item) => <>
      <span>Doctor: {shown(item.doctor) || 'Not recorded'}</span>
      <span className="kits-sub">MR: {shown(item.mr) || 'Not recorded'}</span>
      <span className="kits-sub">Patient: {shown(item.patient) || 'Not recorded'}</span>
    </> },
    { key: 'details', label: 'Details / Remarks', render: (item) => <>
      <span>{shown(item.details) || 'No details saved'}</span>
      <span className="kits-sub">Remarks: {shown(item.remarks) || 'None'}</span>
    </> },
    { key: 'saved', label: 'Last saved', render: (item) => item.updatedAt ? <time dateTime={item.updatedAt}>{saved(item)}</time> : 'Not recorded' },
    { key: 'resume', label: 'Resume', render: (item, index) => item.canResume
      ? <Link href={resumeHref(item)} className="admin-button admin-button--secondary"
        aria-label={`Resume ${KINDS[item.kind].label} draft in row ${index + 1}, last saved ${saved(item)}`}
        data-testid={`link-draft-resume-${item.kind}-${index + 1}`}>Resume</Link>
      : <><span className="kits-pill" data-testid={`text-draft-readonly-${index + 1}`}>Read only</span>
        {item.kind === 'spt' && <Link href={`/${portal}/orders/spt/${encodeURIComponent(item.id)}`}
          className="admin-button admin-button--secondary" aria-label={`View SPT draft in row ${index + 1}`}>View draft</Link>}</> },
  ];

  const emptyState = (() => {
    if (data?.nextCursor) return ['No drafts in this section', data.scanLimited
      ? 'The server stopped after a bounded scan. Continue to the next section to search more saved drafts.'
      : 'Continue to the next section for more saved drafts.'];
    if (filtered) return [query.page > 1 ? 'No further matches in this section' : 'No drafts match these filters',
      'Try a different search, order type or saved date range, or reset the filters.'];
    if (query.page > 1) return ['No more drafts', 'Go back to the previous section to see earlier drafts.'];
    return ['No saved drafts', 'Use Save as Draft in a new-order editor to keep an incomplete order for later.'];
  })();

  return <section className="admin-panel imm-drafts" aria-label="Saved draft orders" aria-busy={busy}>
    <OrderListingFilters masterDisclosure disclosureLabel="Filter drafts" refreshLabel="Refresh saved drafts" onRefresh={refresh} onReset={reset}
      onApply={apply} applyTestId="button-drafts-apply" resetTestId="button-drafts-reset" search={
        <label className="kits-field"><span className="kits-listing__search-control"><Search size={16} aria-hidden="true" />
          <input aria-label="Search drafts" maxLength={200} value={draft.search} onChange={(e) => set({ search: e.target.value })}
            placeholder="Doctor, MR, patient, details or remarks" data-testid="input-drafts-search" /></span></label>
      }>
      <label className="kits-field">Order type<select value={draft.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="select-drafts-kind">
        <option value="">All types</option>
        {kinds.map((value) => <option key={value} value={value}>{KINDS[value].label}</option>)}
      </select></label>
      <label className="kits-field">Last saved from<input type="date" value={draft.from_date} max={draft.to_date || undefined} onChange={(e) => set({ from_date: e.target.value })} data-testid="input-drafts-from" /></label>
      <label className="kits-field">Last saved to<input type="date" value={draft.to_date} min={draft.from_date || undefined} onChange={(e) => set({ to_date: e.target.value })} data-testid="input-drafts-to" /></label>
    </OrderListingFilters>
    <p className="imm-drafts__note">Last-saved dates are evaluated in India Standard Time. References chosen in a draft may show as Selected when the draft did not store a name. Row numbers are not draft identifiers.</p>
    {error ? <div className="kits-listing__state kits-listing__state--error" role="alert">
      <strong>Drafts unavailable</strong><p data-testid="error-drafts">{error}</p>
      <button type="button" className="admin-button admin-button--secondary" onClick={retry} data-testid="button-drafts-retry">Retry this section</button>
    </div> : <>
      <DataTable columns={columns} rows={items} rowOffset={query.offset} rowKey={(item) => `${item.kind}:${item.id}`}
        label="Draft orders (scrolls horizontally)" testIdPrefix="draft" loading={busy} loadingLabel="Loading saved drafts…"
        empty={<div className="kits-listing__state" role="status" data-testid="empty-drafts"><strong>{emptyState[0]}</strong><p>{emptyState[1]}</p></div>} />
      {!busy && data?.scanLimited && items.length > 0 && <p className="imm-drafts__note" role="status" data-testid="text-drafts-scan-limited">
        This section came from a bounded server scan. {data.nextCursor ? 'Continue to the next section for further matches.' : ''}</p>}
    </>}
    <TablePagination cursorMode sectionCount={busy || error ? 0 : items.length} page={query.page}
      pageCount={busy || error ? query.page : query.page + (data?.nextCursor ? 1 : 0)} pageSize={query.pageSize}
      disabled={busy || Boolean(error)} sectionStatus={busy ? 'Loading section…' : error ? 'Section unavailable' : undefined}
      cursorSummary={busy ? 'Loading saved drafts…' : error ? 'Draft section unavailable.' :
        `${items.length} drafts in this section · ${data?.nextCursor ? 'Continue for more saved drafts or matches' : 'End of available results'} · No overall draft total is available.`}
      filtered={null} total={null} label="drafts" testId="text-drafts-section" onPageChange={changePage}
      onPageSizeChange={(size) => { if (PAGE_SIZES.includes(size)) start(query.filters, size); }} />
  </section>;
}
