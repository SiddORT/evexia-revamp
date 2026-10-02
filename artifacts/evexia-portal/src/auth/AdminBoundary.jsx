import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import { getSession, subscribeSession, verifySession } from './adminSession.js';

export function useAdminSession() {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

export default function AdminBoundary({ children }) {
  const [path, navigate] = useLocation();
  const session = useAdminSession();
  const protectedPath = (path === '/admin' || path.startsWith('/admin/')) && path !== '/admin/login';
  const [verifiedPath, setVerifiedPath] = useState(null);
  useEffect(() => {
    if (!protectedPath) return;
    let active = true;
    void verifySession().then(() => { if (active) setVerifiedPath(path); });
    return () => { active = false; };
  }, [path, protectedPath]);
  useEffect(() => {
    if (protectedPath && verifiedPath === path && session.status === 'anonymous') {
      navigate(`/admin/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
    }
  }, [path, protectedPath, verifiedPath, session.status, navigate]);
  if (!protectedPath) return children;
  const authorized = verifiedPath === path && session.status === 'authenticated';
  const keepMounted = verifiedPath === path && ['authenticated', 'renewing', 'renewal-error'].includes(session.status);
  const failed = session.status === 'error' || session.status === 'renewal-error';
  return (
    <>
      {/* Same-route renewal hides and disables the already-verified subtree
          without discarding drafts. Initial/denied routes never mount it. */}
      <div hidden={!authorized} inert={!authorized ? true : undefined} data-testid="admin-session-content">
        {keepMounted ? children : null}
      </div>
      {!authorized && (
        <main className="auth-page"><section className="auth-panel">
          {failed ? <>
            <div role="alert">{session.message}</div>
            <button onClick={() => void verifySession()}>Retry session verification</button>
          </> : <div role="status">Checking Admin access…</div>}
        </section></main>
      )}
    </>
  );
}