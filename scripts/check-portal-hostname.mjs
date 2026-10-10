import { pathToFileURL } from 'node:url';

// Probe the real same-origin ingress, not Vite's isolated-test proxy or healthz.
// Read-only and unauthenticated: never write mappings or accept failure as null.
export async function checkPortalHostname(base, fetchRequest = fetch, report = console.log) {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('Use an HTTP(S) preview URL without credentials.');
  }
  // Localhost intentionally skips the DB query. Also probe a valid DNS hostname
  // to detect a missing resolver table without exposing or changing any mapping.
  for (const hostname of new Set([origin.hostname, 'portal-smoke-unmapped.allergyevexia.com'])) {
    const url = new URL('/api/v1/portal/resolve', origin);
    url.searchParams.set('hostname', hostname);
    const response = await fetchRequest(url, {
      credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) {
      throw new Error(`Portal resolver returned HTTP ${response.status}; expected 200.`);
    }
    if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Portal resolver did not return JSON (possible SPA fallback or misrouting).');
    }
    const body = await response.json();
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, 'role') || ![null, 'admin', 'mr', 'doctor'].includes(body.role)) {
      throw new Error('Portal resolver returned an invalid response shape; expected only a valid role.');
    }
    if (response.headers.get('cache-control') !== 'no-store') {
      throw new Error('Portal resolver must return Cache-Control: no-store.');
    }
    report(`Portal resolver: HTTP 200 application/json ${JSON.stringify(body)} (same-origin /api, no-store).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] || (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80');
  try {
    await checkPortalHostname(base);
  } catch (error) {
    // Do not emit response bodies, URLs, or underlying network exception details.
    console.error(error.message.startsWith('Portal resolver') || error.message.startsWith('Use an HTTP')
      ? error.message : 'Portal resolver smoke failed: unavailable or malformed JSON. Check intended workflow logs.');
    process.exitCode = 1;
  }
}
