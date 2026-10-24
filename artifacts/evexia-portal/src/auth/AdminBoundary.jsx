import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import { isStaffIdentity, staffPathAllowed } from './capabilities.js';
import { getSession, subscribeSession, verifySession } from './adminSession.js';
import PortalLoader from '../components/PortalLoader.jsx';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';
import MasterRecordAccess from './MasterRecordAccess.jsx';
import DraftSignIn from './DraftSignIn.jsx';

export function useAdminSession() {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

export default function AdminBoundary({ children }) {
  const [path, navigate] = useLocation();
  const session = useAdminSession();
  const { theme, appearance } = useAdminPreferences();
  const protectedPath = (path === '/admin' || path.startsWith('/admin/')) && path !== '/admin/login';
  const [verifiedPath, setVerifiedPath] = useState(null);
  const staffBlocked = Boolean(isStaffIdentity(session.user) && !staffPathAllowed(path, session.user));
  const mountedAccess = useRef(null);
  if (verifiedPath === path && session.status === 'authenticated' && !staffBlocked) {
    mountedAccess.current = { path, owner: session.user?.id, user: session.user };
  }
  const preservingDraft = mountedAccess.current?.path === path
    && (!session.user || mountedAccess.current?.owner === session.user.id);
  useEffect(() => {
    if (!protectedPath) return;
    let active = true;
    void verifySession(false, 'admin').then(() => { if (active) setVerifiedPath(path); });
    return () => { active = false; };
  }, [path, protectedPath]);
  useEffect(() => {
    if (protectedPath && verifiedPath === path && session.status === 'anonymous' && !preservingDraft) {
      // Session notices remain in module memory, never in the return URL.
      // Initial signed-out routes have no retained owner or draft.
      navigate(`/admin/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
    }
  }, [path, protectedPath, verifiedPath, session.status, preservingDraft, navigate]);
  if (!protectedPath) return children;
  const authorized = verifiedPath === path && session.status === 'authenticated';
  const keepMounted = verifiedPath === path && (preservingDraft
    || ['authenticated', 'renewing', 'renewal-error'].includes(session.status));
  const mountedUser = session.user || mountedAccess.current?.user;
  const failed = session.status === 'error' || session.status === 'renewal-error';
  return (
    <>
      {/* Same-route renewal hides and disables the already-verified subtree
          without discarding drafts. Initial/denied routes never mount it. */}
      <div hidden={!authorized || staffBlocked} inert={!authorized || staffBlocked ? true : undefined} data-testid="admin-session-content">
         {keepMounted && (!staffBlocked || preservingDraft) ? <MasterRecordAccess key={`${path}/${mountedUser?.id}`} path={path} user={mountedUser}>{children}</MasterRecordAccess> : null}
      </div>
       {authorized && staffBlocked && <main className="portal-loading-page" data-admin-theme={theme} data-admin-appearance={appearance}><section className="portal-verification-error"><h1>Access is not available</h1><p role="alert">Your current saved role does not allow this page.{preservingDraft ? ' Your mounted draft is preserved while this page is hidden. Do not reload or leave if you need to recover it after access is restored.' : ''}</p><button onClick={() => void verifySession(false, 'admin')}>Check saved access</button><button onClick={() => navigate('/admin')}>Go to allowed workspace</button></section></main>}
      {!authorized && (
        <main className="portal-loading-page" data-admin-theme={theme} data-admin-appearance={appearance}>
           {preservingDraft && session.status === 'anonymous' ? <DraftSignIn message={session.message} /> : failed ? <section className="portal-verification-error">
            <div role="alert">{session.message}</div>
            <button onClick={() => void verifySession(false, 'admin')}>Retry session verification</button>
          </section> : <PortalLoader label={session.status === 'renewing' ? 'Renewing Admin access…' : 'Checking Admin access…'} />}
        </main>
      )}
    </>
  );
}