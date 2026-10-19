import { formatPrice } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import { Link } from 'wouter';

/** Retained recipe version, prices, assembly link and source-lot provenance for an assembled combo. */
export default function ComboProvenance({ item }) {
  const { date } = useAdminDateFormatters();
  const sources = item.sourceComponents || item.components;
  return <div className="combo-provenance" data-testid="combo-provenance">
    <p>{item.assemblyId ? `Source assembly ${item.assemblyId}` : 'Source assembly link unavailable'}{item.recipe?.version ? ` · recipe version ${item.recipe.version}` : ''}{item.mrp != null || item.sellingPrice != null ? ` · retained MRP ${formatPrice(item.mrp)}, selling price ${formatPrice(item.sellingPrice)}` : ''}</p>
    {item.assembledQuantity && <p>Originally assembled: {item.assembledQuantity} whole combos. Current on-hand and movement quantities are shown separately.</p>}
    {item.comboProductId && <p><Link href={`/admin/masters/products?details=${encodeURIComponent(item.comboProductId)}`}>Product details and retained activity (including deleted products)</Link></p>}
    {item.recipe?.members?.length ? <p>Recipe per combo: {item.recipe.members.map((m) => `${m.name} ${m.quantity} ${m.unit}`).join('; ')}</p> : null}
    {sources?.length ? <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Source lot</th><th scope="col">Consumed</th><th scope="col">Balance before / after</th></tr></thead>
      <tbody>{sources.map((c, i) => <tr key={`${c.lotId}-${i}`}><td>{c.productName}<span className="stock-sub">{c.batchNo ? `Batch ${c.batchNo}` : 'Batch unavailable'} · {c.receiptNumber || 'Receipt unavailable'} · exp {c.expiryDate ? date(c.expiryDate) : 'unavailable'}</span><span className="stock-sub">Source lot {c.lotId || 'unavailable'} · Receipt line {c.lineId || 'unavailable'}</span></td>
        <td className="inv-mono">{c.quantity} {c.unit}</td><td className="inv-mono">{c.before} to {c.after}</td></tr>)}</tbody></table></div>
      : <p>Source components unavailable.</p>}
  </div>;
}
