import { Children, useEffect, useRef, useState } from 'react';
import { Download, Paperclip } from 'lucide-react';
import './orderFiles.css';

export function orderFileSize(size) {
  if (!Number.isSafeInteger(size) || size < 0) return '';
  return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function OrderFileList({ children, empty = 'No files attached.', label = 'Attached files', ...props }) {
  const rows = Children.toArray(children);
  return rows.length ? <ul className="order-files" aria-label={label} {...props}>{rows}</ul>
    : <p className="order-files-empty">{empty}</p>;
}

// Presentation only: selection, verification, removal and retry stay with callers.
export function OrderFileRow({ name, size, restricted = false, locked = false, status, progressing = false, actions }) {
  const formattedSize = restricted ? '' : orderFileSize(size);
  return <li className="order-file">
    <Paperclip size={17} aria-hidden="true" className="order-file__icon" />
    <div className="order-file__description">
      <strong>{restricted ? 'Restricted attachment' : name || 'Unnamed attachment'}</strong>
      {formattedSize && <span>{formattedSize}</span>}
      {(restricted || status) && <span role={progressing ? 'status' : undefined}>{restricted ? 'Read Attachment permission is required. File details are hidden.' : status}</span>}
      {locked && <span>Locked: saved attachments must be retained.</span>}
    </div>
    {actions && <div className="order-file__actions">{actions}</div>}
  </li>;
}

export function DownloadOrderFile({ file, allowed, download, status, locked = false, actions }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const restricted = !allowed || file.restricted;
  async function start() {
    if (active.current || restricted) return;
    active.current = true; setBusy(true); setError('');
    try { await download(file); }
    catch (cause) {
      if (alive.current) setError(cause?.status === 401 ? 'Download unavailable. Check your sign-in, then retry.'
        : cause?.status === 403 ? 'Download denied. Ask an administrator to review attachment access.'
          : 'Download could not be completed. Retry Download; if it persists, ask an administrator to check the private file.');
    } finally { active.current = false; if (alive.current) setBusy(false); }
  }
  return <OrderFileRow name={file.name} size={file.size} restricted={restricted} locked={locked}
    progressing={busy} status={<>{busy ? 'Downloading…' : status}{error && <span className="order-file__error" role="alert">{error}</span>}</>}
    actions={<>
      <button type="button" className="admin-button admin-button--secondary" disabled={busy || restricted}
        aria-label={restricted ? 'Download restricted attachment' : `Download ${file.name}`} onClick={start}>
        <Download size={15} aria-hidden="true" />{busy ? 'Downloading…' : 'Download'}
      </button>
      {actions}
    </>} />;
}
