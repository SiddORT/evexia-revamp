import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import useConfirmedNavigation from '../auth/useConfirmedNavigation.js';
import { interceptNavigation } from '../auth/navigationGuard.js';

/** Keep mounted drafts on cancelled navigation and use the shared platform popup. */
export default function useProductDraftNavigation({ dirty, busy, uncertain }) {
  const [, navigate] = useLocation();
  const state = useRef();
  state.current = { dirty, busy, uncertain };
  useConfirmedNavigation(() => state.current, (s) => s.uncertain
    ? 'Leave this draft? Its unchecked save identity will be kept for recovery, but unsaved fields will be discarded.'
    : 'Discard unsaved product or assembly changes and leave this page?');
  useEffect(() => {
    const unload = (event) => {
      if (!state.current.dirty && !state.current.busy && !state.current.uncertain) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  return (href) => { if (!interceptNavigation({ kind: 'route', href })) navigate(href); };
}
