import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';
import { usePortalHost, portalEntry } from '../config/portalHost.js';

export default function NotFound() {
  const role = usePortalHost();
  const home = portalEntry(role);
  return (
    <main className="app-shell portal-page">
      <div className="container">
        <header className="topbar"><Link href={home} aria-label="EVEXIA home" data-testid="link-not-found-home"><BrandMark /></Link></header>
        <section className="portal-hero">
          <div className="eyebrow">404 / Not found</div>
          <h1>That portal is not here.</h1>
          <p>{role ? 'Return to the portal assigned to this hostname.' : 'Return to EVEXIA and choose one of the available access points.'}</p>
          <Link href={home} className="auth-back" data-testid="link-not-found-return"><ArrowLeft size={15} /> {role ? 'Return to portal entry' : 'Return to portal selection'}</Link>
        </section>
      </div>
    </main>
  );
}