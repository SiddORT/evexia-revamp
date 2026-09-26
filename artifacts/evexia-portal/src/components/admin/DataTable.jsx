export default function DataTable({ columns, rows, rowKey, empty, label = 'Zone records', testIdPrefix = 'zone', rowOffset = 0 }) {
  if (!rows.length) return empty;
  return (
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="admin-table">
        <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row)} data-testid={`row-${testIdPrefix}-${rowKey(row)}`}>
              {columns.map((column) => <td key={column.key}>{column.render(row, index + rowOffset)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}