// Only known status/code values affect UI wording. Never echo provider internals.
export function postalFailure(error) {
  const retained = ' Your draft is retained.';
  if (error?.status === 401) return { retryable: false,
    message: 'PIN lookup needs a verified session. Sign in or restore your session before retrying.' + retained };
  if (error?.status === 403) return { retryable: false,
    message: 'You do not have permission to look up a PIN for this action. Ask an administrator to check your access.' + retained };
  if (error?.status === 429) return { retryable: true,
    message: (error?.code === 'mr_pin_busy' ? 'PIN lookup is busy. Retry later or select from the geography catalogue.'
      : 'PIN lookup limit reached. Wait before retrying or select from the geography catalogue.') + retained };
  if (error?.status === 422) return { retryable: false,
    message: 'PIN lookup was rejected. Check the six-digit Indian PIN and selected action.' + retained };
  return { retryable: true, message: (error?.code === 'mr_pin_unavailable'
    ? 'Postal provider is unavailable. Retry later or select from the geography catalogue.'
    : 'PIN lookup could not be completed. Check your connection and retry, or select from the geography catalogue.') + retained };
}
