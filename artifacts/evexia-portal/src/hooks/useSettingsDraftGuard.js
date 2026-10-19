import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { continueNavigation, setNavigationGuard } from '../auth/navigationGuard.js';

// Only installed while Settings is mounted. Clean navigation uses the router's
// original history methods unchanged; cancellation keeps the current draft.
export default function useSettingsDraftGuard() {
  const guard = useRef(null);
  const [, navigate] = useLocation();
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  const register = useCallback((next) => { guard.current = next; }, []);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const release = setNavigationGuard((request) => {
      if (!guard.current) return false;
      if (pending) return true;
      pending = true;
      void (async () => {
        try {
          if (!await guard.current() || !mounted) return;
          continueNavigation(request, navigateRef.current);
        } finally { pending = false; }
      })();
      return true;
    });
    return () => {
      mounted = false;
      release();
    };
  }, []);
  return register;
}