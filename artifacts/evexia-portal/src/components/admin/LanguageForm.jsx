import { useEffect, useRef, useState } from 'react';
import { getLanguage, listLanguages } from '../../services/serverLanguages.js';
import Field from '../auth/Field.jsx';
import Dialog from './Dialog.jsx';

const isConflict = (r) => (r.status === 409 && r.code !== 'language_duplicate') || /stale/.test(r.code || '');

export default function LanguageForm({ language, onSave, onClose, canSave = true }) {
  const [name, setName] = useState(language?.name || '');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [review, setReview] = useState('');
  const [matches, setMatches] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || blocked || !canSave) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Language name is required.'); return; }
    if ([...trimmed].length > 200) { setError('Language name must be at most 200 characters.'); return; }
    setPending(true);
    try {
      const result = await onSave({ name: trimmed }, current || language);
      if (!result.success) { setError(result.error); setBlocked(isConflict(result) || Boolean(result.ambiguous)); }
    } finally { setPending(false); }
  }

  async function reviewMatches() {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setPending(true);
    try {
      const result = await listLanguages({ query: name.trim(), limit: 10, offset: 0 }, c.signal);
      if (c.signal.aborted) return;
      setMatches(result.items || []);
    } catch (cause) { if (!c.signal.aborted) setError(cause.message); }
    finally { if (!c.signal.aborted) setPending(false); }
  }

  async function reviewCurrent() {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setPending(true);
    try {
      const record = await getLanguage(language.id, c.signal);
      if (c.signal.aborted) return;
      setCurrent(record);
      setReview(`Current server record: ${record.name}, version ${record.version}. Your draft is unchanged. Check it before saving.`);
      setError('');
      setBlocked(false);
    } catch (cause) { if (!c.signal.aborted) setError(cause.status === 404 ? 'This language was deleted. Your draft is kept; close and review its history from the list.' : cause.message); }
    finally { if (!c.signal.aborted) setPending(false); }
  }

  return (
    <Dialog title={language ? 'Edit language' : 'Add language'} onClose={pending ? () => {} : onClose}
      titleInfo={language ? 'Changes are saved to shared server records. Server identity and time determine audit details.' : undefined}>
      <form id="language-form" className="admin-dialog__form" onSubmit={handleSubmit} noValidate>
        {!canSave && <p role="alert">Your permission for this action was removed. This draft is kept for reference, but cannot be saved.</p>}
        <Field id="language-name" label="Language name *" value={name} onChange={(event) => { setName(event.target.value); setError(''); }} error={error} placeholder="e.g. Marathi" autoComplete="off" />
        {review && <p role="status" data-testid="status-language-review">{review}</p>}
        {blocked && language && <button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={reviewCurrent} data-testid="button-review-language">Review current server record</button>}
        {blocked && !language && <>
          <p role="alert">The save outcome is unknown. Review current server records before deciding; this draft is kept. Resubmitting stays blocked.</p>
          <button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={reviewMatches} data-testid="button-review-language-records">Review current server records</button>
          {matches && <div role="status" data-testid="list-language-matches">{matches.length ? <ul>{matches.map((m) => <li key={m.id}>{m.name.trim().toLowerCase() === name.trim().toLowerCase() ? 'Exact match' : 'Similar'}: {m.name} (ID {m.id}, version {m.version})</li>)}</ul> : <p>No matching records were returned. This does not confirm the language was not saved; close this draft and refresh the list before adding again.</p>}</div>}
        </>}
        <div className="admin-dialog__actions">
          <button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-language">Cancel</button>
          <button type="submit" disabled={pending || blocked || !canSave} className="admin-button" data-testid="button-save-language">{pending ? 'Saving…' : language ? 'Save changes' : 'Add language'}</button>
        </div>
      </form>
    </Dialog>
  );
}
