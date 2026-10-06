import BrandMark from './BrandMark.jsx';

export default function PortalLoader({ label = 'Opening EVEXIA Portal…' }) {
  return (
    <div className="portal-loader" data-testid="portal-loader">
      <div className="portal-loader__brand"><BrandMark /></div>
      <div className="portal-loader__line" aria-hidden="true" />
      <p role="status" aria-live="polite">{label}</p>
    </div>
  );
}
