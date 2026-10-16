// No auth operations, reloads or retries of application requests in this gate.
export function matchingIdentity(value, expected) {
  return value && expected && Object.keys(value).sort().join() === 'contract,format,schema,source' &&
    value.format === 1 && /^[a-f0-9]{64}$/.test(value.source) &&
    ['format', 'contract', 'schema', 'source'].every(k => value[k] === expected[k]);
}

export async function probeCompatibility(fetcher, expected, base = '/', signal) {
  async function json(url, allow503 = false) {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', signal });
    if ((!response.ok && !(allow503 && response.status === 503)) ||
        !response.headers.get('content-type')?.startsWith('application/json')) throw Error('unavailable');
    return response.json();
  }
  const candidate = await json(`${base.replace(/\/$/, '')}/__development-release`);
  if (candidate?.format !== 1 || Object.keys(candidate).sort().join() !== 'format,identity' || !candidate.identity ||
      !['format', 'contract', 'schema'].every(k => candidate.identity[k] === expected?.[k]) ||
      !matchingIdentity(candidate.identity, candidate.identity)) throw Error('browser_contract_changed');
  const runtime = await json('/api/v1/development/compatibility', true);
  if (runtime?.format !== 1 || Object.keys(runtime).sort().join() !== 'format,identity,ready' ||
      !matchingIdentity(runtime.identity, candidate.identity)) throw Error('incompatible_runtime');
  if (runtime.ready !== true) throw Error('setup_pending');
  return runtime.identity;
}
