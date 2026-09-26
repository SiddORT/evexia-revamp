import { useState } from 'react';
import { Link, Route, Switch } from 'wouter';
import { Eye, EyeOff, ArrowLeft, ArrowRight } from 'lucide-react';

const roleConfig = {
  admin: {
    path: '/admin',
    short: 'ADMIN',
    title: 'Admin Portal',
    cardTitle: 'Admin Portal',
    description: 'For administration, operations and management.',
    cta: 'Login as Admin',
    image: '/images/admin-role.jpg',
    intro: 'Secure access for EVEXIA administration, operations and management.',
    visualTitle: 'Keep the whole picture in view.',
    visualCopy: 'A clear, considered workspace for the people who keep EVEXIA moving.',
  },
  mr: {
    path: '/mr',
    short: 'MR',
    title: 'Medical Representative Portal',
    cardTitle: 'Medical Representative Portal',
    description: 'For medical representatives to access their EVEXIA portal.',
    cta: 'Login as MR',
    image: '/images/mr-role.jpg',
    intro: 'Secure access for EVEXIA medical representatives in the field.',
    visualTitle: 'Bring every conversation forward.',
    visualCopy: 'A focused entry point for the teams connecting science with care.',
  },
  doctor: {
    path: '/doctor',
    short: 'DOCTOR',
    title: 'Doctor Portal',
    cardTitle: 'Doctor Portal',
    description: 'For doctors to access their EVEXIA portal.',
    cta: 'Login as Doctor',
    image: '/images/doctor-role.jpg',
    intro: 'Secure access for doctors and healthcare professionals.',
    visualTitle: 'Make room for better care.',
    visualCopy: 'A calm, direct gateway designed around the pace of modern healthcare.',
  },
};

function BrandMark({ light = false }) {
  return (
    <span className={`brand-mark${light ? ' brand-mark--light' : ''}`} data-testid="brand-wordmark">
      <span className="brand-mark__word">EVEXIA</span>
    </span>
  );
}

function PortalCard({ role }) {
  return (
    <Link href={role.path} className="portal-card" data-testid={`link-portal-${role.short.toLowerCase()}`}>
      <div className="portal-card__visual">
        <img src={role.image} alt="" />
        <span className="portal-card__number">{role.short}</span>
      </div>
      <div className="portal-card__body">
        <h2 data-testid={`text-portal-title-${role.short.toLowerCase()}`}>{role.cardTitle}</h2>
        <p>{role.description}</p>
        <span className="portal-card__cta">
          {role.cta}
          <span className="portal-card__arrow" aria-hidden="true"><ArrowRight size={18} /></span>
        </span>
      </div>
    </Link>
  );
}

function PortalSelection() {
  return (
    <main className="app-shell portal-page">
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

function Field({ id, label, type = 'text', value, onChange, error, placeholder, children, autoComplete }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field__input-wrap">
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid={`input-${id}`}
        />
        {children}
      </div>
      {error && <div id={`${id}-error`} className="field__error" role="alert" data-testid={`error-${id}`}>{error}</div>}
    </div>
  );
}

function LoginForm({ role }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');

  function validate() {
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Enter your email or username.';
    if (!password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    if (!validate()) return;
    setIsLoading(true);
    window.setTimeout(() => {
      setIsLoading(false);
      setMessage('Authentication is not connected in this preview. No credentials were sent.');
    }, 900);
  }

  function handleForgot() {
    setMessage('Password recovery is not connected in this preview. Please contact your EVEXIA administrator.');
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate data-testid={`form-login-${role.short.toLowerCase()}`}>
      <Field
        id="email"
        label="Email or username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
        placeholder="you@company.com"
        autoComplete="username"
      />
      <Field
        id="password"
        label="Password"
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        placeholder="Enter your password"
        autoComplete="current-password"
      >
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShowPassword((visible) => !visible)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          data-testid="button-toggle-password"
        >
          {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </Field>
      <div className="form-row">
        <label className="remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            data-testid="checkbox-remember"
          />
          Remember me
        </label>
        <button type="button" className="forgot-button" onClick={handleForgot} data-testid="button-forgot-password">
          Forgot password?
        </button>
      </div>
      {message && <div className="form-message" role="status" data-testid="status-auth-message">{message}</div>}
      <button className="submit-button" type="submit" disabled={isLoading} data-testid="button-submit-login">
        {isLoading ? <span className="submit-button__loading">Checking access</span> : 'Continue securely'}
      </button>
    </form>
  );
}

function AuthPage({ role }) {
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

function NotFound() {
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

export default function App() {
  return (
    <Switch>
      <Route path="/" component={PortalSelection} />
      <Route path="/admin">{() => <AuthPage role={roleConfig.admin} />}</Route>
      <Route path="/mr">{() => <AuthPage role={roleConfig.mr} />}</Route>
      <Route path="/doctor">{() => <AuthPage role={roleConfig.doctor} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}