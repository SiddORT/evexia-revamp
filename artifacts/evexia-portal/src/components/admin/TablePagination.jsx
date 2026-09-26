export default function TablePagination({ page, pageCount, pageSize, filtered, total, label, onPageChange, onPageSizeChange, testId }) {
  const first = filtered ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, filtered);
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pageNumbers = Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);

  return <div className="admin-panel__foot admin-pagination">
    <span data-testid={testId} aria-live="polite">Showing {filtered ? `${first}–${last}` : '0'} of {filtered} {label}{filtered !== total ? ` (${total} total)` : ''}</span>
    <div className="admin-pagination__controls">
      <label className="admin-pagination__size">Rows per page
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} aria-label="Rows per page">
          {[2, 5, 10, 25].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <nav className="admin-pagination__pages" aria-label={`${label} pages`}>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Previous page">Previous</button>
        {pageNumbers.map((number) => <button type="button" key={number} onClick={() => onPageChange(number)} aria-label={`Go to page ${number}`} aria-current={page === number ? 'page' : undefined} className={page === number ? 'admin-pagination__current' : undefined}>{number}</button>)}
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === pageCount} aria-label="Next page">Next</button>
      </nav>
      <span className="admin-pagination__total">Page {page} of {pageCount}</span>
    </div>
  </div>;
}