import { useOrderPortal } from './OrderPortalContext.jsx';
import OrderTransfers from '../admin/OrderTransfers.jsx';

// Listing content is independent of transfer visibility. In the MR portal,
// render the complete header (including Add Order) without mounting transfers.
export default function OrderListingHeader({ renderActions, ...transferProps }) {
  const { portal } = useOrderPortal();
  if (portal === 'mr') return renderActions(null);
  return <OrderTransfers {...transferProps} renderActions={renderActions} />;
}
