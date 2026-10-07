import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { getSession, verifySession } from './adminSession.js';
import { useAdminSession } from './AdminBoundary.jsx';
import PortalLoader from '../components/PortalLoader.jsx';

// Mounts children only for a database-verified MR identity.
export default function MRBoundary({ children }) {
  const [, navigate] = useLocation();
  const session = useAdminSession();
  const [verified, setVerified] = useState(false);
  const mountedOwner = useRef(null);
  useEffect(() => {
    let active = true;
    void verifySession(false, 'mr').then(() => { if (active) setVerified(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (verified && getSession().status === 'anonymous') navigate('/mr', { replace: true });
  }, [verified, session.status, navigate]);
  const allowed = verified && session.status === 'authenticated' && session.user?.identity_kind === 'mr';
  if (allowed) mountedOwner.current = session.user.id;
  const preserve = mountedOwner.current && mountedOwner.current === session.user?.id &&
    session.user?.identity_kind === 'mr' && ['renewing', 'renewal-error'].includes(session.status);
  if (!allowed && !preserve) mountedOwner.current = null;
  const failed = session.status === 'error' || session.status === 'renewal-error';
  return <>
    {(allowed || preserve) && <div hidden={!allowed} inert={!allowed ? true : undefined} key={session.user.id}>{children}</div>}
    {!allowed && <main className="portal-loading-page">{failed
      ? <section className="portal-verification-error"><div role="alert">{session.message}</div><button onClick={() => void verifySession(false, 'mr')}>Retry session verification</button></section>
      : <PortalLoader label="Checking MR access…" />}</main>}
  </>;
}
