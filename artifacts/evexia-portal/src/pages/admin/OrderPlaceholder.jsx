import AdminLayout from '../../components/admin/AdminLayout.jsx';

export default function OrderPlaceholder({ destination }) {
  return (
    <AdminLayout title={destination.label}>
      <div className="admin-empty-page">
        <div className="admin-page-head">
          <div>
            <p className="admin-page-head__eyebrow">Orders</p>
            <h1>{destination.label}</h1>
            {destination.description && <p className="admin-page-head__description">{destination.description}</p>}
          </div>
        </div>
        <p className="admin-preview-notice" data-testid="status-order-placeholder">
          Mock navigation placeholder — this order page is not built yet. No order records or processing are available.
        </p>
      </div>
    </AdminLayout>
  );
}
