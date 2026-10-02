import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';
import LoginForm from '../components/auth/LoginForm.jsx';

export default function AuthPage({ role }) {
  return (
    <main className="auth-page app-shell">
      <section className="auth-visual" aria-label={`${role.title} introduction`}>
        <img src={role.image} alt="" />
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
          <Link href="/" aria-label="EVEXIA home" data-testid="link-form-home"><BrandMark /></Link>
          <h1 data-testid="text-login-title">{role.title}</h1>
          <p className="auth-form-wrap__intro">{role.intro}</p>
          <LoginForm role={role} />
          {role.short === 'ADMIN' && (
            <Link href="/admin" className="auth-preview-link" data-testid="link-preview-admin">
              Open Admin workspace <span aria-hidden="true">→</span>
            </Link>
          )}
          <Link href="/" className="auth-back" data-testid="link-back-portals">
            <ArrowLeft size={15} aria-hidden="true" /> Choose a different portal
          </Link>
          <p className="auth-legal">{role.short === 'ADMIN' ? 'Admin access requires a verified system account. Remember me keeps a bounded session cookie; otherwise the cookie lasts for this browser session. ' : 'This portal is a mock preview: no account is checked or credentials sent. Do not enter a real password. '}Master records remain fictional and browser-local, not secured backend records. Do not enter real patient, staff, or vendor data. Browser data may be lost when cleared.</p>
        </div>
      </section>
    </main>
  );
}