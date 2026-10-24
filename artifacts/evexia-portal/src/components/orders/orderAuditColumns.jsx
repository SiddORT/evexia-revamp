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
    { key: 'createdBy', label: 'Created By', render: (o) => who(o.audit?.createdBy) },
    { key: 'createdAt', label: 'Created At', render: (o) => when(o.audit?.createdAt) },
    { key: 'updatedBy', label: 'Updated By', render: (o) => who(o.audit?.updatedBy) },
    { key: 'updatedAt', label: 'Updated At', render: (o) => when(o.audit?.updatedAt) },
  ];
}

// Insert audit columns just before the trailing action column.
export function withAuditColumns(columns, audit) {
  if (!audit.length) return columns;
  return [...columns.slice(0, -1), ...audit, columns[columns.length - 1]];
}
