import { useEffect, useRef } from 'react';
import { purchaseOrderRequest } from '../auth/adminSession.js';

const EVENT = 'evexia:saved-order-change';
const CHANNEL = 'evexia-order-refresh';

function announce(kind) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
  if (typeof window.BroadcastChannel === 'function') {
    const channel = new window.BroadcastChannel(CHANNEL);
    channel.postMessage(kind); // Type only: no identity, reason or order data.
    channel.close();
  }
}

export async function orderRequest(path, options, resource) {
  const result = await purchaseOrderRequest(path, options, resource);
  if (options?.body !== undefined && (path === '' || /\/(?:edit|approve|reject|resubmit)$/.test(path))) {
    try { announce(resource); }
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
