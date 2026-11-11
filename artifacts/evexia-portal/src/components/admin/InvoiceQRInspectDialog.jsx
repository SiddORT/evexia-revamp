import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { loadInvoiceQR } from '../../services/serverInvoiceSettings.js';

// Protected editor/history only. Fetched bytes live in component memory only.
export default function InvoiceQRInspectDialog({ version, label, onClose }) {
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);

  async function load() {
    const seq = ++sequence.current;
    setBusy(true); setError(''); setImage(null);
    try {
      const next = await loadInvoiceQR(version);
      if (seq === sequence.current) setImage(next);
    } catch (cause) {
      if (seq === sequence.current) setError(cause?.message || 'The saved QR image could not be loaded.');
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }
  useEffect(() => { load(); return () => { sequence.current++; }; }, [version]);

  return <Dialog title={`Saved QR · version ${version}`} eyebrow="Protected configuration" onClose={onClose}
    description={label || 'Stored payment QR evidence for this configuration version. Not shown in template samples.'}
    footer={<button type="button" className="admin-button admin-button--secondary" data-testid="button-close-qr-inspect" onClick={onClose}>Close</button>}>
    <div className="invd-qr-view" aria-busy={busy}>
      {busy && <div className="invd-skeleton" style={{ width: 240, height: 240 }} aria-label="Loading QR image" />}
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-retry-qr-inspect" onClick={load}>Retry</button></div>}
      {image && <><img src={image.dataUrl} alt={`Saved payment QR, version ${version}`} data-testid={`img-qr-version-${version}`} />
        <p>{image.width} × {image.height} px · {(image.size / 1024).toFixed(1)} KiB</p></>}
    </div>
  </Dialog>;
}
