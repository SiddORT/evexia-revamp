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
              Preview Admin workspace <span aria-hidden="true">→</span>
            </Link>
          )}
          <Link href="/" className="auth-back" data-testid="link-back-portals">
            <ArrowLeft size={15} aria-hidden="true" /> Choose a different portal
          </Link>
          <p className="auth-legal">Demo only: no account is checked and Admin pages are public. Do not enter a real password or any patient, staff, or vendor data. Records in this preview stay in this browser, without access control, and may be lost when browser data is cleared.</p>
        </div>
      </section>
    </main>
  );
}