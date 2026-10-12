// Preview access cookies belong only to the exact HTTPS development origin.
// No suffix-wide Replit trust and no application Authorization header.
export function resolverCredentials(origin, { development = false, previewHostname = '' } = {}) {
  try {
    const url = new URL(origin);
    return development && previewHostname.endsWith('.replit.dev') &&
      url.protocol === 'https:' && url.hostname === previewHostname &&
      !url.port && !url.username && !url.password
      ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}

export async function resolvePortalHostname({ origin, hostname, signal, development, previewHostname, fetchRequest = fetch }) {
  const url = new URL('/api/v1/portal/resolve', origin);
  url.searchParams.set('hostname', hostname);
  const response = await fetchRequest(url, {
    credentials: resolverCredentials(origin, { development, previewHostname }),
    mode: 'same-origin', redirect: 'error', cache: 'no-store', signal,
  });
  // Login/access-gate redirects are failures, not portal selection.
  if (response.status !== 200 || response.redirected ||
      !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Portal lookup failed');
  const data = await response.json();
  if (!data || !Object.hasOwn(data, 'role') ||
      ![null, 'admin', 'mr', 'doctor'].includes(data.role)) throw new Error('Invalid portal response');
  return data.role;
}
