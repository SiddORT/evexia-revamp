import { useState } from 'react';
import { Info } from 'lucide-react';

export default function InfoDisclosure({ id, title, text, children, testId }) {
  const [open, setOpen] = useState(false);
  return <div className="admin-info">
    <div className="admin-info__row">
      {children}
      <button type="button" className="admin-info__button" aria-label={`About ${title}`}
        aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined}
        data-admin-info-open={open} data-testid={testId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}><Info size={16} aria-hidden="true" /></button>
    </div>
    <p id={id} className="admin-info__text" hidden={!open}>{text}</p>
  </div>;
}