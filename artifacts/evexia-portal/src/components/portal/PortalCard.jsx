import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';

export default function PortalCard({ role }) {
  return (
    <Link href={role.path} className="portal-card" data-testid={`link-portal-${role.short.toLowerCase()}`}>
      <div className="portal-card__visual">
        <img src={role.image} alt="" />
        <span className="portal-card__number">{role.short}</span>
      </div>
      <div className="portal-card__body">
        <h2 data-testid={`text-portal-title-${role.short.toLowerCase()}`}>{role.cardTitle}</h2>
        <p>{role.description}</p>
        <span className="portal-card__cta">
          {role.cta}
          <span className="portal-card__arrow" aria-hidden="true"><ArrowRight size={18} /></span>
        </span>
      </div>
    </Link>
  );
}