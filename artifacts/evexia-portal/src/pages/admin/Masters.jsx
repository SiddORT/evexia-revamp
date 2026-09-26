import { ArrowUpRight, MapPinned } from 'lucide-react';
import { Link } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';

export default function Masters() {
  return (
    <AdminLayout title="Masters">
      <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Workspace / Configuration</p><h1>Masters</h1></div></div>
      <div className="admin-panel">
        <Link href="/admin/masters/zones" className="admin-master-link" data-testid="link-master-zones">
          <span className="admin-master-link__icon"><MapPinned size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Zone Master</strong><small>Manage the zones used within EVEXIA.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
      </div>
    </AdminLayout>
  );
}