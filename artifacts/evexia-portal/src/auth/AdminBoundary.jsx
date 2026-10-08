import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import { isStaffIdentity, staffPathAllowed } from './capabilities.js';
import { getSession, subscribeSession, verifySession } from './adminSession.js';
import PortalLoader from '../components/PortalLoader.jsx';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';

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
  useEffect(() => {
    if (!protectedPath) return;
    let active = true;
    void verifySession(false, 'admin').then(() => { if (active) setVerifiedPath(path); });
    return () => { active = false; };
  }, [path, protectedPath]);
  useEffect(() => {
    if (protectedPath && verifiedPath === path && session.status === 'anonymous') {
      // Session notices remain in module memory, never in the return URL.
      // Definitive denial still drops protected drafts/content before redirect.
      navigate(`/admin/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
    }
  }, [path, protectedPath, verifiedPath, session.status, navigate]);
  useEffect(() => {
    // Restricted staff never mount unrelated screens; send them to /admin.
    if (protectedPath && staffBlocked && verifiedPath === path) navigate('/admin', { replace: true });
  }, [protectedPath, staffBlocked, verifiedPath, path, navigate]);
  if (!protectedPath) return children;
  const authorized = verifiedPath === path && session.status === 'authenticated';
  const keepMounted = verifiedPath === path && ['authenticated', 'renewing', 'renewal-error'].includes(session.status);
  const failed = session.status === 'error' || session.status === 'renewal-error';
  return (
    <>
      {/* Same-route renewal hides and disables the already-verified subtree
          without discarding drafts. Initial/denied routes never mount it. */}
      <div hidden={!authorized} inert={!authorized ? true : undefined} data-testid="admin-session-content">
        {keepMounted && !staffBlocked ? children : null}
      </div>
      {!authorized && (
        <main className="portal-loading-page" data-admin-theme={theme} data-admin-appearance={appearance}>
          {failed ? <section className="portal-verification-error">
            <div role="alert">{session.message}</div>
            <button onClick={() => void verifySession(false, 'admin')}>Retry session verification</button>
          </section> : <PortalLoader label={session.status === 'renewing' ? 'Renewing Admin access…' : 'Checking Admin access…'} />}
        </main>
      )}
    </>
  );
}