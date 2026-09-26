import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import '../../contact-requirement.css';

export default function ContactRequirementButton({ record, kind, compact = false, onClick }) {
  const required = record.contactRequirement === 'required';
  const label = `Phone and email ${required ? 'required' : 'optional'} for ${record.name}. Change to ${required ? 'optional' : 'required'}`;
  return <button type="button"
    className={`contact-requirement-button ${required ? 'contact-requirement-button--required' : 'contact-requirement-button--optional'}${compact ? ' contact-requirement-button--compact' : ''}`}
    aria-label={label} title={label} onClick={onClick}
    data-testid={`button-contact-${kind}-${compact ? 'mobile-' : ''}${record.id}`}>
    {required ? <LockKeyhole size={16} aria-hidden="true" /> : <LockKeyholeOpen size={16} aria-hidden="true" />}
    <span className={compact ? '' : 'sr-only'}>{required ? 'Phone & email required' : 'Phone & email optional'}</span>
  </button>;
}