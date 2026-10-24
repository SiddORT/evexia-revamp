import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, ShoppingCart } from 'lucide-react';

const TYPES = [
  ['immunotherapy', 'Immunotherapy'],
  ['kits-consumables', 'Kits & Consumables'],
  ['spt', 'SPT'],
  ['lupin', 'Lupin'],
];

export default function OrdersNavigation() {
  const [path] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const groupRef = useRef(null);
  const triggerRef = useRef(null);
  const active = path === '/mr/orders' || path.startsWith('/mr/orders/');

  useEffect(() => { setExpanded(false); }, [path]);
  useEffect(() => {
    if (!expanded) return undefined;
    const dismiss = (event) => {
      if (!groupRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded]);

  function handleKeys(event) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      triggerRef.current?.focus();
    }
  }

  return <div className="mrw-orders-nav" ref={groupRef} onKeyDown={handleKeys}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}>
    <button ref={triggerRef} type="button" className="mrw-nav__orders" data-active={active}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded} aria-controls="mrw-orders-subnav" onClick={() => setExpanded((value) => !value)}
      data-testid="button-nav-orders">
      <ShoppingCart className="mrw-nav__icon" size={20} aria-hidden="true" /><span>Orders</span> <ChevronDown size={16} aria-hidden="true" />
    </button>
    <div id="mrw-orders-subnav" className="mrw-orders-subnav" hidden={!expanded}>
      {TYPES.map(([slug, label]) => {
        const href = `/mr/orders/${slug}`;
        const selected = path === href || path.startsWith(`${href}/`);
        return <Link key={slug} href={href} aria-current={selected ? 'page' : undefined}
          onClick={() => setExpanded(false)} data-testid={`link-nav-orders-${slug}`}>{label}</Link>;
      })}
    </div>
  </div>;
}
