import { useMemo, useState } from 'react';
import { SUPPORTED_TOKENS, SAMPLE_VALUES, inspectTokens, substituteTokens, buildEmailPreview } from '../../services/messageTemplatePreview.js';
import './messageTemplates.css';

const tok = (t) => `{{${t}}}`;
export default function MessageTemplatePreview({ channel, content, idPrefix = 'mtp' }) {
  const [mode, setMode] = useState('tokens');
  const [values, setValues] = useState({ ...SAMPLE_VALUES });
  const email = channel === 'email';
  const c = content || {};
  const fields = email ? [['subject', c.subject], ['html', c.html], ['text', c.text]] : [['body', c.body]];
  const report = useMemo(() => {
    const all = { tokens: new Set(), unknown: new Set(), malformed: 0 };
    fields.forEach(([, v]) => {
      const r = inspectTokens(v || '');
      (r.tokens || []).forEach((t) => all.tokens.add(t));
      (r.unknown || []).forEach((t) => all.unknown.add(t));
      all.malformed += Array.isArray(r.malformed) ? r.malformed.length : (r.malformed ? Number(r.malformed) || 1 : 0);
    });
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.subject, c.html, c.text, c.body]);
  const vals = mode === 'sample' ? values : null;
  const sub = (v) => (vals ? substituteTokens(v || '', vals, false) : (v || ''));
  const srcDoc = useMemo(() => (email ? buildEmailPreview(c.html || '', vals) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email, c.html, mode, values]);
  const smsText = !email ? sub(c.body) : '';
  const blocked = email && /<(script|iframe|object|embed|link|form)\b|\son\w+\s*=|<img[^>]+src\s*=\s*["']?(https?:)?\/\//i.test(c.html || '');
  return <section className="mt-prev" aria-label="Preview" data-testid={`${idPrefix}-preview`}>
    <div className="mt-prev__bar">
      <div className="admin-tabs" role="group" aria-label="Preview mode">
        <button type="button" aria-pressed={mode === 'tokens'} className={mode === 'tokens' ? 'is-on' : ''} onClick={() => setMode('tokens')} data-testid={`${idPrefix}-mode-tokens`}>Tokens</button>
        <button type="button" aria-pressed={mode === 'sample'} className={mode === 'sample' ? 'is-on' : ''} onClick={() => setMode('sample')} data-testid={`${idPrefix}-mode-sample`}>Sample data</button>
      </div>
    </div>
    {mode === 'sample' && <fieldset className="mt-prev__vals"><legend>Sample values (fictional)</legend>
      {SUPPORTED_TOKENS.map((t) => <label key={t} className="mt-field"><span>{tok(t)}</span>
        <input value={values[t] ?? ''} maxLength={200} onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))} data-testid={`${idPrefix}-sample-${t}`} /></label>)}
    </fieldset>}
    <div aria-live="polite" className="mt-prev__warns">
      {report.unknown.size > 0 && <p className="mt-warn" data-testid={`${idPrefix}-warn-unknown`}>Unknown tokens: {[...report.unknown].map(tok).join(', ')}. They are not replaced.</p>}
      {report.malformed > 0 && <p className="mt-warn" data-testid={`${idPrefix}-warn-malformed`}>Malformed token syntax found ({report.malformed}). Use the form {tok('name')}.</p>}
      {blocked && <p className="mt-warn" data-testid={`${idPrefix}-warn-blocked`}>Safety: scripts, frames, forms, event handlers and external assets are blocked in the preview.</p>}
      {report.tokens.size > 0 && <p className="mt-note">Tokens used: {[...report.tokens].map(tok).join(', ')}</p>}
    </div>
    {email ? <>
      <div className="mt-prev__box"><h4>Subject</h4><p data-testid={`${idPrefix}-subject`}>{sub(c.subject) || <em>Empty</em>}</p></div>
      <div className="mt-prev__box"><h4>Rendered HTML</h4>
        {c.html ? <iframe title="Rendered HTML email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} className="mt-prev__frame" data-testid={`${idPrefix}-frame`} /> : <p><em>No HTML</em></p>}</div>
      <div className="mt-prev__box"><h4>Plain text</h4><pre data-testid={`${idPrefix}-text`}>{sub(c.text) || '(empty)'}</pre></div>
    </> : <div className="mt-prev__box"><h4>SMS</h4>
      <pre className="mt-prev__sms" data-testid={`${idPrefix}-sms`}>{smsText || '(empty)'}</pre>
      <p className="mt-note" data-testid={`${idPrefix}-provider`}>Provider/DLT template ID: {c.providerTemplateId ? c.providerTemplateId : 'Unassigned / unregistered'}</p>
      <p className="mt-note" data-testid={`${idPrefix}-length`}>{smsText.length} characters{mode === 'tokens' ? ' (with tokens)' : ''}. Segment count depends on carrier and encoding.</p></div>}
    <p className="mt-note">Preview is approximate. There is no guarantee of email-client compatibility; real inboxes and handsets render differently. External assets, styles, fonts and images are always blocked in this preview. Nothing is sent from this browser.</p>
  </section>;
}
