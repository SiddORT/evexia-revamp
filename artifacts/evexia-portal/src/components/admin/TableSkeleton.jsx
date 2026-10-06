// Decorative rows use the real table's headers and cell styles. Announce the
// request once outside the busy table, never once per placeholder cell.
export function TableLoadingStatus({ label }) {
  return <span className="loading-announcement" role="status" aria-live="polite">{label}</span>;
}

export default function TableSkeleton({ columns, rowCount = 5 }) {
  return (
    <tbody aria-hidden="true" data-testid="table-skeleton">
      {Array.from({ length: rowCount }, (_, row) => (
        <tr key={row}>
          {columns.map((column, index) => (
            <td key={column.key || index}>
              {Array.from({ length: column.skeletonLines || 1 }, (_, line) => (
                <span key={line} className="table-skeleton__bar" style={{ width: line ? '65%' : column.skeletonWidth || (index === 0 ? '22px' : '80%') }} />
              ))}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
