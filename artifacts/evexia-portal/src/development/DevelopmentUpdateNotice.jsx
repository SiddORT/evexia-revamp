import { useEffect, useState } from 'react';

/** No probe, timer, navigation or reload: retain the current tab's drafts. */
export default function DevelopmentUpdateNotice({ children }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const pending = () => setAvailable(true);
    window.addEventListener('evexia:automatic-reload-blocked', pending);
    return () => window.removeEventListener('evexia:automatic-reload-blocked', pending);
  }, []);
  return <>
    {available && <aside role="status" className="development-update-notice">
      A development update is available. Your drafts remain in this tab.{' '}
      <a href={window.location.href} target="_blank" rel="noreferrer">Open the updated preview</a>
    </aside>}
    {children}
  </>;
}
