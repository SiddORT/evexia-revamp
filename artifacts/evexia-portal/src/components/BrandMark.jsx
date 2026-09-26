export default function BrandMark({ light = false }) {
  return (
    <span className={`brand-mark${light ? ' brand-mark--light' : ''}`} data-testid="brand-wordmark">
      <span className="brand-mark__word">EVEXIA</span>
    </span>
  );
}