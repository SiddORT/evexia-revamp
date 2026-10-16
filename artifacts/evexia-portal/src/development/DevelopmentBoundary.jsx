import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { gateEnabled, releaseSnapshot, releaseSubscribe, retryRelease, invalidateRelease } from './releaseState.js';
import { failureGuidance } from './failureGuidance.js';
import './development.css';

export default function DevelopmentBoundary({ children }) {
  const state = useSyncExternalStore(releaseSubscribe, releaseSnapshot, releaseSnapshot);
  const mounted = useRef(false);
  const statusRef = useRef(null);
  const ready = state.status === 'ready';
  const failure = failureGuidance(state.reason);
  if (ready) mounted.current = true;
  useLayoutEffect(() => {
    if (!gateEnabled || ready) return;
    // Radix/search controls can portal outside the application wrapper.
    // Keep those DOM nodes (and their draft state), but isolate every normal
    // body subtree, not just the hidden React root.
    const originals = new Map();
    const isolate = () => {
      for (const element of document.body.children) {
        if (element.classList.contains('development-block') || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue;
        if (!originals.has(element)) originals.set(element, { inert: element.inert, hidden: element.hidden });
        element.inert = true;
        element.hidden = true;
      }
    };
    isolate();
    const observer = new MutationObserver(isolate);
    observer.observe(document.body, { childList: true });
    // A mounted modal's focus scope must not trap focus behind recovery.
    const suspendModalFocus = event => event.stopImmediatePropagation();
    document.addEventListener('focusin', suspendModalFocus, true);
    document.addEventListener('focusout', suspendModalFocus, true);
    document.documentElement.classList.add('development-incompatible');
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', suspendModalFocus, true);
      document.removeEventListener('focusout', suspendModalFocus, true);
      document.documentElement.classList.remove('development-incompatible');
      for (const [element, original] of originals) {
        element.inert = original.inert;
        element.hidden = original.hidden;
      }
    };
  }, [ready]);
  useEffect(() => {
    if (!gateEnabled) return;
    void retryRelease();
    // Loss of focus does not discard drafts. Returning requires a fresh probe.
    const recheck = () => { if (!document.hidden && releaseSnapshot().status === 'ready') void retryRelease(); };
    const interval = setInterval(() => {
      if (releaseSnapshot().status === 'ready') void retryRelease();
    }, 15000);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('offline', invalidateRelease);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('offline', invalidateRelease);
    };
  }, []);
  useEffect(() => { if (!ready) statusRef.current?.focus(); }, [ready]);
  if (!gateEnabled) return children;
  return <>
    <div hidden={!ready} inert={!ready ? true : undefined} data-testid="development-content">
      {mounted.current ? children : null}
    </div>
    {!ready && createPortal(<main className="development-block" tabIndex={-1} ref={statusRef}>
      <section aria-labelledby="development-title">
        <p>EVEXIA · Development preview</p>
        <h1 id="development-title">Development setup pending</h1>
        <p role="status" aria-live="polite">{state.status === 'checking'
          ? 'Checking the running API and preview connection…'
          : 'Compatibility could not be verified. Normal application interaction is blocked.'}</p>
        {state.status !== 'checking' && state.reason && <>
          <p>Check: {state.reason.replaceAll('_', ' ')}</p>
          <p><strong>{failure.title}</strong><br />{failure.action}</p>
        </>}
        {state.reason === 'frontend_reload_required' && <p>This frontend update needs a new page.
          Keep this tab to retain its drafts and <a href={import.meta.env.BASE_URL} target="_blank" rel="noreferrer">open a separate preview tab</a>.</p>}
        <p>Preview origin: <code>{window.location.origin}</code></p>
        <p>Both this preview’s candidate and running API must pass. A successful preflight report alone does not enable access.</p>
        <p>Already-open drafts are kept in this tab. Do not reload or close it to recover.</p>
        <button disabled={state.status === 'checking'} onClick={() => void retryRelease()}>
          {state.status === 'checking' ? 'Checking compatibility…' : 'Retry compatibility check'}
        </button>
        <p><a href="/api/v1/health" target="_blank" rel="noreferrer">Open API health</a> · <a href="/api/v1/development/compatibility" target="_blank" rel="noreferrer">Open compatibility status</a></p>
      </section>
    </main>, document.body)}
  </>;
}
