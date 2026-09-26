const logoSrc = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

export default function BrandMark({ light = false }) {
  return (
    <span className={`brand-mark${light ? ' brand-mark--light' : ''}`} data-testid={light ? 'brand-logo-visual' : 'brand-logo'}>
      <img
        className="brand-mark__image"
        src={logoSrc}
        alt="EVEXIA Life Sciences logo"
        width="100"
        height="60"
        data-testid={light ? 'img-evexia-logo-visual' : 'img-evexia-logo'}
      />
    </span>
  );
}