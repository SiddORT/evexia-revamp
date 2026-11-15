import { BadgeIndianRupee } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import SavedPricingRules from '../../components/admin/SavedPricingRules.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import '../../pricingRules.css';

export default function PricingRules() {
  const session = useAdminSession();
  if (!isSuperAdminIdentity(session.user)) {
    return <AdminLayout title="Pricing Rules"><div className="admin-empty" role="alert" data-testid="status-pricing-rules-denied">
      <BadgeIndianRupee size={21} aria-hidden="true" /><strong>Access is not available</strong>
      <p>Pricing Rules can only be configured by a Super Admin.</p>
    </div></AdminLayout>;
  }
  return <AdminLayout title="Pricing Rules"><div className="pricing-rules-page">
    <SavedPricingRules key={session.user?.id || 'signed-out'} />
  </div></AdminLayout>;
}
