import { useEffect, useRef, useState } from 'react';
import SearchableControl from './SearchableControl.jsx';
import { patientLanguageChoices } from '../../services/serverPatients.js';

const INITIAL = { items: [], nextCursor: null, loading: true, error: '' };

export default function PatientLanguageSelect({ value, original, blocked, error, onChange }) {
  const [search, setSearch] = useState({ query: '', cursor: null, revision: 0 });
  const [state, setState] = useState(INITIAL);
  const request = useRef(0);
  const controller = useRef(null);

  // Invalidating synchronously prevents a late response or a stale choice from
  // being used between a search/paging action and the next effect.
  function load(query, cursor = null) {
    request.current++;
    controller.current?.abort();
    setState((old) => ({ ...(cursor ? old : INITIAL), loading: true, error: '' }));
    setSearch((old) => ({ query, cursor, revision: old.revision + 1 }));
  }

  useEffect(() => {
    if (blocked) return undefined;
    const current = ++request.current;
    const abort = new AbortController();
    controller.current = abort;
    setState((old) => ({ ...old, loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const data = await patientLanguageChoices({
          query: search.query, cursor: search.cursor, limit: 50,
        }, abort.signal);
        if (abort.signal.aborted || current !== request.current) return;
        setState((old) => ({
          items: [...new Set([...(search.cursor ? old.items : []), ...data.items.map((item) => item.name)])],
          nextCursor: data.nextCursor, loading: false, error: '',
        }));
      } catch (cause) {
        if (abort.signal.aborted || current !== request.current) return;
        setState((old) => ({ ...old, loading: false,
          error: cause.message || 'Languages could not be loaded. Your patient draft is preserved.' }));
      }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [search, blocked]);

  const feedback = state.loading ? 'Loading languages…' : state.error
    || (!state.items.length ? (search.query.trim() ? 'No matching languages.' : 'Language Master has no current languages.')
      : `${state.items.length} languages loaded.${state.nextCursor ? ' More languages are available.' : ''}`);
  const retry = () => load(search.query, search.cursor);
  const action = state.error ? { label: 'Retry languages', run: retry, testId: 'button-retry-patient-languages' }
    : state.nextCursor ? { label: 'Load more languages', run: () => load(search.query, state.nextCursor),
      pending: state.loading, testId: 'button-more-patient-languages' } : undefined;

  return <div className="mr-form__field">
    <label className="mr-form__label" htmlFor="patient-instructionsLanguage">
      Instructions language <span className="mr-form__required" aria-hidden="true">*</span>
    </label>
    <SearchableControl id="patient-instructionsLanguage" name="instructionsLanguage" label="Instructions language"
      required value={value} selectedLabel={value} searchMaxLength={200}
      choices={state.loading || state.error ? [] : state.items.map((name) => ({ value: name, label: name }))}
      onSearch={(query) => load(query)} onChange={onChange} disabled={blocked}
      invalid={Boolean(error)} describedBy={`patient-language-help${error ? ' patient-instructionsLanguage-error' : ''}`}
      loading={state.loading} feedback={feedback} action={action}
      placeholder="Select a language" testId="select-patient-instructionsLanguage" />
    <p className="mr-form__hint" role="status">{feedback}</p>
    {state.error && <button type="button" className="admin-button admin-button--secondary"
      disabled={blocked} onClick={retry}>Retry languages</button>}
    <p className="mr-form__hint" id="patient-language-help">
      {original && value === original
        ? `Saved language: ${original}. Retained unchanged, even if renamed or removed from Language Master. Select a current language only to replace it.`
        : 'Search current Language Master names. Only selecting a choice changes the patient language.'}
    </p>
    {error && <p className="mr-form__error" role="alert" id="patient-instructionsLanguage-error"
      data-testid="error-patient-instructionsLanguage">{error}</p>}
  </div>;
}
