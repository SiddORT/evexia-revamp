import '../../prDocument.css';

const logoUrl = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

export default function PRReceiptDocument({ document, compact = false }) {
  const pages = compact ? document.pages.slice(0, 1) : document.pages;
  return <div className="pr-document-pages">
    {pages.map((page, index) => <div key={index} className="pr-document-pages__page"
      role="img" aria-label={`${document.model?.isSample ? 'Sample ' : ''}Purchase Received ${document.number}, page ${index + 1}`}
      dangerouslySetInnerHTML={{ __html: page.replaceAll('__EVEXIA_LOGO__', logoUrl) }} />)}
  </div>;
}