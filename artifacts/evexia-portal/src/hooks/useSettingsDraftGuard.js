import { useCallback, useEffect, useRef } from 'react';

// Only installed while Settings is mounted. Clean navigation uses the router's
// original history methods unchanged; cancellation keeps the current draft.
export default function useSettingsDraftGuard() {
  const guard = useRef(null);
  const register = useCallback((next) => { guard.current = next; }, []);
  useEffect(() => {
    const history = window.history;
    const push = history.pushState;
    const replace = history.replaceState;
    let acceptedUrl = window.location.href;
    let acceptedState = history.state;
    const permitted = (url) => !url || new URL(url, window.location.href).href === acceptedUrl || !guard.current || guard.current();
    const wrap = (original) => function (state, unused, url) {
      if (!permitted(url)) return;
      const result = original.call(history, state, unused, url);
      acceptedUrl = window.location.href;
      acceptedState = history.state;
      return result;
    };
    const guardedPush = wrap(push);
    const guardedReplace = wrap(replace);
    history.pushState = guardedPush;
    history.replaceState = guardedReplace;
    const onPop = (event) => {
      if (window.location.href !== acceptedUrl && guard.current && !guard.current()) {
        event.stopImmediatePropagation();
        // popstate itself cannot be cancelled. Restore the accepted location
        // before the router observes it; never unmount a rejected dirty draft.
        push.call(history, acceptedState, '', acceptedUrl);
      } else {
        acceptedUrl = window.location.href;
        acceptedState = history.state;
      }
    };
    window.addEventListener('popstate', onPop, true);
    return () => {
      window.removeEventListener('popstate', onPop, true);
      if (history.pushState === guardedPush) history.pushState = push;
      if (history.replaceState === guardedReplace) history.replaceState = replace;
    };
  }, []);
  return register;
}