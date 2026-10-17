import { useState } from 'react';
import { forgetPR, reconcilePR } from '../../services/serverPurchaseReceived.js';

export default function ReceiptRetryRecovery({ pending, error, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error || '');
  async function check() {
    if (busy || !pending) return;
    setBusy(true);
    try {
      const result = await reconcilePR(pending.key);
      await forgetPR(pending.key);
      onResolved(result.receipt, result.state);
    } catch (cause) { setMessage(cause.message); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel po-recovery" role="alert"><h2>Check the previous receipt save</h2>
    <p>{message || 'A previous request has no confirmed outcome in this browser. Changes are locked until its server result is checked. Sensitive drafts are not stored in browser retry data.'}</p>
    {pending && <button type="button" className="admin-button" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check save outcome'}</button>}
  </section>;
}
