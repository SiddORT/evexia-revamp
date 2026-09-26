import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Field from './Field.jsx';

export default function LoginForm({ role }) {
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
        {isLoading ? <span className="submit-button__loading">Checking access</span> : 'Log in'}
      </button>
    </form>
  );
}