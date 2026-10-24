import { useEffect } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { MASTER_CATALOGUE, canViewMaster, isStaffIdentity, staffPathAllowed } from '../../auth/capabilities.js';

export default function Dashboard() {
  const { user } = useAdminSession();
  const [, navigate] = useLocation();
  const staff = isStaffIdentity(user);
  const firstMaster = MASTER_CATALOGUE.find((master) => canViewMaster(user, master.key));
  const destination = firstMaster ? (firstMaster.key === 'language' ? '/admin/languages' : `/admin/masters/${firstMaster.path}`)
    : ['/admin/inventory/purchase-orders', '/admin/inventory/purchase-received', '/admin/inventory/move-stocks',
      '/admin/inventory/stock-status', '/admin/orders/immunotherapy', '/admin/orders/spt',
      '/admin/orders/kits-consumables', '/admin/orders/lupin', '/admin/staff', '/admin/staff-access',
      '/admin/roles-permissions'].find((path) => staffPathAllowed(path, user));
  useEffect(() => { if (staff && destination) navigate(destination, { replace: true }); }, [staff, destination, navigate]);
  if (staff) return destination ? null : <AccessDenied title="Workspace" heading="No workspace permissions assigned" testId="status-no-workspace-access" message="Your account can sign in, but its saved role has no approved workspace permissions. Ask a Super Admin to update your role." />;
  return (
    <AdminLayout title="Dashboard">
      <div className="admin-empty-page">
        <div className="admin-page-head">
          <div><h1>Dashboard</h1></div>
        </div>
      </div>
    </AdminLayout>
  );
}