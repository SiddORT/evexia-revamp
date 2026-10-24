import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import ImmDialog from './ImmDialog.jsx';
import { getSession, subscribeSession } from '../../auth/adminSession.js';

const IMAGE = /^image\/(jpeg|png|webp)$/;
const kindOf = (blob, file) => {
  const t = (blob?.type || file.type || '').toLowerCase();
  return t === 'application/pdf' ? 'pdf' : IMAGE.test(t) ? 'image' : '';
};

// Read-only, admin-only viewer. The file is fetched through the authenticated
// allowlisted Blob loader; the temporary object URL is revoked on close/unmount.
export default function PrescriptionViewer({ file, load, download, onClose, allowed = true }) {
  const [state, setState] = useState({ phase: 'loading', url: '', kind: '', status: 0 });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef('');
  const [downloadState, setDownloadState] = useState({ busy: false, error: '' });
  const mounted = useRef(true);
  const owner = useRef(getSession().user?.id);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner.current) closeRef.current();
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    if (!allowed || file.restricted) {
      setState({ phase: 'restricted', url: '', kind: '', status: 403 });
      return () => controller.abort();
    }
    setState({ phase: 'loading', url: '', kind: '', status: 0 });
    Promise.resolve().then(() => load(file, controller.signal)).then((blob) => {
      const kind = kindOf(blob, file);
      if (!live) return;
      if (!kind) { setState({ phase: 'unsupported', url: '', kind: '', status: 0 }); return; }
      urlRef.current = URL.createObjectURL(blob);
      setState({ phase: 'ready', url: urlRef.current, kind, status: 0 });
    }).catch((cause) => { if (live) setState({ phase: cause?.status === 403 ? 'restricted' : 'error', url: '', kind: '', status: cause?.status || 0 }); });
    return () => { live = false; controller.abort(); if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; } };
  }, [file.id, attempt, allowed, file.restricted]);
  async function fallbackDownload() {
    if (downloadState.busy) return;
    setDownloadState({ busy: true, error: '' });
    try { await download(file); }
    catch { if (mounted.current) setDownloadState({ busy: false, error: 'Download could not be completed. Check your access and try again.' }); return; }
    if (mounted.current) setDownloadState({ busy: false, error: '' });
  }
  const fallback = <button type="button" className="admin-button admin-button--secondary" disabled={downloadState.busy || !allowed || file.restricted} onClick={fallbackDownload}><Download size={15} aria-hidden="true" />{downloadState.busy ? 'Downloading…' : 'Download instead'}</button>;
  return <ImmDialog title={file.name || 'Prescription'} eyebrow="Prescription viewer" className="imm-dialog--viewer" onClose={onClose} testId="dialog-imm-prescription-viewer"
    description="Read-only view of a private, verified prescription. Closing does not remove or replace the file.">
    <div className="imm-viewer" aria-busy={state.phase === 'loading'}>
      {state.phase === 'loading' && <div className="imm-viewer__skeleton" role="status">Loading prescription…</div>}
      {state.phase === 'ready' && state.kind === 'pdf' && <iframe className="imm-viewer__frame" title={`Prescription ${file.name || ''}`} src={state.url} sandbox="" referrerPolicy="no-referrer" tabIndex={0} />}
      {state.phase === 'ready' && state.kind === 'image' && <img className="imm-viewer__image" alt={`Prescription ${file.name || ''}`} src={state.url} onError={() => setState((current) => ({ ...current, phase: 'error' }))} />}
      {state.phase === 'restricted' && <p role="alert">Viewing is restricted. Ask an administrator to review attachment access.</p>}
      {state.phase === 'unsupported' && <p role="alert">This file type cannot be previewed. Use Download instead.</p>}
      {state.phase === 'error' && <p role="alert">{state.status === 401 ? 'Sign-in required. Check your session, then retry.' : 'The prescription could not be loaded.'}</p>}
    </div>
    {state.kind === 'pdf' && <p className="imm-hint">If your browser blocks its isolated PDF viewer, use Download instead. Scripts, forms and navigation are disabled in this view.</p>}
    {downloadState.error && <p role="alert" className="imm-error">{downloadState.error}</p>}
    <div className="admin-dialog__actions">
      {['error', 'restricted'].includes(state.phase) && <button type="button" className="admin-button" disabled={!allowed || file.restricted} onClick={() => setAttempt((n) => n + 1)}>Retry viewing</button>}
      {fallback}
      <button type="button" className="admin-button admin-button--secondary" onClick={onClose}>Close viewer</button>
    </div>
  </ImmDialog>;
}
