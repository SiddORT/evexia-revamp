import { Link, useLocation } from 'wouter';
import { Wallet } from 'lucide-react';

// Single Accounts destination; legacy Payments/Settlements URLs redirect here.
export default function AccountsNavigation() {
  const [path] = useLocation();
  const active = ['/mr/accounts', '/mr/payments'].some((p) => path === p || path.startsWith(`${p}/`));
  return <Link href="/mr/accounts" aria-current={active ? 'page' : undefined} data-testid="link-nav-accounts">
    <Wallet className="mrw-nav__icon" size={20} aria-hidden="true" /><span>Accounts</span>
  </Link>;
}
