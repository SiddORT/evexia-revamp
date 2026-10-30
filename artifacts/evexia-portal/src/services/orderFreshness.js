import { useEffect, useRef } from 'react';
import { getSession, purchaseOrderRequest, reportingIdentityGuard } from '../auth/adminSession.js';

const EVENT = 'evexia:saved-order-change';
const CHANNEL = 'evexia-order-refresh';
let confirmEligibility = null;
// Body objects are retained by existing uncertain-outcome editors. Once sent,
// retries must go straight to server idempotent replay, not a new eligibility
// decision that could hide a successful placement. Weak references hold no PII.
const attempted = new WeakSet();

export function registerEligibilityConfirmation(confirm) {
  confirmEligibility = confirm;
  return () => { if (confirmEligibility === confirm) confirmEligibility = null; };
}

function eligibilityError(message, code = 'mr_eligibility_cancelled') {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  error.ambiguous = false; // This preview has not dispatched an order write.
  return error;
}

async function beforePlacement(path, options, resource) {
  const body = options?.body;
  if (!body || typeof body !== 'object' || attempted.has(body)
      || getSession().user?.identity_kind !== 'mr'
      || !['immunotherapy-orders', 'kits-orders', 'spt-orders', 'lupin-orders'].includes(resource)
      || !(path === '' || /^\/[0-9a-f-]{36}\/(?:edit|resubmit)$/i.test(path))) return options;
  const guard = reportingIdentityGuard();
  const serialized = JSON.stringify(body);
  const frozen = JSON.parse(serialized);
  const match = /^\/([0-9a-f-]{36})\/(edit|resubmit)$/i.exec(path);
  const preview = await purchaseOrderRequest('/eligibility', {
    body: { orderId: match?.[1] || null, resubmit: match?.[2] === 'resubmit', values: frozen },
    signal: options.signal,
  }, resource);
  guard();
  if (typeof preview?.eligible !== 'boolean' || !Array.isArray(preview.reasons) || !Array.isArray(preview.stockAdvice)) {
    throw eligibilityError('Eligibility could not be confirmed. Your draft and uploads remain here.', 'mr_eligibility_unavailable');
  }
  if (!preview.eligible) {
    throw eligibilityError(preview.reasons.map((reason) => reason.message).join(' '), preview.reasons[0]?.code || 'mr_eligibility_unavailable');
  }
  const warnings = preview.stockAdvice.filter((advice) => advice.state !== 'healthy');
  if (warnings.length) {
    if (!confirmEligibility) throw eligibilityError('Stock advice is available, but confirmation is not ready. Keep this draft open and retry.');
    const accepted = await confirmEligibility(
      `${warnings.map((advice) => `${advice.name}: ${advice.message}`).join('\n\n')}\n\nThese are advisory warnings, not placement restrictions. Continue placing this unchanged order?`,
      { title: 'Allergen stock advice', actionLabel: 'Continue placing order', cancelLabel: 'Return to order', destructive: false, preserveLines: true },
    );
    if (!accepted) throw eligibilityError('Placement cancelled. Your order details and verified uploads remain available.');
  }
  guard();
  if (JSON.stringify(body) !== serialized) throw eligibilityError('Order details changed during eligibility review. Review this draft again.');
  options.signal?.throwIfAborted();
  return { ...options, body: frozen };
}

export function announceOrderChange(kind) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
  if (typeof window.BroadcastChannel === 'function') {
    const channel = new window.BroadcastChannel(CHANNEL);
    channel.postMessage(kind); // Type only: no identity, reason or order data.
    channel.close();
  }
}

export async function orderRequest(path, options, resource) {
  const checked = await beforePlacement(path, options, resource);
  if (options?.body && typeof options.body === 'object'
      && (path === '' || /\/(?:edit|resubmit)$/.test(path))) attempted.add(options.body);
  const result = await purchaseOrderRequest(path, checked, resource);
  if (options?.body !== undefined && (path === '' || /\/(?:edit|approve|reject|resubmit)$/.test(path))) {
    try { announceOrderChange(resource); }
    catch { console.warn('Live order refresh is unavailable in this browser. Use Refresh saved orders; visible lists also refresh periodically.'); }
  }
  return result;
}

// Lists own authoritative aggregates and restart cursor traversal on refresh.
// No editor subscribes: background refresh must never replace unsaved values.
export function useOrderListFreshness(kind, refresh) {
  const current = useRef(refresh);
  current.current = refresh;
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') current.current(); };
    const local = (event) => { if (event.detail === `${kind}-orders`) update(); };
    const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel(CHANNEL) : null;
    if (channel) channel.onmessage = (event) => { if (event.data === `${kind}-orders`) update(); };
    window.addEventListener(EVENT, local);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 45000);
    return () => {
      channel?.close(); window.clearInterval(timer);
      window.removeEventListener(EVENT, local); window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [kind]);
}
