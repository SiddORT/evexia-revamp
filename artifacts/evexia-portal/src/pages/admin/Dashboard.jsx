import AdminLayout from '../../components/admin/AdminLayout.jsx';

export default function Dashboard() {
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