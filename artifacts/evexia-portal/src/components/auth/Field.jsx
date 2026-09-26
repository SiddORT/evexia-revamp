export default function Field({ id, label, type = 'text', value, onChange, error, placeholder, children, autoComplete }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field__input-wrap">
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid={`input-${id}`}
        />
        {children}
      </div>
      {error && <div id={`${id}-error`} className="field__error" role="alert" data-testid={`error-${id}`}>{error}</div>}
    </div>
  );
}