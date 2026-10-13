const AUTH_URL = '/api/v1/auth';

export function recoveryToken(fragment) {
  const values = new URLSearchParams(fragment.replace(/^#/, '')).getAll('token');
  return values.length === 1 && values[0].length <= 2048 ? values[0] : '';
}

export function validateReset(password, confirmation) {
  if (password.length < 12 || password.length > 128) return 'Use a password between 12 and 128 characters.';
  if (password !== confirmation) return 'The passwords do not match.';
  return '';
}

async function send(path, body) {
  let response;
  try {
    response = await fetch(`${AUTH_URL}/${path}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Unable to reach password recovery. Please try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = path === 'reset-password' && response.status === 400
      && data?.detail === 'Choose a password different from your current password.'
      ? data.detail
      : response.status === 429 ? 'Too many attempts. Try again later.'
      : response.status === 503 ? 'Password recovery is unavailable. Contact your administrator.'
        : path === 'reset-password' ? 'This recovery link is invalid, expired or already used. Request a new link.'
          : 'Unable to request password recovery. Please try again.';
    throw new Error(message);
  }
  if (!data || typeof data.message !== 'string'
      || (path === 'reset-password' && !['admin', 'mr'].includes(data.identity_kind))) {
    throw new Error('Password recovery returned an unexpected response. Please try again.');
  }
  return data;
}

export const requestRecovery = (identifier, identityKind) =>
  send('forgot-password', { identifier: identifier.trim(), identity_kind: identityKind });
export const resetPassword = (token, newPassword) =>
  send('reset-password', { token, new_password: newPassword });
