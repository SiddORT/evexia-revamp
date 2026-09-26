import { CalendarDays, Hash, Mail, Phone } from 'lucide-react';
import '../../master-record.css';

const icons = { date: CalendarDays, id: Hash, email: Mail, phone: Phone };

export function RecordLine({ label, value, icon, href, testId }) {
  const Icon = icons[icon];
  const supplied = value !== null && value !== undefined && String(value).trim() !== '' && value !== '—';
  return <span className="admin-record-line">
    {Icon && <Icon size={14} aria-hidden="true" />}
    <span className="admin-record-line__content">
      <span className="sr-only">{label}: </span>
      {supplied ? (href
        ? <a href={href} data-testid={testId} aria-label={`${label}: ${value}`}>{value}</a>
        : <span>{value}</span>)
        : <span className="admin-record-line__empty">No {label.toLowerCase()}</span>}
    </span>
  </span>;
}

export default function RecordDetails({ name, subtitle, rows, showName = true, testId }) {
  return <div className="admin-record-details" data-testid={testId}>
    {showName && <strong className="admin-record-details__name">{name}</strong>}
    {subtitle && <span className="admin-record-details__subtitle">{subtitle}</span>}
    {rows.map((row) => <RecordLine key={row.label} {...row} />)}
  </div>;
}