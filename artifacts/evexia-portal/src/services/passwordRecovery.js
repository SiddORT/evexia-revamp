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
    const message = path === 'set-password' && response.status === 400
      ? 'This invitation link is invalid, expired or already used. Ask your administrator for a new invitation.'
      : path === 'reset-password' && response.status === 400
      && (data?.error?.message ?? data?.detail) === 'Choose a password different from your current password.'
      ? 'Choose a password different from your current password.'
      : response.status === 429 ? 'Too many attempts. Try again later.'
      : response.status === 503 ? 'Password recovery is temporarily unavailable. Try again later or contact your administrator.'
      : response.status >= 500 ? 'Password recovery could not complete. Please try again later.'
        : path === 'reset-password' ? 'This recovery link is invalid, expired or already used. Request a new link.'
          : 'Unable to request password recovery. Please try again.';
    throw new Error(message);
  }
  if (!data || typeof data.message !== 'string'
      || (['reset-password', 'set-password'].includes(path) && !['admin', 'mr'].includes(data.identity_kind))) {
    throw new Error('Password recovery returned an unexpected response. Please try again.');
  }
  return data;
}

export const requestRecovery = (identifier, identityKind) =>
  send('forgot-password', { identifier: identifier.trim(), identity_kind: identityKind });
export const resetPassword = (token, newPassword) =>
  send('reset-password', { token, new_password: newPassword });
export const setInvitedPassword = (token, newPassword) =>
  send('set-password', { token, new_password: newPassword });
