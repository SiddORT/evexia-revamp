// Fixed messages and bounded diagnostics only: never display response bodies,
// clinical values, URLs, credentials, or arbitrary server exception text.
export function extractSettingsFailure({ mutation = false, reason, status = 0, code, requestId } = {}) {
  const knownCode = new Set([
    'imm_extract_schema', 'imm_extract_configuration', 'imm_extract_storage',
    'imm_extract_stale', 'imm_extract_category', 'directory_crypto_unavailable',
  ]).has(code) ? code : undefined;
  const recovery = mutation
    ? ' Your edits are preserved. Choose “Reload saved” and compare before saving again.'
    : ' No saved values were loaded. Retry loading; no blank defaults have been assumed.';
  const message = reason === 'delivery'
    ? `Extract & Dilution request did not complete; no HTTP response was received.${mutation ? ' The save outcome is unknown.' : ''}`
    : status === 401 ? 'Extract & Dilution requires a valid signed-in session. Sign in or retry session verification.'
    : status === 403 ? 'Extract & Dilution requires the protected Super Admin.'
    : knownCode === 'imm_extract_schema'
      ? 'Extract & Dilution storage schema is unavailable. The operator must align the running API and its required schema.'
    : knownCode === 'imm_extract_configuration'
      ? 'Saved Extract & Dilution settings are unreadable. The operator must investigate storage; do not replace them with blank values.'
    : knownCode === 'directory_crypto_unavailable'
      ? 'Extract & Dilution encryption is unavailable. The operator must check the configured keyring and encryption readiness.'
    : knownCode === 'imm_extract_category'
      ? 'The saved Extract & Dilution category is unavailable. Choose a current saved category.'
    : status === 409 ? 'Extract & Dilution settings changed. Reload the authoritative saved version and compare with your edits.'
    : [404, 405].includes(status)
      ? 'The running API does not provide this Extract & Dilution operation. The operator must align the API with the six-pair dosage-aware contract.'
    : status === 422 ? mutation
      ? 'Extract & Dilution input was rejected. Check the dosage, six ordered Single/Double/Triple pairs and nonnegative ml strings with up to six whole digits and six source decimals. Saves round half-up to two decimal places; positive values must round to at least 0.01 and rounded values must remain within range. Blank stays not recorded, distinct from zero. If these are valid, ask the operator to check API contract compatibility.'
      : 'The API rejected the Extract & Dilution read. Ask the operator to check the running dosage-aware API contract.'
    : status === 429 ? 'Extract & Dilution received too many requests. Wait before reloading.'
    : status >= 500 ? knownCode === 'imm_extract_storage'
      ? 'Extract & Dilution storage failed. Saving has not been confirmed.'
      : 'The Extract & Dilution service returned an HTTP failure. Saving has not been confirmed.'
    : reason === 'response'
      ? 'The API returned an invalid or incompatible Extract & Dilution response; the category, dosage, version and exact values were not confirmed.'
    : 'The Extract & Dilution request was rejected.';
  const safeId = typeof requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ? requestId : undefined;
  const error = new Error(`${message}${recovery}${status ? ` HTTP ${status}.` : ''}${safeId ? ` Reference: ${safeId}.` : ''}`);
  error.status = status;
  error.code = knownCode;
  error.requestId = safeId;
  error.responseReceived = status > 0 || reason === 'response';
  error.failureKind = reason === 'response' && status < 400 ? 'invalid_response' : !status ? 'transport' : 'http';
  error.ambiguous = mutation && (!status || status >= 500 || reason === 'response' && status < 400 || [404, 405].includes(status));
  return error;
}
