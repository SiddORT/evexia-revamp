import { ArrowUpRight, Boxes, MapPinned, Stethoscope, UsersRound } from 'lucide-react';
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
        <Link href="/admin/masters/mrs" className="admin-master-link" data-testid="link-master-mrs">
          <span className="admin-master-link__icon"><UsersRound size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>MR Master</strong><small>Manage MR profiles and zone assignments in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/doctors" className="admin-master-link" data-testid="link-master-doctors">
          <span className="admin-master-link__icon"><Stethoscope size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Doctor Master</strong><small>Manage doctor profiles and MR assignments in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/product-categories" className="admin-master-link" data-testid="link-master-product-categories">
          <span className="admin-master-link__icon"><Boxes size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Product Category Master</strong><small>Manage category names, descriptions, prices and status in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
      </div>
    </AdminLayout>
  );
}