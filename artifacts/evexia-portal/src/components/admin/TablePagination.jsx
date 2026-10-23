import SelectIndicator from './SelectIndicator.jsx';
export default function TablePagination({ page, pageCount, pageSize, filtered, total, label, onPageChange, onPageSizeChange, testId, indicated = false, pageScope = '', resultNote, children, cursorMode = false, sectionCount = 0 }) {
  const first = filtered ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, filtered);
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pageNumbers = Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);
  const sizeSelect = <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} aria-label="Rows per page">
    {[2, 5, 10, 25].map((size) => <option key={size} value={size}>{size}</option>)}
  </select>;

  return <div className="admin-panel__foot admin-pagination">
    <span data-testid={testId} aria-live="polite">{cursorMode ? `${sectionCount} ${label} in this server section · ${filtered == null ? 'Bounded search; continue for more matches' : `${filtered} matching saved orders`} · ${total} total` : <>Showing {filtered ? `${first}–${last}` : '0'} of {filtered} {label}{filtered !== total ? ` (${total} total)` : ''}</>}{resultNote}</span>
    <div className="admin-pagination__controls">
      <label className="admin-pagination__size">Rows per page
        {indicated ? <SelectIndicator>{sizeSelect}</SelectIndicator> : sizeSelect}
      </label>
      <nav className="admin-pagination__pages" aria-label={`${label} pages${pageScope ? ` (${pageScope})` : ''}`}>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Previous page">Previous</button>
        {!cursorMode && pageNumbers.map((number) => <button type="button" key={number} onClick={() => onPageChange(number)} aria-label={`Go to page ${number}`} aria-current={page === number ? 'page' : undefined} className={page === number ? 'admin-pagination__current' : undefined}>{number}</button>)}
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === pageCount} aria-label="Next page">Next</button>
      </nav>
      <span className="admin-pagination__total">{cursorMode ? `Section ${page}${page < pageCount ? ' · more available' : ' · end of results'}` : `${pageScope ? `${pageScope}: page` : 'Page'} ${page} of ${pageCount}`}</span>
      {children}
    </div>
  </div>;
}