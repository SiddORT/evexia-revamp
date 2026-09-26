const logoSrc = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

export default function BrandMark() {
  return (
    <span className="brand-mark" data-testid="brand-logo">
      <img
        className="brand-mark__image"
        src={logoSrc}
        alt="EVEXIA Life Sciences logo"
        width="100"
        height="60"
        data-testid="img-evexia-logo"
      />
    </span>
  );
}