import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { PortalHostContext, compatiblePortalPath, portalEntry } from '../config/portalHost.js';
import PortalLoader from './PortalLoader.jsx';

export default function PortalHostBoundary({ children }) {
  const [path, navigate] = useLocation();
  const [resolution, setResolution] = useState({ status: 'loading', role: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResolution({ status: 'loading', role: null });
    async function resolve() {
      try {
        const response = await fetch(`/api/v1/portal/resolve?${new URLSearchParams({ hostname: window.location.hostname })}`, {
          credentials: 'omit', cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!data || !Object.hasOwn(data, 'role') || ![null, 'admin', 'mr', 'doctor'].includes(data.role)) throw new Error();
        if (!controller.signal.aborted) setResolution({ status: 'ready', role: data.role });
      } catch {
        if (!controller.signal.aborted) setResolution({ status: 'error', role: null });
      }
    }
    void resolve();
    return () => controller.abort();
  }, [attempt]);
  const role = resolution.role;
  useEffect(() => {
    if (resolution.status === 'ready' && role && path === '/') {
      // Same-origin router navigation, preserving the artifact base path.
      navigate(portalEntry(role), { replace: true });
    }
  }, [resolution.status, role, path, navigate]);
  if (resolution.status === 'error') return <main className="portal-loading-page"><section className="portal-verification-error">
    <h1>Portal could not be determined</h1>
    <p role="alert">Unable to check this hostname. No portal has been selected. Check your connection and retry.</p>
    <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry portal lookup</button>
  </section></main>;
  if (resolution.status === 'loading' || (role && path === '/')) return <main className="portal-loading-page"><PortalLoader label="Checking portal hostname…" /></main>;
  if (role && !compatiblePortalPath(path, role)) return <main className="portal-loading-page"><section className="portal-verification-error">
    <h1>This hostname opens the {role === 'mr' ? 'MR' : role === 'admin' ? 'Admin' : 'Doctor'} portal</h1>
    <p role="alert">This path belongs to a different portal. Hostname selection does not change account access.</p>
    <Link href={portalEntry(role)}>Continue to the assigned portal</Link>
  </section></main>;
  return <PortalHostContext.Provider value={role}>{children}</PortalHostContext.Provider>;
}
