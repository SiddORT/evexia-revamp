import { useEffect } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { canViewZones, isStaffIdentity } from '../../auth/capabilities.js';

export default function Dashboard() {
  const { user } = useAdminSession();
  const [, navigate] = useLocation();
  const staff = isStaffIdentity(user);
  const zones = canViewZones(user);
  useEffect(() => { if (staff && zones) navigate('/admin/masters/zones', { replace: true }); }, [staff, zones, navigate]);
  if (staff) return zones ? null : <AccessDenied title="Workspace" heading="No Zone permissions assigned" testId="status-no-workspace-access" message="Your account can sign in, but its role has no Masters > Zone permissions. Ask a Super Admin to update your role." />;
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