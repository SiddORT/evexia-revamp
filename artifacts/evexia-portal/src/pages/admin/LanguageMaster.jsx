import { useEffect, useState } from 'react';
import { Languages, Pencil, Plus, ScrollText, Search, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import LanguageForm from '../../components/admin/LanguageForm.jsx';
import LanguageDrawer from '../../components/admin/LanguageDrawer.jsx';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useLanguages from '../../hooks/useLanguages.js';

function details(by, at, timestamp) {
  return <span className="admin-table__details"><strong>{by}</strong><small>{timestamp(at)}</small></span>;
}

export default function LanguageMaster() {
  const { user } = useAdminSession();
  if (user?.identity_kind !== 'super_admin' || !user.permissions.includes('admin.access')) return <AccessDenied title="Language Master" heading="Language Master is not available" testId="status-language-denied" message="Language Master is restricted to the protected Super Admin." />;
  return <LanguageWorkspace />;
}

function LanguageWorkspace() {
  const { timestamp } = useAdminDateFormatters();
  const [deleted, setDeleted] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { languages, total, filtered, loading, pending, error, feedback, clearFeedback: clearHookFeedback, retry, add, edit, remove } = useLanguages(search, page, pageSize);
  const clearFeedback = () => { clearHookFeedback(); setDeleted(null); };
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [actionError, setActionError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [cardView, setCardView] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setCardView(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const startIndex = (page - 1) * pageSize;
  const pagination = { page, pageSize, pageCount, pageRows: languages, startIndex, setPage, setPageSize: (size) => { setPageSize(size); setPage(1); } };
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  async function save(values, record) {
    const result = await (editing === 'new' ? add(values) : edit(record, values));
    if (result.success) setEditing(null);
    return result;
  }
  async function confirmDelete() {
    const result = await remove(confirming);
    if (result.success) { setDeleted({ id: confirming.id, name: confirming.name }); setConfirming(null); setActionError(''); }
    else {
      const stale = result.status === 409 || /stale/.test(result.code || '');
      setActionError(result.error + (stale || result.ambiguous ? ' Cancel and refresh the table before confirming again.' : ''));
      setBlocked(stale || Boolean(result.ambiguous));
    }
  }
  function requestDelete(language) { clearFeedback(); setActionError(''); setBlocked(false); setConfirming(language); }

  function renderActions(language, mobile = false) {
    const cls = mobile ? 'admin-zone-card__action' : 'admin-icon-button';
    const size = mobile ? 14 : 16;
    return <fieldset disabled={loading || pending} style={{ border: 0, padding: 0, margin: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={cls} aria-label={`View details and history for ${language.name}`} title="Details and history" onClick={() => setDrawer(language)} data-testid={`button-details-language-${language.id}`}><ScrollText size={size} aria-hidden="true" />{mobile && <span>History</span>}</button>
      <button type="button" className={cls} aria-label={`Edit ${language.name}`} title="Edit" onClick={() => { clearFeedback(); setEditing(language); }} data-testid={`button-edit-language-${language.id}`}><Pencil size={size} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${language.name}`} title="Delete" onClick={() => requestDelete(language)} data-testid={`button-delete-language-${language.id}`}><Trash2 size={size} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </fieldset>;
  }

  const columns = [
    { key: 'serial', label: 'Sr No', render: (_l, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Language name', render: (l) => <span className="admin-table__name" data-testid={`text-language-name-${l.id}`}>{l.name}</span> },
    { key: 'created', label: 'Created details', render: (l) => details(l.createdBy, l.createdAt, timestamp) },
    { key: 'updated', label: 'Updated details', render: (l) => details(l.updatedBy, l.updatedAt, timestamp) },
    { key: 'actions', label: 'Actions', render: (l) => renderActions(l) },
  ];

  return (
    <AdminLayout title="Language Master">
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Geography & Logistics</p><h1>Language Master</h1></div>
        <div className="admin-mr-head-actions"><button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-language"><Plus size={16} aria-hidden="true" /> Add language</button></div>
      </div>
      {feedback && <div className="admin-feedback" role="status" data-testid="status-language-feedback">{feedback}{deleted && feedback.startsWith('Language deleted') && <> <button type="button" className="admin-button admin-button--secondary" onClick={() => setDrawer(deleted)} data-testid="button-view-deleted-language-history">View deleted language history</button></>}</div>}
      {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-language-action-error">{actionError}</div>}
      <section className="admin-panel" aria-label="Language list">
        <div className="admin-toolbar master-filter-toolbar">
          <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button>
          <div className="admin-toolbar__fields">
            <label className="admin-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search languages by name</span>
              <input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by language name" data-testid="input-search-languages" />
            </label>
          </div>
          <MasterFilterReset disabled={!search} onClick={() => { setSearch(''); setPage(1); }} />
        </div>
        {loading ? <p className="admin-empty" role="status">Loading shared languages…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><Languages size={21} /></span><strong>Languages could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} onClick={retry} type="button" data-testid="button-retry-languages">Try again</button></div> : (
          <>
            {languages.length ? (cardView ? (
              <div className="admin-zone-cards" role="list" aria-label="Language records">
                {languages.map((language, index) => (
                  <article className="admin-zone-card" role="listitem" key={language.id} data-testid={`card-language-${language.id}`}>
                    <div className="admin-zone-card__heading">
                      <div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{startIndex + index + 1}</span><h2 data-testid={`text-language-name-${language.id}`}>{language.name}</h2></div>
                    </div>
                    <dl className="admin-zone-card__meta">
                      <div><dt>Created</dt><dd>{details(language.createdBy, language.createdAt, timestamp)}</dd></div>
                      <div><dt>Updated</dt><dd>{details(language.updatedBy, language.updatedAt, timestamp)}</dd></div>
                    </dl>
                    {renderActions(language, true)}
                  </article>
                ))}
              </div>
            ) : <DataTable columns={columns} rows={languages} rowOffset={startIndex} rowKey={(l) => l.id} />) : (
              <div className="admin-empty" data-testid="status-languages-empty">
                <span className="admin-empty__icon"><Languages size={21} aria-hidden="true" /></span>
                <strong>{total ? 'No matching languages' : 'No languages yet'}</strong>
                <p>{total ? 'Try a different name.' : 'Add your first language to get started.'}</p>
              </div>
            )}
            <TablePagination {...pagination} filtered={filtered} total={total} label={total === 1 ? 'language' : 'languages'} onPageChange={setPage} onPageSizeChange={pagination.setPageSize} testId="text-language-count" />
          </>
        )}
      </section>
      {editing && <LanguageForm language={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title="Delete language?" description={`Are you sure you want to delete “${confirming.name}”? It will disappear from normal lists. Server history is retained.`} actionLabel="Delete language" destructive onConfirm={confirmDelete} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
      {drawer && <LanguageDrawer key={drawer.id} id={drawer.id} name={drawer.name} onClose={() => setDrawer(null)} />}
    </AdminLayout>
  );
}
