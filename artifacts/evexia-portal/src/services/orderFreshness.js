import { useEffect, useRef } from 'react';
import { getSession, purchaseOrderRequest, reportingIdentityGuard } from '../auth/adminSession.js';

const EVENT = 'evexia:saved-order-change';
const CHANNEL = 'evexia-order-refresh';
let confirmEligibility = null;
// Body objects are retained by existing uncertain-outcome editors. Once sent,
// retries must go straight to server idempotent replay, not a new eligibility
// decision that could hide a successful placement. Confirmed payloads remain
// memory-only and are released with their editor/request body; never persisted.
const attempted = new WeakMap();

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
  if (body && attempted.has(body)) return { ...options, body: attempted.get(body) };
  if (!body || typeof body !== 'object'
      || (getSession().user?.identity_kind !== 'mr' && !(resource === 'immunotherapy-orders' && body.refreshQuote))
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
  if (preview.priceQuote) {
    if (!confirmEligibility || !preview.quoteToken) throw eligibilityError('Financial confirmation is unavailable. Keep this draft open and retry.');
    const amount = (value) => value == null ? 'Unavailable' : `₹${value}`;
    const days = preview.doctorDaysLimit == null ? 'Unavailable'
      : `${preview.doctorDaysLimit} days${preview.doctorDaysLimit === 0 ? ' (restriction disabled)' : ''}`;
    const total = preview.priceQuote.totalMinor;
    if (!Number.isSafeInteger(total) || total < 0) throw eligibilityError('The quoted total is unreadable. Your draft is preserved.');
    const orderAmount = `${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`;
    let totalSuborderMrps = null;
    if (preview.priceQuote.policy === 'category_count_total_mrp_v1') {
      const groups = preview.priceQuote.groups;
      if (!Array.isArray(groups) || !groups.length || groups.some((g) =>
        typeof g?.amount !== 'string' || !/^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(g.amount))
        || groups.reduce((sum, g) => sum + BigInt(g.amount.replace('.', '')), 0n) !== BigInt(total)) {
        throw eligibilityError('The Total Suborder MRP headers do not match the quoted total. Your draft is preserved.');
      }
      totalSuborderMrps = groups.map((g) => `₹${g.amount}`).join(' + ');
    }
    const warnings = preview.stockAdvice.filter((advice) => advice.state !== 'healthy');
    const accepted = await confirmEligibility('Review the saved financial facts before confirming. Your draft remains available if you return to the order.', {
      title: 'Immunotherapy financial confirmation',
      actionLabel: body.refreshQuote ? 'Confirm refreshed quote' : 'Confirm & place order',
      cancelLabel: 'Return to order', destructive: false,
      actionDisabled: !preview.eligible,
      financialReview: {
        orderDate: preview.priceQuote.orderDate ?? 'Unavailable',
        totalSuborderMrps,
        doctorPending: amount(preview.doctorPendingBalance),
        doctorDaysLimit: days,
        oldestAge: preview.oldestDoctorUnpaidAgeDays == null
          ? 'Unavailable — no relevant unpaid order established' : `${preview.oldestDoctorUnpaidAgeDays} days`,
        oldestDate: preview.oldestDoctorUnpaidDate ?? 'Unavailable — no relevant unpaid order established',
        outstanding: amount(preview.outstanding),
        orderAmount: `₹${orderAmount}`,
        resultingExposure: amount(preview.resultingOutstanding),
        paymentLimit: `${amount(preview.paymentLimit)}${preview.paymentLimit === '0.00' ? ' (restriction disabled)' : ''}`,
        reasons: [...new Set(preview.reasons.map((reason) => reason.message))],
        stockAdvice: [...new Set(warnings.map((advice) => `${advice.name}: ${advice.message}`))],
        refreshQuote: Boolean(body.refreshQuote),
      },
    });
    if (!preview.eligible) throw eligibilityError(preview.reasons.map((reason) => reason.message).join(' '), preview.reasons[0]?.code);
    if (!accepted) throw eligibilityError('Placement cancelled. Your order details and verified uploads remain available.');
    frozen.quoteToken = preview.quoteToken;
  } else if (!preview.eligible) {
    throw eligibilityError(preview.reasons.map((reason) => reason.message).join(' '), preview.reasons[0]?.code || 'mr_eligibility_unavailable');
  }
  const warnings = preview.stockAdvice.filter((advice) => advice.state !== 'healthy');
  if (warnings.length && !preview.priceQuote) {
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

// Draft submission uses the same MR eligibility/advisory review before its
// atomic endpoint. Retain attempted-body identity across uncertain retries.
export async function prepareOrderPlacement(path, options, resource) {
  const checked = await beforePlacement(path, options, resource);
  attempted.set(options.body, checked.body);
  return checked;
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
      && (path === '' || /\/(?:edit|resubmit)$/.test(path))) attempted.set(options.body, checked.body);
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
