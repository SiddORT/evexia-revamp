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
          <Link href="/" aria-label="Return to EVEXIA portal selection" data-testid="link-auth-home">
            <BrandMark light />
          </Link>
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
          <Link href="/" className="auth-back" data-testid="link-back-portals">
            <ArrowLeft size={15} aria-hidden="true" /> Choose a different portal
          </Link>
          <p className="auth-legal">By continuing, you acknowledge that this preview contains no connected authentication or account storage.</p>
        </div>
      </section>
    </main>
  );
}