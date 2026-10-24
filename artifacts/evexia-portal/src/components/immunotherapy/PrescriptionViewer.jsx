import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import ImmDialog from './ImmDialog.jsx';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import './prescriptionViewer.css';

const IMAGE = /^image\/(jpeg|png|webp)$/;
const kindOf = (blob, file) => {
  const t = (blob?.type || file.type || '').toLowerCase();
  return t === 'application/pdf' ? 'pdf' : IMAGE.test(t) ? 'image' : '';
};

// Read-only viewer. The file is fetched through the authenticated
// allowlisted Blob loader; the temporary object URL is revoked on close/unmount.
export default function PrescriptionViewer({ file, load, download, onClose, allowed = true, documentLabel = 'Prescription', returnFocusRef }) {
  const label = documentLabel.toLowerCase();
  const [state, setState] = useState({ phase: 'loading', url: '', kind: '', status: 0 });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef('');
  const previewRequest = useRef(null);
  const downloadRequest = useRef(null);
  const [downloadState, setDownloadState] = useState({ busy: false, error: '' });
  const mounted = useRef(true);
  const owner = useRef(getSession().user?.id);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  function release() {
    previewRequest.current?.abort();
    downloadRequest.current?.abort();
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
  }
  function close() {
    release();
    closeRef.current();
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner.current) {
        release();
        closeRef.current();
      }
    });
    return () => { mounted.current = false; release(); unsubscribe(); };
  }, []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    previewRequest.current = controller;
    if (!allowed || file.restricted || file.state !== 'verified') {
      setState({ phase: 'restricted', url: '', kind: '', status: 403 });
      return () => controller.abort();
    }
    setState({ phase: 'loading', url: '', kind: '', status: 0 });
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return load(file, controller.signal);
    }).then((blob) => {
      const kind = kindOf(blob, file);
      if (!live || controller.signal.aborted || getSession().user?.id !== owner.current) return;
      if (!blob.size) throw new Error('The private file is empty.');
      if (!kind) { setState({ phase: 'unsupported', url: '', kind: '', status: 0 }); return; }
      urlRef.current = URL.createObjectURL(blob);
      setState({ phase: 'ready', url: urlRef.current, kind, status: 0 });
    }).catch((cause) => { if (live && !controller.signal.aborted) setState({ phase: cause?.status === 403 ? 'restricted' : cause?.code === 'unsupported_file_type' ? 'unsupported' : 'error', url: '', kind: '', status: cause?.status || 0 }); });
    return () => { live = false; release(); };
  }, [file, load, attempt, allowed]);
  async function fallbackDownload() {
    if (downloadRequest.current && !downloadRequest.current.signal.aborted) return;
    if (!allowed || file.restricted || file.state !== 'verified' || getSession().user?.id !== owner.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloadState({ busy: true, error: '' });
    try {
      await download(file, controller.signal);
      if (mounted.current && !controller.signal.aborted) setDownloadState({ busy: false, error: '' });
    } catch {
      if (mounted.current && !controller.signal.aborted) setDownloadState({ busy: false, error: 'Download could not be completed. Check your access and try again.' });
    } finally {
      if (downloadRequest.current === controller) downloadRequest.current = null;
    }
  }
  const restricted = !allowed || file.restricted || file.state !== 'verified';
  const fallback = <button type="button" className="admin-button admin-button--secondary" disabled={downloadState.busy || restricted} onClick={fallbackDownload}><Download size={15} aria-hidden="true" />{downloadState.busy ? 'Downloading…' : 'Download instead'}</button>;
  return <ImmDialog title={restricted ? 'Restricted attachment' : file.name || documentLabel} eyebrow={`${documentLabel} viewer`} className="imm-dialog--viewer" onClose={close} returnFocusRef={returnFocusRef} testId="dialog-imm-prescription-viewer"
    description={`Read-only view of a private, verified ${label}. Closing does not remove or replace the file.`}>
    <div className="imm-viewer" aria-busy={state.phase === 'loading'}>
      {state.phase === 'loading' && <div className="imm-viewer__skeleton" role="status">Loading {label}…</div>}
      {!restricted && state.phase === 'ready' && state.kind === 'pdf' && <iframe className="imm-viewer__frame" title={`${documentLabel} ${file.name || ''}`} src={state.url} sandbox="" referrerPolicy="no-referrer" tabIndex={0} />}
      {!restricted && state.phase === 'ready' && state.kind === 'image' && <img className="imm-viewer__image" alt={`${documentLabel} ${file.name || ''}`} src={state.url} onError={() => setState((current) => ({ ...current, phase: 'error' }))} />}
      {state.phase === 'restricted' && <p role="alert">Viewing is restricted. Ask an administrator to review attachment access.</p>}
      {state.phase === 'unsupported' && <p role="alert">This file type cannot be previewed. Use Download instead.</p>}
      {state.phase === 'error' && <p role="alert">{state.status === 401 ? 'Sign-in required. Check your session, then retry.' : `The ${label} could not be loaded.`}</p>}
    </div>
    {state.kind === 'pdf' && <p className="imm-hint">If your browser blocks its isolated PDF viewer, use Download instead. Scripts, forms and navigation are disabled in this view.</p>}
    {downloadState.error && <p role="alert" className="imm-error">{downloadState.error}</p>}
    <div className="admin-dialog__actions">
      {['error', 'restricted'].includes(state.phase) && <button type="button" className="admin-button" disabled={restricted} onClick={() => { setDownloadState({ busy: false, error: '' }); setAttempt((n) => n + 1); }}>Retry viewing</button>}
      {fallback}
      <button type="button" className="admin-button admin-button--secondary" onClick={close}>Close viewer</button>
    </div>
  </ImmDialog>;
}
