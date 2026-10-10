import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';
import LoginForm from '../components/auth/LoginForm.jsx';
import { usePortalHost, portalEntry } from '../config/portalHost.js';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';
import '../entryTheme.css';

export default function AuthPage({ role }) {
  const { theme } = useAdminPreferences();
  const isAdmin = role.short === 'ADMIN';
  const hostRole = usePortalHost();
  const home = portalEntry(hostRole);
  return (
    <main className={`auth-page app-shell${isAdmin ? ' entry-theme' : ''}`} data-admin-theme={isAdmin ? theme : undefined}>
      <section className="auth-visual" aria-label={`${role.title} introduction`}>
        <img src={`${import.meta.env.BASE_URL}${role.image.replace(/^\//, '')}`} alt="" />
        <div className="auth-visual__overlay">
          <div className="auth-visual__content">
            <div className="eyebrow">EVEXIA / {role.short}</div>
            <h2>{role.visualTitle}</h2>
            <p>{role.visualCopy}</p>
          </div>
          <div className="auth-visual__note">A considered way into your EVEXIA workspace</div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <Link href={home} aria-label={hostRole ? `${role.title} entry` : 'EVEXIA home'} data-testid="link-form-home"><BrandMark /></Link>
          <h1 data-testid="text-login-title">{role.title}</h1>
          <p className="auth-form-wrap__intro">{role.intro}</p>
          <LoginForm role={role} />
          <Link href={home} className="auth-back" data-testid="link-back-portals">
            <ArrowLeft size={15} aria-hidden="true" /> {hostRole ? 'Back to portal entry' : 'Choose a different portal'}
          </Link>
          <p className="auth-legal">{role.short === 'MR' ? 'Sign in with the User ID or email issued by your administrator. Remember me keeps a bounded session cookie; otherwise it lasts for this browser session.' : role.short === 'ADMIN' ? 'Super Admin and explicitly enabled staff can sign in here. Staff use their existing User ID and password. Remember me keeps a bounded session cookie; otherwise it lasts for this browser session.' : 'This portal is a mock preview: no account is checked or credentials sent. Do not enter a real password.'}</p>
        </div>
      </section>
    </main>
  );
}