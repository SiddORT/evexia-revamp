// Single in-memory navigation guard. A page with unsaved work registers a
// handler; shared navigation entry points (profile menu, sign out) ask it first.
let guard = null;
let guardedHref = null;
const browserDefault = () => typeof window === 'undefined' ? null : window;
const hrefOf = (browser) => `${browser.location.pathname}${browser.location.search}${browser.location.hash}`;
export function setNavigationGuard(fn, browser = browserDefault()) {
  guard = fn;
  guardedHref = browser ? hrefOf(browser) : null;
  return () => { if (guard === fn) { guard = null; guardedHref = null; } };
}
// Returns true when the guard took over the request (caller must not proceed).
export function interceptNavigation(request) {
  return guard ? guard(request) === true : false;
}

export function continueNavigation(request, navigate) {
  if (request.kind === 'run') return request.run();
  if (request.kind !== 'raw') return navigate(request.href);
  const url = new URL(request.href, window.location.href);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (url.origin === window.location.origin && (!base || url.pathname === base || url.pathname.startsWith(`${base}/`))) {
    return navigate(`${url.pathname.slice(base.length) || '/'}${url.search}${url.hash}`);
  }
  window.location.assign(url.href);
}

// Register before the router's first subscription, not from a dirty page's
// effect: a router notification can otherwise unmount that page and remove its
// later listener before it sees the traversal. The callback itself is scoped
// to the mounted dirty editor through setNavigationGuard.
export function installHistoryGuard(browser) {
  const history = browser.history;
  const positionKey = '__evexiaNavigationPosition';
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  let position = Number.isInteger(history.state?.[positionKey]) ? history.state[positionKey] : 0;
  let restoring = null;
  let accepted = null;
  let afterRestore = null;
  const tagged = (state, index) => ({ ...(state || {}), [positionKey]: index });
  originalReplace.call(history, tagged(history.state, position), '', browser.location.href);
  const push = function (state, unused, url) {
    const next = position + 1;
    const result = originalPush.call(history, tagged(state, next), unused, url);
    position = next;
    if (guard) guardedHref = hrefOf(browser);
    return result;
  };
  const replace = function (state, unused, url) {
    const result = originalReplace.call(history, tagged(state, position), unused, url);
    if (guard) guardedHref = hrefOf(browser);
    return result;
  };
  history.pushState = push;
  history.replaceState = replace;
  const onPop = (event) => {
    const targetPosition = history.state?.[positionKey];
    if (restoring !== null && targetPosition === restoring) {
      restoring = null;
      event.stopImmediatePropagation();
      const action = afterRestore; afterRestore = null; action?.();
      return;
    }
    if (accepted !== null && targetPosition === accepted) {
      accepted = null; position = targetPosition;
      if (guard) guardedHref = hrefOf(browser);
      return;
    }
    if (!guard || !guardedHref) {
      if (Number.isInteger(targetPosition)) position = targetPosition;
      return;
    }
    const target = hrefOf(browser);
    const restore = guardedHref;
    const delta = Number.isInteger(targetPosition) ? targetPosition - position : 0;
    const request = delta ? { kind: 'run', run: () => {
      const resume = () => { accepted = targetPosition; history.go(delta); };
      if (restoring !== null) afterRestore = resume; else resume();
    } } : { kind: 'raw', href: target };
    if (!interceptNavigation(request)) {
      if (Number.isInteger(targetPosition)) position = targetPosition;
      guardedHref = target;
      return;
    }
    event.stopImmediatePropagation();
    if (delta) {
      restoring = position;
      history.go(-delta);
    } else {
      // Entries created before the portal started have no position metadata.
      // Preserve the mounted editor rather than exposing a rejected route.
      originalPush.call(history, tagged(null, position), '', restore);
    }
  };
  browser.addEventListener('popstate', onPop, true);
  return () => {
    browser.removeEventListener('popstate', onPop, true);
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
if (browserDefault()) {
  installHistoryGuard(browserDefault());
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self') || anchor.href === window.location.href || anchor.getAttribute('href')?.startsWith('#')) return;
    if (interceptNavigation({ kind: 'raw', href: anchor.href })) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
}
