import { useEffect } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { MASTER_CATALOGUE, canViewMaster, isStaffIdentity } from '../../auth/capabilities.js';

export default function Dashboard() {
  const { user } = useAdminSession();
  const [, navigate] = useLocation();
  const staff = isStaffIdentity(user);
  const firstMaster = MASTER_CATALOGUE.find((master) => canViewMaster(user, master.key));
  useEffect(() => { if (staff && firstMaster) navigate(`/admin/masters/${firstMaster.path}`, { replace: true }); }, [staff, firstMaster?.path, navigate]);
  if (staff) return firstMaster ? null : <AccessDenied title="Workspace" heading="No master permissions assigned" testId="status-no-workspace-access" message="Your account can sign in, but its role has no master permissions. Ask a Super Admin to update your role." />;
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