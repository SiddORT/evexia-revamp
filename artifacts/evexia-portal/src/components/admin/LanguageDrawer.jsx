import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getLanguageHistory } from '../../services/serverLanguages.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../poActivityDrawer.css';
import '../../inventoryServer.css';

const LIMIT = 10;
const LABEL = { create: 'Created', edit: 'Edited', delete: 'Deleted' };

export default function LanguageDrawer({ id, name, onClose }) {
  const { timestamp } = useAdminDateFormatters();
  const dialogRef = useRef(null);
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    getLanguageHistory(id, { limit: LIMIT, offset }, c.signal)
      .then((data) => { if (!c.signal.aborted) setState({ data, loading: false, error: '' }); })
      .catch((e) => { if (!c.signal.aborted) setState((s) => ({ data: s.data, loading: false, error: e.message || 'Language history could not be loaded.' })); });
    return () => c.abort();
  }, [id, offset, tick]);
  function closeOnBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const b = event.currentTarget.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
  }
  const d = state.data;
  const r = d?.record;
  const sum = d?.summary;
  return <dialog ref={dialogRef} className="po-activity-drawer" aria-labelledby="language-drawer-heading" aria-describedby="language-drawer-description"
    onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={closeOnBackdrop} data-testid="drawer-language-detail">
    <header className="po-activity-drawer__header">
      <div><p className="po-activity-drawer__number">{r?.name || name || 'Language'}</p><h2 id="language-drawer-heading">Language details</h2></div>
      <button type="button" className="po-action po-activity-drawer__close" onClick={onClose} autoFocus aria-label="Close language details" title="Close language details" data-testid="button-close-language-detail"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="po-activity-drawer__body">
      <p id="language-drawer-description" className="po-activity-drawer__description">Server history of committed changes to this language. Records are append-only and survive deletion.</p>
      {state.loading && <div role="status" className="admin-empty"><strong>{d ? 'Loading history page…' : 'Loading language…'}</strong></div>}
      {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-retry-language-history">Retry</button></div>}
      {r && <>
        {r.deletedAt && <div className="admin-feedback" role="status" data-testid="status-language-deleted">Deleted by {r.deletedBy} on {timestamp(r.deletedAt)}. History is retained as evidence.</div>}
        <dl className="stock-report__meta">
          <div><dt>Language name</dt><dd>{r.name}</dd></div>
          <div><dt>Version</dt><dd>{r.version}</dd></div>
          <div><dt>Created</dt><dd>{r.createdBy}<span className="stock-sub">{timestamp(r.createdAt)}</span></dd></div>
          <div><dt>Last updated</dt><dd>{r.updatedBy}<span className="stock-sub">{timestamp(r.updatedAt)}</span></dd></div>
        </dl>
        <section className="inv-drawer-section"><h3>Server history</h3>
          {d.items.length ? <div className="po-activity">{d.items.map((a) => <article className="po-event" key={a.id}><div>
            <strong className="po-activity-drawer__action">{LABEL[a.action] || a.action} · version {a.version}</strong>
            <p>{timestamp(a.at)} · {a.actor}</p>
            {a.action === 'edit' && <p>{a.beforeName} to {a.afterName}</p>}
            {a.action !== 'edit' && <p>{a.afterName}</p>}
          </div></article>)}</div> : <p>No history recorded.</p>}
          {d.total > LIMIT && <div className="inv-banner">
            <button type="button" className="admin-button admin-button--secondary" disabled={state.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} data-testid="button-language-history-prev">Previous</button>
            <span>{state.loading ? 'Loading…' : `${d.offset + 1}–${Math.min(d.offset + LIMIT, d.total)} of ${d.total}`}</span>
            <button type="button" className="admin-button admin-button--secondary" disabled={state.loading || offset + LIMIT >= d.total} onClick={() => setOffset(offset + LIMIT)} data-testid="button-language-history-next">Next</button>
          </div>}
        </section>
        {sum && <section className="inv-drawer-section"><h3>Scope</h3>
          <p data-testid="text-language-summary">{sum.total} committed change{sum.total === 1 ? '' : 's'}: {sum.creates} create, {sum.edits} edit{sum.edits === 1 ? '' : 's'}, {sum.deletes} delete. Latest change: {sum.latestChange ? timestamp(sum.latestChange) : 'none'}. {sum.scope}</p></section>}
      </>}
    </div>
  </dialog>;
}
