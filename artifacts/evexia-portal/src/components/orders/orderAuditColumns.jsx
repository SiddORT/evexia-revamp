import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import './orderAuditColumns.css';

// Admin-only audit columns from protected server metadata (order.audit).
// Null or missing values are reported as unavailable, never inferred.
export function useAuditColumns(portal) {
  const { timestamp } = useAdminDateFormatters();
  if (portal === 'mr') return [];
  const who = (name) => name || <span className="order-audit-unavailable">Unavailable</span>;
  const when = (value) => value ? timestamp(value) : <span className="order-audit-unavailable">Unavailable</span>;
  return [
    { key: 'createdDetails', label: 'Created details', render: (o) =>
      <div className="order-audit-details">
        <strong>{who(o.audit?.createdBy)}</strong>
        <span>{when(o.audit?.createdAt)}</span>
      </div> },
    { key: 'updatedDetails', label: 'Updated details', render: (o) =>
      <div className="order-audit-details">
        <strong>{who(o.audit?.updatedBy)}</strong>
        <span>{when(o.audit?.updatedAt)}</span>
      </div> },
  ];
}

// Insert audit columns just before the trailing action column.
export function withAuditColumns(columns, audit) {
  if (!audit.length) return columns;
  return [...columns.slice(0, -1), ...audit, columns[columns.length - 1]];
}
