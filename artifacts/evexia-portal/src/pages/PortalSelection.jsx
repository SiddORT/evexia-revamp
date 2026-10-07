import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';
import PortalCard from '../components/portal/PortalCard.jsx';
import { roleConfig } from '../config/roles.js';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';
import '../entryTheme.css';

export default function PortalSelection() {
  const { theme } = useAdminPreferences();
  return (
    <main className="app-shell portal-page entry-theme" data-admin-theme={theme}>
      <div className="container">
        <header className="topbar">
          <Link href="/" aria-label="EVEXIA home" data-testid="link-home">
            <BrandMark />
          </Link>
          <span className="topbar__meta">Life sciences / secure access</span>
        </header>
        <section className="portal-hero" aria-labelledby="welcome-heading">
          <div className="eyebrow">One trusted gateway</div>
          <h1 id="welcome-heading">Welcome to <em>EVEXIA.</em></h1>
          <p data-testid="text-portal-intro">
            Select your portal to continue. Every EVEXIA experience starts with a simple, secure point of entry.
          </p>
        </section>
        <section className="portal-grid" aria-label="Choose your EVEXIA portal">
          <PortalCard role={roleConfig.admin} />
          <PortalCard role={roleConfig.mr} />
          <PortalCard role={roleConfig.doctor} />
        </section>
        <footer className="portal-footer">
          <span>EVEXIA Life Sciences</span>
          <span>Access is limited to authorised users</span>
        </footer>
      </div>
    </main>
  );
}