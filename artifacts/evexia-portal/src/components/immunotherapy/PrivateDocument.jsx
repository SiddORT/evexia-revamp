import { useEffect, useRef } from 'react';
import { renderPrivateDocument } from './privateDocument.js';

export default function PrivateDocument({ blob, kind, label, onError }) {
  const host = useRef(null);
  const error = useRef(onError);
  error.current = onError;
  useEffect(() => renderPrivateDocument(host.current, blob, kind, () => error.current?.(), label), [blob, kind, label]);
  return <div className="imm-rendered-document" ref={host} />;
}
