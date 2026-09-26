export default function StatusBadge({ status, id }) {
  return <span className={`admin-badge${status === 'inactive' ? ' admin-badge--inactive' : ''}`} data-testid={`status-zone-${id}`}>{status === 'inactive' ? 'Inactive' : 'Active'}</span>;
}