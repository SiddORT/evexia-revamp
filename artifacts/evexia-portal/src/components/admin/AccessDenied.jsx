import { Link } from 'wouter';
import { ShieldAlert } from 'lucide-react';
import AdminLayout from './AdminLayout.jsx';

export default function AccessDenied({ title = 'Access', heading = 'No access to this area', message, testId = 'status-access-denied' }) {
  return <AdminLayout title={title}>
    <div className="admin-empty" role="alert" data-testid={testId}>
      <span className="admin-empty__icon"><ShieldAlert size={21} aria-hidden="true" /></span>
      <strong>{heading}</strong>
      <p>{message || 'Your role has no permissions for this area. Ask a Super Admin to update your role assignment.'}</p>
      <Link href="/admin" className="admin-button admin-button--secondary" data-testid="link-access-denied-home">Back to workspace</Link>
    </div>
  </AdminLayout>;
}
