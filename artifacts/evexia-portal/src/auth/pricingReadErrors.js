// Read-only pricing failures. Never use these messages to classify a save:
// an unconfirmed mutation must keep its original frozen-submission safeguards.
export function pricingReadMessage(path, { status = 0, reason, code, fields } = {}) {
  const generating = path === '/combinations/generate';
  const label = generating ? 'Eligible pricing scope'
    : path.startsWith('/combinations/allergens') ? 'Allergen choices'
      : path === '/combinations/categories' ? 'Category choices' : 'Saved pricing history or rules';
  const retry = generating ? 'Retry scope loading; your draft and intended scope are retained.'
    : 'Retry loading; your selections and draft are retained.';
  if (status === 401) return 'Your session changed. Your draft is retained; sign in again before retrying.';
  if (status === 403) return 'Pricing Rules require the protected Super Admin.';
  if ([404, 405].includes(status)) {
    return `${label} could not be loaded from this API route. Ask an operator to check that the portal and running API versions match. Your draft is retained.`;
  }
  if (reason === 'response') {
    return `${label} returned an incompatible or invalid response. No rule count or empty catalogue was assumed. Ask an operator to check the API contract, then retry loading. Your draft is retained.`;
  }
  if (status === 429) return `${label} loading is temporarily rate-limited. Wait before retrying. Your draft is retained.`;
  if (code === 'combination_unreadable') {
    return 'Saved pricing evidence could not be read. Ask an operator to restore access to the saved history, then retry scope loading. No replacement prices were assumed; your draft is retained.';
  }
  if (status >= 500 || reason === 'service') {
    return `${label} is unavailable from the service. ${retry} If this continues, ask an operator to inspect service readiness; no activation or migration is assumed.`;
  }
  if (code === 'combination_bound') {
    return generating
      ? 'This complete scope exceeds the atomic limits: 500 active categories, 500 eligible catalogue members and 1,000 rules per request. Use a single category with a smaller subset. Nothing was truncated or saved partially.'
      : `${label} exceeds a supported request limit. Your draft is retained.`;
  }
  if (['combination_eligibility', 'combination_members', 'combination_stale'].includes(code)) {
    return 'The selected category or allergens are no longer eligible for this scope. Review current active masters and the selection, then retry loading. Your draft is retained.';
  }
  if (status === 422) {
    // Only server-owned validation locations/codes are considered, never values
    // or arbitrary response text. Older APIs may reject the newer scope field.
    const incompatible = generating && Array.isArray(fields) && fields.some((f) =>
      f?.field === 'body.categoryScope' && f.code === 'extra_forbidden');
    if (incompatible) return 'This API version does not accept the complete-category scope contract. Ask an operator to align the portal and API versions. Your draft is retained.';
    return generating
      ? 'The API rejected the pricing scope. Review the category, dosage, rule size and selected allergens, then retry. Loading does not require an MRP or effective date. If these choices are valid, ask an operator to check API compatibility. Your draft is retained.'
      : `${label} request is invalid. Review the category and search or paging choices, then retry loading. Your draft is retained.`;
  }
  if (status >= 400) return `${label} request was rejected. ${retry} If it persists, ask an operator to inspect the request.`;
  return `${label} loading did not complete. Check your connection and retry. Your draft and intended scope are retained.`;
}
