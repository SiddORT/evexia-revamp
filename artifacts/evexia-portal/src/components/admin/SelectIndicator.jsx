import { ChevronDown } from 'lucide-react';
import './selectIndicator.css';

/** Shared native-control presentation. Native keyboard and forced-color UI stay intact. */
export default function SelectIndicator({ children }) {
  return <span className="admin-select-indicator">{children}<ChevronDown size={16} className="admin-select-indicator__icon" aria-hidden="true" /></span>;
}
