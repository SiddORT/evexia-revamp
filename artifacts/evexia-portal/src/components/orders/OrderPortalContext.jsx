import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'wouter';
import AdminLayout from '../admin/AdminLayout.jsx';
import { getSession } from '../../auth/adminSession.js';
import { request } from '../../services/serverImmunotherapy.js';
import { useResourceActions } from '../../auth/useMasterActions.js';

const Context = createContext({ portal: 'admin', mr: null });
export const useOrderPortal = () => useContext(Context);
export const useOrderBase = (kind) => `/${useOrderPortal().portal}/orders/${kind}`;
export function useOrderActions(kind) {
  const { portal } = useOrderPortal();
  const capabilities = useResourceActions(kind);
  if (portal !== 'mr') return { ...capabilities, documents: capabilities.protected };
  // MR routes retain their existing ownership-scoped service authorization.
  // They never inherit staff or protected-administration authority.
  return { ...Object.fromEntries(Object.keys(capabilities).map((action) => [action, action !== 'protected'])), documents: true };
}

// MRWorkspace owns the shell and account-keyed lifetime; do not nest Admin chrome.
export default function OrderPortalLayout(props) {
  const { portal } = useOrderPortal();
  return portal === 'mr' ? props.children : <AdminLayout {...props} />;
}

export function MROrderBoundary({ children }) {
  const [mr, setMr] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const expected = getSession().user?.mr_id;
    setMr(null); setError('');
    request('/references/mrs', { params: { selected: expected }, signal: controller.signal })
      .then((data) => {
        const identity = data.items.find((item) => item.id === expected);
        if (!identity || data.items.some((item) => item.id !== expected)) throw new Error('Your saved MR identity is unavailable. Ask an administrator to review your MR assignment.');
        setMr(identity);
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [revision]);
  if (!mr) return <section className="mrw-card"><h1>{error ? 'MR orders unavailable' : 'Loading your MR identity…'}</h1>
    {error ? <><p role="alert">{error}</p><button type="button" className="admin-button" onClick={() => setRevision((n) => n + 1)}>Retry</button></> : <p role="status">Checking your saved MR assignment.</p>}
    <Link href="/mr/home">Back to dashboard</Link></section>;
  return <Context.Provider value={{ portal: 'mr', mr }}>{children}</Context.Provider>;
}
