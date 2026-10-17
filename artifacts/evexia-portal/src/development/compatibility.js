// Explicit diagnostics only. Never imported by normal application access.
// No auth operations, reloads or retries of application requests.
export function matchingIdentity(value, expected) {
  return value && expected && Object.keys(value).sort().join() === 'contract,format,schema,source' &&
    value.format === 1 && /^[a-f0-9]{64}$/.test(value.source) &&
    ['format', 'contract', 'schema', 'source'].every(k => value[k] === expected[k]);
}

export async function probeCompatibility(fetcher, expected, base = '/', signal) {
  async function json(url, stage, allow503 = false) {
    let response;
    try {
      response = await fetcher(url, {
        // Private preview ingress may require its existing access cookie.
        // Never send credentials cross-origin or follow authentication redirects.
        cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
      });
    } catch {
      throw Error(signal?.aborted ? 'check_timeout' : `${stage}_unreachable`);
    }
    if (response.redirected) throw Error(`${stage}_unreachable`);
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw Error(`${stage}_not_json`);
    }
    if (!response.ok && !(allow503 && response.status === 503)) throw Error(`${stage}_http_error`);
    try {
      return { body: await response.json(), status: response.status };
    } catch {
      throw Error(signal?.aborted ? 'check_timeout' : `${stage}_invalid_json`);
    }
  }
  const { body: candidate } = await json(`${base.replace(/\/$/, '')}/__development-release`, 'candidate');
  if (candidate?.format !== 1 || Object.keys(candidate).sort().join() !== 'format,identity' || !candidate.identity ||
      !['format', 'contract', 'schema'].every(k => candidate.identity[k] === expected?.[k]) ||
      !matchingIdentity(candidate.identity, candidate.identity)) throw Error('browser_contract_changed');
  const { body: runtime, status } = await json('/api/v1/development/compatibility', 'api', true);
  if (runtime?.format !== 1 || Object.keys(runtime).sort().join() !== 'format,identity,ready' ||
      !matchingIdentity(runtime.identity, candidate.identity)) throw Error('incompatible_runtime');
  if (runtime.ready !== true || status !== 200) throw Error('setup_pending');
  return runtime.identity;
}
