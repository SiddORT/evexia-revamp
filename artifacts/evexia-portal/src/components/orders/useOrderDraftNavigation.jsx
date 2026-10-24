import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { continueNavigation, setNavigationGuard } from '../../auth/navigationGuard.js';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';

// Values stay in their editor; confirming navigation is the only discard path.
export default function useOrderDraftNavigation({ dirty, pending, onBlocked }) {
  const [, navigate] = useLocation();
  const current = useRef({});
  current.current = { dirty, pending, onBlocked };
  const [leave, setLeave] = useState(null);
  const opener = useRef(null);
  useEffect(() => {
    const release = setNavigationGuard((target) => {
      if (current.current.pending) {
        current.current.onBlocked();
        return true;
      }
      if (!current.current.dirty) return false;
      opener.current = document.activeElement;
      setLeave(target);
      return true;
    });
    const unload = (event) => {
      if (current.current.dirty || current.current.pending) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => { release(); window.removeEventListener('beforeunload', unload); };
  }, []);
  return leave && <ImmDialog title="Discard unsaved order changes?" description="Your saved order will not change. Unsaved entries in this tab will be discarded." returnFocusRef={opener} onClose={() => setLeave(null)}>
    <div className="admin-dialog__actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setLeave(null)}>Keep editing</button>
      <button type="button" className="admin-button" onClick={() => {
        const target = leave; current.current.dirty = false; setLeave(null); continueNavigation(target, navigate);
      }}>Discard changes</button>
    </div>
  </ImmDialog>;
}
