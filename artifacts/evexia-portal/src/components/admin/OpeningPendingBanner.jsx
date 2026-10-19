import { useCallback, useEffect, useState } from 'react';
import { pendingOpening, reconcileKey } from '../../services/openingStock.js';

/** Surfaces an unresolved opening stock request identity and reconciles it explicitly. */
export default function OpeningPendingBanner({ onResolved, refreshSignal }) {
  const [key, setKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const read = useCallback(() => { try { setKey(pendingOpening()?.key || null); } catch (e) { setMessage(e.message); } }, []);
  useEffect(() => {
    read();
    window.addEventListener('storage', read);
    window.addEventListener('evexia-opening-pending', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('evexia-opening-pending', read); };
  }, [read, refreshSignal]);
  async function check() {
    setBusy(true); setMessage('');
    try {
      const r = await reconcileKey(key);
      setKey(null);
      setMessage(r.state === 'committed' ? 'The earlier opening stock save was committed.' : 'The earlier save was not committed and is now closed. Your draft is preserved.');
      onResolved?.(r);
    } catch (e) { setMessage(e.message || 'The earlier save outcome could not be checked.'); }
    finally { setBusy(false); }
  }
  if (!key && !message) return null;
  return <div className={`admin-feedback${key ? ' admin-feedback--error' : ''} inv-banner`} role={key ? 'alert' : 'status'} data-testid="banner-opening-pending">
    <p>{key ? 'An earlier opening stock save has an unknown outcome. New saves are blocked until it is checked.' : message}</p>
    {key && message && <p>{message}</p>}
    {key && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={check} data-testid="button-check-opening-outcome">{busy ? 'Checking…' : 'Check save outcome'}</button>}
  </div>;
}
