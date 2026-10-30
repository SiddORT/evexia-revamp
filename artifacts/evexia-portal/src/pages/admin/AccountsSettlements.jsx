import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import { contactReadScope } from '../../auth/adminSession.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import SettlementsView from '../../components/accounts/SettlementsView.jsx';

export default function AccountsSettlements() {
  const { user } = useAdminSession();
  const { date } = useAdminDateFormatters();
  if (!isSuperAdminIdentity(user)) return <AdminLayout title="SETTLEMENTS"><section className="admin-panel settle-state" role="alert"><strong>Settlements are restricted</strong><p>Only the Super Admin can view settlements.</p></section></AdminLayout>;
  return <AdminLayout title="SETTLEMENTS"><SettlementsView key={`${user?.id}:${contactReadScope(user)}`} mode="admin" date={(v) => (v ? date(v) : '')} /></AdminLayout>;
}
