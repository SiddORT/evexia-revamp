import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { purchaseOrderRequest } from '../../auth/adminSession.js';
import { validOrderDraft } from '../../auth/orderDraftResponse.js';
import OrderPortalLayout, { useOrderActions, useOrderBase } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import '../../immunotherapy.css';

const LIMIT = 25;
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default function ImmunotherapyDrafts() {
  const can = useOrderActions('immunotherapy');
  const BASE = useOrderBase('immunotherapy');
  return <OrderPortalLayout title="IMMUNOTHERAPY DRAFTS"><div className="imm">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders</p><h1>Immunotherapy Drafts</h1>
        <p className="admin-page-head__description">Only drafts created by your account appear here. Drafts are not submitted orders and are excluded from order totals and review.</p></div>
      <Link href={BASE} className="admin-button admin-button--secondary" data-testid="link-imm-drafts-back">Back to all orders</Link>
    </div>
    {can.add ? <DraftTable base={BASE} /> : <section className="admin-panel imm-empty">
      <h2>Drafts unavailable</h2><p role="alert">Permission to add Immunotherapy orders is required to access drafts.</p>
    </section>}
  </div></OrderPortalLayout>;
}

function DraftTable({ base }) {
  const { timestamp } = useAdminDateFormatters();
  const [query, setQuery] = useState({ cursor: null, section: 1 });
  const [result, setResult] = useState({ query: null, items: [], nextCursor: null, error: '' });
  // Associate each response with its request so old rows/actions disappear
  // immediately on navigation or refresh, before the next effect runs.
  const busy = result.query !== query;
  const items = busy ? [] : result.items;
  const error = busy ? '' : result.error;
  useEffect(() => {
    const controller = new AbortController();
    purchaseOrderRequest('', { params: { cursor: query.cursor, limit: LIMIT }, signal: controller.signal }, 'order-drafts/immunotherapy')
      .then((data) => {
        if (!Array.isArray(data?.items) || data.items.length > LIMIT
            || data.items.some((item) => !validOrderDraft(item, 'immunotherapy', item?.id))
            || new Set(data.items.map((item) => item.id)).size !== data.items.length
            || (data.nextCursor !== null && (!uuid(data.nextCursor) || data.nextCursor === query.cursor
              || data.nextCursor !== data.items.at(-1)?.id))) {
          throw new Error('The saved draft list could not be read. Retry to retrieve this section.');
        }
        if (!controller.signal.aborted) setResult({ query, items: data.items, nextCursor: data.nextCursor, error: '' });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setResult({ query, items: [], nextCursor: null, error: cause.message || 'Drafts could not be retrieved.' });
      });
    return () => controller.abort();
  }, [query]);
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_item, index) => index + 1 },
    // Immunotherapy entry drafts save only the patient reference, not a
    // patient snapshot. Do not fetch directory records just to label this table.
    { key: 'patient', label: 'Saved patient reference', render: (item) => item.payload.values.patientId || '—' },
    { key: 'saved', label: 'Last saved', render: (item) => <time dateTime={item.updatedAt}>{timestamp(item.updatedAt)}</time> },
    { key: 'remarks', label: 'Remarks', render: (item) => item.payload.values.remarks.trim() ? item.payload.values.remarks : '—' },
    { key: 'resume', label: 'Action', render: (item, index) => <Link
      href={`${base}/new?draft=${encodeURIComponent(item.id)}`} className="admin-button admin-button--secondary"
      aria-label={`Resume draft in row ${index + 1}, saved ${timestamp(item.updatedAt)}`} data-testid={`link-imm-draft-resume-${item.id}`}>Resume</Link> },
  ];
  return <section className="admin-panel imm-drafts" aria-label="Saved Immunotherapy drafts" aria-busy={busy}>
    <div className="imm-toolbar">
      <button type="button" className="admin-button admin-button--secondary" disabled={busy}
        onClick={() => setQuery({ cursor: null, section: 1 })} data-testid="button-imm-drafts-refresh">Refresh drafts</button>
    </div>
    <p className="imm-drafts__note">Patient names and demographics are not included in saved draft entries; only an available saved patient reference is shown. Row numbers restart in each section and are not draft identifiers.</p>
    {error ? <div className="imm-empty">
      <strong>Drafts unavailable</strong><p role="alert" data-testid="error-imm-drafts">{error}</p>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setQuery({ ...query })}
        data-testid="button-imm-drafts-retry">Retry this section</button>
    </div> : <DataTable columns={columns} rows={items} rowKey={(item) => item.id}
      label="Immunotherapy drafts (scrolls horizontally)" testIdPrefix="imm-draft" loading={busy} loadingLabel="Loading saved Immunotherapy drafts…"
      empty={<div className="imm-empty" role="status" data-testid="empty-imm-drafts">
        <strong>{query.cursor ? 'No saved drafts in this section' : 'No saved Immunotherapy drafts'}</strong>
        <p>Use Save as Draft in the new-order editor to keep an incomplete order for later.</p>
      </div>} />}
    <div className="admin-panel__foot admin-pagination">
      <span aria-live="polite" data-testid="text-imm-drafts-section">{busy ? 'Loading drafts…' : error ? 'Section unavailable' : `${items.length} drafts in section ${query.section}. No overall draft total is available.`}</span>
      <nav className="admin-pagination__pages" aria-label="Draft sections">
        <button type="button" disabled={busy || !query.cursor} onClick={() => setQuery({ cursor: null, section: 1 })}
          data-testid="button-imm-drafts-first">First section</button>
        <button type="button" disabled={busy || Boolean(error) || !result.nextCursor}
          onClick={() => setQuery({ cursor: result.nextCursor, section: query.section + 1 })}
          data-testid="button-imm-drafts-next">Next section</button>
      </nav>
    </div>
  </section>;
}
