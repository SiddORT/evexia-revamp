import AdminLayout from '../../components/admin/AdminLayout.jsx';

export default function InHouseAccessDenied() {
  return <AdminLayout title="In-house stock"><div className="admin-empty" role="alert" data-testid="status-in-house-denied"><strong>Access restricted</strong><p>In-house stock is available to Super Admin only.</p></div></AdminLayout>;
}
