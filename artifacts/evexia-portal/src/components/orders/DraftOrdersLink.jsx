import { Link } from 'wouter';
import { useOrderPortal } from './OrderPortalContext.jsx';

// The origin is navigation context only, never an implicit order-type filter.
export default function DraftOrdersLink({ from, testId }) {
  const { portal } = useOrderPortal();
  return <Link href={`/${portal}/orders/drafts?returnTo=${encodeURIComponent(from)}`}
    className="admin-button admin-button--secondary" data-testid={testId}>Drafts</Link>;
}
