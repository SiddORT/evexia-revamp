import { useSyncExternalStore } from 'react';
import { contactReadScope, getSession, subscribeSession } from '../auth/adminSession.js';
import { mrDisplayIdentity } from '../auth/displayIdentity.js';
import SettlementsView from '../components/accounts/SettlementsView.jsx';
import { useDate } from './common.jsx';

export default function MRAccountsSettlements() {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const date = useDate();
  // MRBoundary hides/inerts this already-mounted subtree during renewal.
  // Keep the same editor alive while that boundary checks this same account.
  if (session.user?.identity_kind !== 'mr') return <section className="mrw-card"><h1>Settlements</h1><p role="status">Sign in to load your settlements.</p></section>;
  // Keyed remount on account/scope change so late responses and drafts never cross accounts.
  const owner = `${session.user?.id}:${contactReadScope(session.user)}`;
  const identity = mrDisplayIdentity(session.user);
  const label = typeof identity === 'string' ? identity : [identity?.name, identity?.account].filter(Boolean).join(' · ');
  return <SettlementsView key={owner} mode="mr" date={(v) => (v ? date(v) : '')} mrIdentity={label} />;
}
