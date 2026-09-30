import { poEventActor } from '../../services/purchaseOrders.js';

const labels = { created: 'Created by', updated: 'Updated by', deleted: 'Deleted by' };

export default function PurchaseOrderEventMeta({ event }) {
  return <p className="po-event__attribution">
    <strong>{labels[event.action]}</strong> {poEventActor(event)}
    <span aria-hidden="true"> · </span>
    <time dateTime={event.at}>{new Date(event.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time>
  </p>;
}