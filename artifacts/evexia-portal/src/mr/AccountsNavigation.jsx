import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, Wallet } from 'lucide-react';

const LINKS = [['settlements', 'Settlements']];

export default function AccountsNavigation() {
  const [path] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const groupRef = useRef(null);
  const triggerRef = useRef(null);
  const active = path === '/mr/accounts' || path.startsWith('/mr/accounts/');

  useEffect(() => { setExpanded(false); }, [path]);
  useEffect(() => {
    if (!expanded) return undefined;
    const dismiss = (event) => { if (!groupRef.current?.contains(event.target)) setExpanded(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded]);

  function handleKeys(event) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation();
      setExpanded(false); triggerRef.current?.focus();
    }
  }

  return <div className="mrw-orders-nav" ref={groupRef} onKeyDown={handleKeys}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}>
    <button ref={triggerRef} type="button" className="mrw-nav__orders" data-active={active}
      aria-current={active ? 'page' : undefined} aria-expanded={expanded} aria-controls="mrw-accounts-subnav"
      onClick={() => setExpanded((value) => !value)} data-testid="button-nav-accounts">
      <Wallet className="mrw-nav__icon" size={20} aria-hidden="true" /><span>Accounts</span> <ChevronDown size={16} aria-hidden="true" />
    </button>
    <div id="mrw-accounts-subnav" className="mrw-orders-subnav" hidden={!expanded}>
      {LINKS.map(([slug, label]) => {
        const href = `/mr/accounts/${slug}`;
        return <Link key={slug} href={href} aria-current={path === href ? 'page' : undefined}
          onClick={() => setExpanded(false)} data-testid={`link-nav-accounts-${slug}`}>{label}</Link>;
      })}
    </div>
  </div>;
}
