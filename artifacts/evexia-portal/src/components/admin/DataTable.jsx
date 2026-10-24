import TableSkeleton, { TableLoadingStatus } from './TableSkeleton.jsx';
import { Link, useLocation } from 'wouter';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { MASTER_CATALOGUE, canViewMaster, hasMasterPermission, isStaffIdentity } from '../../auth/capabilities.js';

export default function DataTable({ columns, rows = [], rowKey, empty, label = 'Zone records', testIdPrefix = 'zone', rowOffset = 0, loading = false, loadingLabel = `Loading ${label}…`, skeletonRows = 5 }) {
  const [path] = useLocation();
  const { user } = useAdminSession();
  const master = MASTER_CATALOGUE.find((item) => path === `/admin/masters/${item.path}` || (item.key === 'language' && path === '/admin/languages'));
  if (isStaffIdentity(user) && master && canViewMaster(user, master.key) && !hasMasterPermission(user, master.key, 'edit')) {
    columns = [...columns, { key: 'readOnlyDetails', label: 'Details', render: (row) => row.id
      ? <Link className="admin-button admin-button--secondary" href={`/admin/masters/${master.path}/${row.id}`}>View details</Link> : null }];
  }
  if (!loading && !rows.length) return empty;
  return (
    <>
    {loading && <TableLoadingStatus label={loadingLabel} />}
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="admin-table" aria-busy={loading}>
        <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
        {loading ? <TableSkeleton columns={columns} rowCount={skeletonRows} /> : <tbody>
          {rows.map((row, index) => {
            const key = rowKey(row);
            return <tr key={key} data-testid={`row-${testIdPrefix}-${key}`}>
              {columns.map((column) => <td key={column.key}>{column.render(row, index + rowOffset)}</td>)}
            </tr>;
          })}
        </tbody>}
      </table>
    </div>
    </>
  );
}