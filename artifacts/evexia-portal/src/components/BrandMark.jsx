const logoSrc = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

export default function BrandMark() {
  return (
    <span className="brand-mark" data-testid="brand-logo">
      <img
        className="brand-mark__image"
        src={logoSrc}
        alt="EVEXIA Life Sciences logo"
        width="631"
        height="328"
        data-testid="img-evexia-logo"
      />
    </span>
  );
}