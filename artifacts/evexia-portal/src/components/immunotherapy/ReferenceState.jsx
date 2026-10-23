export default function ReferenceState({ source, label }) {
  return <div className="imm-hint">
    {source.state === 'loading' && <span role="status">Loading {label}…</span>}
    {source.error && <><span role="alert">{source.error}</span> <button type="button" className="imm-link-btn" onClick={source.retry}>Retry {label}</button></>}
    {source.state === 'ready' && !source.items.length && <span>No eligible {label} in this section. Search or continue to another section.</span>}
    {source.nextCursor && <button type="button" className="imm-link-btn" disabled={source.state === 'loading'} onClick={source.more}>Load next {label} section</button>}
  </div>;
}
