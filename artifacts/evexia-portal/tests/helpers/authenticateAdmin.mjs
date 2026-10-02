const RESERVED_SUPER_ADMIN = 'crm-admin@allergyevexia.in';

/**
 * Sign in a browser page through the real same-origin API and verify its
 * authoritative current identity. The login response's refresh cookie is
 * shared with the page; protected routes still restore via the real API.
 */
export async function authenticateAdmin(page) {
  const base = process.env.EVEXIA_PREVIEW_BASE_URL?.replace(/\/$/, '');
  const password = process.env.EVEXIA_TEST_ADMIN_PASSWORD;
  if (!base) throw new Error('Set EVEXIA_PREVIEW_BASE_URL to the authenticated portal preview URL.');
  if (!password) throw new Error('Set EVEXIA_TEST_ADMIN_PASSWORD to the synthetic isolated-test account password.');

  const origin = new URL(base).origin;
  const login = await page.request.post(`${base}/api/v1/auth/login`, {
    headers: { Origin: origin },
    data: {
      identifier: RESERVED_SUPER_ADMIN,
      password,
      remember_me: false,
    },
  });
  if (!login.ok()) {
    throw new Error(`Synthetic Super Admin login failed with HTTP ${login.status()}. Check isolated API bootstrap and preview proxy setup.`);
  }

  const payload = await login.json().catch(() => null);
  if (typeof payload?.access_token !== 'string') {
    throw new Error('Synthetic Super Admin login returned no access token.');
  }
  const me = await page.request.get(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${payload.access_token}` },
  });
  if (!me.ok()) {
    throw new Error(`Synthetic Super Admin current-identity verification failed with HTTP ${me.status()}.`);
  }
  const identity = await me.json().catch(() => null);
  if (identity?.system_role !== 'super_admin' ||
      !Array.isArray(identity?.permissions) ||
      !identity.permissions.includes('admin.access')) {
    throw new Error('Synthetic test identity is not an authorized Super Admin.');
  }
  return identity;
}