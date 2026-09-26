export default function StatusBadge({ status, id, kind = 'zone' }) {
  return <span className={`admin-badge${status === 'inactive' ? ' admin-badge--inactive' : ''}`} data-testid={`status-${kind}-${id}`}>{status === 'inactive' ? 'Inactive' : 'Active'}</span>;
}