import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { continueNavigation, setNavigationGuard } from './navigationGuard.js';
import { usePlatformConfirm } from '../components/PlatformConfirmation.jsx';

export default function useConfirmedNavigation(state, message, onAccepted) {
  const [, navigate] = useLocation();
  const confirm = usePlatformConfirm();
  const latest = useRef();
  latest.current = { state, message, navigate, onAccepted };
  const readState = () => typeof latest.current.state === 'function' ? latest.current.state() : latest.current.state;
  const pending = useRef(false);
  useEffect(() => {
    let mounted = true;
    const release = setNavigationGuard((request) => {
      const state = readState();
      const { message } = latest.current;
      if (pending.current || state.busy || state.blocked) return true;
      if (!state.dirty && !state.uncertain) return false;
      pending.current = true;
      void (async () => {
        try {
          if (!await confirm(typeof message === 'function' ? message(state) : message, { title: 'Leave this draft?', actionLabel: state.uncertain ? 'Leave and keep recovery' : 'Discard and leave' })) return;
          if (!mounted || readState().busy || readState().blocked) return;
          latest.current.onAccepted?.();
          continueNavigation(request, latest.current.navigate);
        } finally { pending.current = false; }
      })();
      return true;
    });
    return () => { mounted = false; release(); };
  }, [confirm]);
}
