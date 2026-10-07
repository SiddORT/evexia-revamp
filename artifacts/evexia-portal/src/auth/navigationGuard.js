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

// Register before the router's first subscription, not from a dirty page's
// effect: a router notification can otherwise unmount that page and remove its
// later listener before it sees the traversal. The callback itself is scoped
// to the mounted dirty editor through setNavigationGuard.
export function installHistoryGuard(browser) {
  const onPop = (event) => {
    if (!guard || !guardedHref) return;
    const target = hrefOf(browser);
    const restore = guardedHref;
    if (!interceptNavigation({ kind: 'raw', href: target })) return;
    event.stopImmediatePropagation();
    browser.history.pushState(null, '', restore);
  };
  browser.addEventListener('popstate', onPop, true);
  return () => browser.removeEventListener('popstate', onPop, true);
}
if (browserDefault()) installHistoryGuard(browserDefault());
