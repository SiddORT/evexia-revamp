import { getSession, subscribeSession } from '../../auth/adminSession.js';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { localBinaryDataFactory } from './pdfAssets.js';

// Both surfaces render only pixels, never a PDF document, annotation layer,
// scripting manager, embedded attachment, HTML string or navigable PDF link.
export function renderPrivateDocument(host, blob, kind, onError = () => {}, label = 'Private document') {
  const doc = host.ownerDocument;
  const resources = new AbortController();
  let disposed = false, loading, pdf, renderTask, imageUrl = '', page = 1, zoom = 1, sequence = 0;
  const node = (tag, text) => {
    const element = doc.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  host.replaceChildren();
  const controls = node('div'); controls.className = 'imm-pdf-controls';
  const status = node('p', 'Loading document…'); status.setAttribute('role', 'status');
  const surface = node('div'); surface.className = 'imm-pdf-surface';
  host.append(controls, status, surface);
  const fail = () => {
    if (disposed) return;
    surface.replaceChildren();
    status.textContent = 'This document could not be rendered. Close and retry, or use Download instead.';
    status.setAttribute('role', 'alert');
    onError();
  };
  const button = (text, action) => {
    const element = node('button', text); element.type = 'button';
    element.addEventListener('click', action); controls.append(element);
    return element;
  };
  let previous, next, smaller, larger;
  const refresh = () => {
    previous.disabled = page <= 1;
    next.disabled = page >= pdf.numPages;
    smaller.disabled = zoom <= .5;
    larger.disabled = zoom >= 2.5;
  };
  async function paint() {
    const current = ++sequence;
    const oldTask = renderTask;
    oldTask?.cancel();
    surface.replaceChildren();
    status.textContent = `Loading page ${page} of ${pdf.numPages}…`;
    refresh();
    let sheet;
    try {
      if (oldTask) await oldTask.promise.catch(() => {});
      if (disposed || current !== sequence) return;
      sheet = await pdf.getPage(page);
      if (disposed || current !== sequence) return;
      const base = sheet.getViewport({ scale: 1 });
      // One page at a time, bounded dimensions and pixel area even for hostile
      // MediaBoxes. Zoom keeps the requested display size within these bounds.
      const scale = Math.min(1.4 * zoom, 4096 / base.width, 4096 / base.height,
        Math.sqrt(8000000 / (base.width * base.height)));
      const viewport = sheet.getViewport({ scale });
      const canvas = node('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${label}, page ${page} of ${pdf.numPages}`);
      canvas.style.width = `${canvas.width}px`;
      surface.append(canvas);
      const { AnnotationMode } = await import('pdfjs-dist/build/pdf.mjs');
      if (disposed || current !== sequence) return;
      const task = sheet.render({
        canvasContext: canvas.getContext('2d'), viewport,
        annotationMode: AnnotationMode.DISABLE,
      });
      renderTask = task;
      await task.promise;
      if (!disposed && current === sequence) status.textContent = `Page ${page} of ${pdf.numPages} — zoom ${Math.round(zoom * 100)}%`;
    } catch (error) {
      if (!disposed && current === sequence && error?.name !== 'RenderingCancelledException') fail();
    } finally { sheet?.cleanup(); }
  }
  if (kind === 'image') {
    const image = node('img'); image.alt = label;
    imageUrl = URL.createObjectURL(blob);
    image.onload = () => { if (!disposed) status.textContent = 'Read-only private image'; };
    image.onerror = fail;
    image.src = imageUrl; surface.append(image);
  } else {
    previous = button('Previous page', () => { page -= 1; void paint(); });
    next = button('Next page', () => { page += 1; void paint(); });
    smaller = button('Zoom out', () => { zoom = Math.max(.5, zoom - .25); void paint(); });
    larger = button('Zoom in', () => { zoom = Math.min(2.5, zoom + .25); void paint(); });
    [previous, next, smaller, larger].forEach((element) => { element.disabled = true; });
    void (async () => {
      try {
        const [{ getDocument, GlobalWorkerOptions }, bytes] = await Promise.all([
          import('pdfjs-dist/build/pdf.mjs'), blob.arrayBuffer(),
        ]);
        if (disposed) return;
        GlobalWorkerOptions.workerSrc = workerUrl;
        loading = getDocument({
          data: new Uint8Array(bytes),
          enableXfa: false, useWorkerFetch: false,
          useWasm: false, disableFontFace: true, useSystemFonts: false,
          BinaryDataFactory: localBinaryDataFactory(resources.signal),
          disableAutoFetch: true, disableStream: true,
          maxImageSize: 16000000, canvasMaxAreaInBytes: 32000000,
          // Only allowlisted bundled fonts/CMaps; no document-selected URLs,
          // remote profiles or decoder downloads. No PDF scripting layer.
        });
        pdf = await loading.promise;
        if (!disposed) await paint();
      } catch { fail(); }
    })();
  }
  return () => {
    disposed = true; sequence += 1;
    resources.abort();
    renderTask?.cancel();
    void loading?.destroy().catch(() => {});
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    host.replaceChildren();
    pdf = null; renderTask = null; loading = null;
    blob = null;
  };
}

// Independent lifetime: dialog close/unmount does not dispose a separate view.
// Parent page departure or known account/logout change does, even if the popup
// is backgrounded. No PDF bytes, identifiers or credentials enter its URL.
export function openPrivateDocument(blob, kind, expectedOwner) {
  const owner = getSession().user?.id;
  if (!owner || owner !== expectedOwner || getSession().status !== 'authenticated') return 'Check your session before opening a separate view.';
  let view;
  try { view = window.open('about:blank', '_blank'); }
  catch { return 'The browser prevented a separate view. Allow popups for this site, or use Download instead.'; }
  if (!view) return 'The new tab was blocked. Allow popups for this site, or use Download instead.';
  let disposeRender, unsubscribe, timer, closed = false;
  function dispose() {
    if (closed) return;
    closed = true;
    clearInterval(timer); unsubscribe?.(); disposeRender?.();
    blob = null; disposeRender = null; unsubscribe = null;
    window.removeEventListener('pagehide', dispose);
    try { view.document.body.replaceChildren(); view.close(); } catch { /* Window already gone. */ }
  }
  try {
    view.opener = null;
    const doc = view.document;
    doc.title = 'Private read-only document';
    const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
    csp.content = "default-src 'none'; img-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
    const style = doc.createElement('style');
    style.textContent = 'body{margin:20px;font:16px/1.5 system-ui;color:#17232b;background:#f5f7f8}button{font:inherit;padding:10px;white-space:normal} .imm-pdf-controls{display:flex;flex-wrap:wrap;gap:8px}.imm-pdf-surface{overflow:auto;max-width:100%;max-height:80vh}canvas{display:block;background:white}img{max-width:100%;height:auto}';
    doc.head.append(csp, style);
    const heading = doc.createElement('h1'); heading.textContent = 'Private read-only document';
    const note = doc.createElement('p'); note.textContent = 'This view closes on sign-out, account change or departure from the portal. Use the original viewer’s Download action if needed.';
    const close = doc.createElement('button'); close.textContent = 'Close private view'; close.onclick = dispose;
    const host = doc.createElement('main');
    doc.body.replaceChildren(heading, note, close, host);
    disposeRender = renderPrivateDocument(host, blob, kind);
    blob = null;
    unsubscribe = subscribeSession(() => { if (getSession().user?.id !== owner) dispose(); });
    view.addEventListener('pagehide', dispose, { once: true });
    window.addEventListener('pagehide', dispose, { once: true });
    timer = setInterval(() => { if (view.closed) dispose(); }, 1000);
    close.focus();
    return '';
  } catch {
    dispose();
    return 'The separate view could not be opened. Use Download instead.';
  }
}
