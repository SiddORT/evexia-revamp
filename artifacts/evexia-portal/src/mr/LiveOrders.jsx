import { Link, useLocation } from 'wouter';
import { lazyRoute } from '../components/RouteLoadingBoundary.jsx';
import { MROrderBoundary } from '../components/orders/OrderPortalContext.jsx';

const ImmunotherapyOrders = lazyRoute(() => import('../pages/admin/ImmunotherapyOrders.jsx'));
const ImmunotherapyForm = lazyRoute(() => import('../pages/admin/ImmunotherapyOrderFormPage.jsx'));
const KitsOrders = lazyRoute(() => import('../pages/admin/KitsOrders.jsx'));
const KitsForm = lazyRoute(() => import('../pages/admin/KitsOrderFormPage.jsx'));
const SptOrders = lazyRoute(() => import('../pages/admin/SptOrders.jsx'));
const SptForm = lazyRoute(() => import('../pages/admin/SptOrderFormPage.jsx'));
const LupinOrders = lazyRoute(() => import('../pages/admin/LupinOrders.jsx'));
const LupinForm = lazyRoute(() => import('../pages/admin/LupinOrderFormPage.jsx'));
const TYPES = [['immunotherapy', 'Immunotherapy'], ['kits-consumables', 'Kits & Consumables'], ['spt', 'SPT'], ['lupin', 'Lupin']];

export default function LiveOrders() {
  const [path] = useLocation();
  const parts = path.replace(/\/+$/, '').split('/').slice(3);
  const [kind, id, action] = parts;
  let screen;
  if (!kind || kind === 'new') screen = <section className="mrw-card"><h1>Orders</h1><p>Choose an order type to view saved orders or add an order. These orders are live and shared with Admin, not linked to demo sales or payments.</p></section>;
  else if (kind === 'immunotherapy' && parts.length === 1) screen = <ImmunotherapyOrders />;
  else if (kind === 'kits-consumables' && parts.length === 1) screen = <KitsOrders />;
  else if (kind === 'spt' && parts.length === 1) screen = <SptOrders />;
  else if (kind === 'lupin' && parts.length === 1) screen = <LupinOrders />;
  else if (kind === 'immunotherapy' && id && parts.length <= 3 && (!action || (action === 'edit' && id !== 'new'))) {
    screen = <ImmunotherapyForm key={`${id}-${action || 'view'}`} id={id === 'new' ? undefined : id} mode={id === 'new' || action === 'edit' ? 'edit' : 'view'} />;
  } else if (kind === 'kits-consumables' && id && parts.length === 2) {
    screen = <KitsForm key={id} id={id === 'new' ? undefined : id} />;
  } else if (kind === 'spt' && id && (parts.length === 2 || (parts.length === 3 && action === 'edit' && id !== 'new'))) {
    screen = <SptForm key={id} id={id === 'new' ? undefined : id} />;
  } else if (kind === 'lupin' && id && parts.length === 2) {
    screen = <LupinForm key={id} id={id === 'new' ? undefined : id} />;
  } else screen = <section className="mrw-card"><h1>Order page not found</h1><Link href="/mr/orders">Back to Orders</Link></section>;
  return <MROrderBoundary><nav className="mrw-actions" aria-label="Order types">
    <Link href="/mr/orders" className="admin-button admin-button--secondary">Orders</Link>
    {TYPES.map(([slug, title]) => <Link key={slug} href={`/mr/orders/${slug}`} className="admin-button admin-button--secondary" aria-current={slug === kind ? 'page' : undefined}>{title}</Link>)}
  </nav>{screen}</MROrderBoundary>;
}
