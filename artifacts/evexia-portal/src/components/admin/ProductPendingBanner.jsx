import { useCallback, useEffect, useState } from 'react';
import { forgetProduct, pendingProduct, reconcileKey } from '../../services/productMaster.js';

/** Surfaces an unresolved product/assembly retry identity and reconciles it explicitly. */
export default function ProductPendingBanner({ onResolved, refreshSignal }) {
  const [key, setKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const read = useCallback(() => { try { setKey(pendingProduct()?.key || null); } catch (e) { setMessage(e.message); } }, []);
  useEffect(() => {
    read();
    window.addEventListener('storage', read);
    window.addEventListener('evexia-product-pending', read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('evexia-product-pending', read);
    };
  }, [read, refreshSignal]);
  async function check() {
    setBusy(true); setMessage('');
    try {
      const r = await reconcileKey(key);
      setKey(null);
      setMessage(r.state === 'committed' ? 'The earlier save was committed.' : 'The earlier save was not committed and is now closed. Your draft is preserved.');
      onResolved?.(r);
    } catch (e) { setMessage(e.message || 'The earlier save outcome could not be checked.'); }
    finally { setBusy(false); }
  }
  if (!key && !message) return null;
  return <div className={`admin-feedback${key ? ' admin-feedback--error' : ''} inv-banner`} role={key ? 'alert' : 'status'} data-testid="banner-product-pending">
    <p>{key ? 'A previous product save has an unchecked outcome. New saves are blocked until it is checked.' : ''} {message}</p>
    {key && <button type="button" className="admin-button" disabled={busy} onClick={check} data-testid="button-check-product-outcome">{busy ? 'Checking…' : 'Check save outcome'}</button>}
  </div>;
}
export { forgetProduct };
