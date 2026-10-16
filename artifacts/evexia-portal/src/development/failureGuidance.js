// Fixed public categories only: never render exception messages or response bodies.
const failures = {
  candidate_unreachable: ['Preview check could not connect', 'Check this tab’s connection and preview address, then retry. Redirected checks are not accepted.'],
  candidate_not_json: ['Preview check returned a page instead of JSON', 'Check the frontend __development-release route on the preview origin shown below. Compare it with the origin used by pnpm verify:development.'],
  candidate_http_error: ['Preview check returned an unsuccessful status', 'Inspect the managed frontend service and its __development-release response, then retry.'],
  candidate_invalid_json: ['Preview check returned invalid JSON', 'Inspect the managed frontend __development-release response, then retry.'],
  api_unreachable: ['API compatibility check could not connect', 'Check this tab’s connection and the managed API ingress on the origin shown below, then retry. Redirected checks are not accepted.'],
  api_not_json: ['API compatibility check returned a page instead of JSON', 'Inspect /api/v1/development/compatibility on this preview origin. Compare it with pnpm verify:development; a frontend page is not API readiness.'],
  api_http_error: ['API compatibility check returned an unsuccessful status', 'Inspect the compatibility response status and managed API logs, then retry. A candidate preflight alone cannot restore access.'],
  api_invalid_json: ['API compatibility check returned invalid JSON', 'Inspect the managed API compatibility response on this preview origin, then retry.'],
  check_timeout: ['Compatibility check timed out', 'Check the connection and managed service readiness, then retry. Each check is limited to 12 seconds.'],
  browser_contract_changed: ['This tab expects a different frontend contract', 'Keep this tab for its drafts and open a separate preview tab with the current frontend.'],
  incompatible_runtime: ['The running API does not match the preview candidate', 'Compare both identities using pnpm verify:development on this preview origin. Restart the managed API only if it is serving older code, then retry.'],
  setup_pending: ['The running API is not ready', 'Run pnpm check:development and inspect its report. Complete only separately approved setup, then retry after readiness succeeds.'],
  frontend_reload_required: ['This frontend update needs a separate tab', 'Keep this tab open to retain its drafts. Retry cannot convert a mounted draft to a different frontend version.'],
  source_changed: ['Compatibility needs to be checked again', 'The connection or development source changed. Retry to verify both the preview candidate and running API.'],
  unavailable: ['Compatibility could not be verified', 'Check the preview connection and managed service logs, then retry. No application requests will be replayed.'],
};

export const knownFailure = reason => Object.hasOwn(failures, reason);
export const failureGuidance = reason => {
  const [title, action] = failures[knownFailure(reason) ? reason : 'unavailable'];
  return { title, action };
};
