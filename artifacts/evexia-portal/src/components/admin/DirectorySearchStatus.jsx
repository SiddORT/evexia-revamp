export default function DirectorySearchStatus({ count, scanned, nextCursor, loading, onNext, onRestart }) {
  return <section aria-label="Encrypted search section" className="admin-table-pagination">
    <p role="status">{count} matches in this section · {scanned} records checked.
      {nextCursor ? ' More records remain to be checked.' : ' No further records remain after this section.'}
      {' '}This is not a complete matching-record count. Exports include every match, independently of this section.</p>
    <div className="mr-form__actions">
      <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={onRestart}>Restart search</button>
      <button type="button" className="admin-button admin-button--secondary" disabled={loading || !nextCursor} onClick={onNext}>Continue search</button>
    </div>
  </section>;
}
