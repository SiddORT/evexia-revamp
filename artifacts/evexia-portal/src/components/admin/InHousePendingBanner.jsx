import { useCallback, useEffect, useState } from 'react';
import { PENDING_EVENT, pendingInHouse, reconcileKey } from '../../services/inHouseStock.js';

/** Surfaces an unresolved in-house stock request identity and reconciles it explicitly. */
export default function InHousePendingBanner({ onResolved, refreshSignal }) {
  const [key, setKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const read = useCallback(() => { try { setKey(pendingInHouse()?.key || null); } catch (e) { setMessage(e.message); } }, []);
  useEffect(() => {
    read();
    window.addEventListener('storage', read);
    window.addEventListener(PENDING_EVENT, read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener(PENDING_EVENT, read); };
  }, [read, refreshSignal]);
  async function check() {
    setBusy(true); setMessage('');
    try {
      const r = await reconcileKey(key);
      setKey(null);
      setMessage(r.state === 'committed' ? 'The earlier in-house stock save was committed.' : 'The earlier save was not committed and is now closed. Your draft is preserved.');
      onResolved?.(r);
    } catch (e) { setMessage(e.message || 'The earlier save outcome could not be checked.'); }
    finally { setBusy(false); }
  }
  if (!key && !message) return null;
  return <div className={`admin-feedback${key ? ' admin-feedback--error' : ''} inv-banner`} role={key ? 'alert' : 'status'} data-testid="banner-in-house-pending">
    <p>{key ? 'An earlier in-house stock save has an unknown outcome. New saves are blocked until it is checked.' : message}</p>
    {key && message && <p>{message}</p>}
    {key && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={check} data-testid="button-check-in-house-outcome">{busy ? 'Checking…' : 'Check save outcome'}</button>}
  </div>;
}
