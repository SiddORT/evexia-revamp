import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';

export default function NotFound() {
  return (
    <main className="app-shell portal-page">
      <div className="container">
        <header className="topbar"><Link href="/" aria-label="EVEXIA home" data-testid="link-not-found-home"><BrandMark /></Link></header>
        <section className="portal-hero">
          <div className="eyebrow">404 / Not found</div>
          <h1>That portal is not here.</h1>
          <p>Return to EVEXIA and choose one of the available access points.</p>
          <Link href="/" className="auth-back" data-testid="link-not-found-return"><ArrowLeft size={15} /> Return to portal selection</Link>
        </section>
      </div>
    </main>
  );
}