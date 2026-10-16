import { poEventActor } from '../../services/purchaseOrders.js';
import { useAdminDateFormatters } from './adminPreferences.js';

const labels = { created: 'Created by', updated: 'Updated by', deleted: 'Deleted by' };

export default function PurchaseOrderEventMeta({ event }) {
  const { timestamp } = useAdminDateFormatters();
  return <p className="po-event__attribution">
    <strong>{labels[event.action]}</strong> {poEventActor(event)}
    <span aria-hidden="true"> · </span>
    <time dateTime={event.at}>{timestamp(event.at)}</time>
  </p>;
}