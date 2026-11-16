import { formatCount, formatINR } from './dashboardFixtures.js';

const TYPE_COLORS = ['var(--admin-primary)', 'var(--admin-secondary)', 'var(--admin-highlight)', 'var(--admin-muted)'];

export function OrderTypeDonut({ byType }) {
  const total = byType.reduce((s, t) => s + t.orders, 0);
  const r = 52; const c = 2 * Math.PI * r;
  let offset = 0;
  const share = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return <div className="dash-donut">
    <svg viewBox="0 0 140 140" className="dash-donut__svg" role="img" aria-label={`Order type share of ${formatCount(total)} sample orders`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--admin-border)" strokeWidth="18" />
      {total > 0 && byType.map((t, i) => {
        const len = (t.orders / total) * c;
        const el = <circle key={t.type} cx="70" cy="70" r={r} fill="none" stroke={TYPE_COLORS[i]} strokeWidth="18"
          strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
        offset += len; return el;
      })}
      <text x="70" y="68" textAnchor="middle" className="dash-donut__total">{formatCount(total)}</text>
      <text x="70" y="86" textAnchor="middle" className="dash-donut__caption">orders</text>
    </svg>
    <ul className="dash-legend" data-testid="list-order-type-legend">
      {byType.map((t, i) => <li key={t.type}>
        <i style={{ background: TYPE_COLORS[i] }} aria-hidden="true" />
        <span>{t.type}</span>
        <strong>{formatCount(t.orders)}</strong>
        <small>{share(t.orders)}%</small>
      </li>)}
    </ul>
  </div>;
}

export function MonthlyTrend({ monthly }) {
  const max = Math.max(...monthly.map((m) => m.sales), 1);
  const w = 480; const h = 190; const left = 76; const right = 16; const top = 16; const bottom = 32;
  const baseline = h - bottom; const plotHeight = baseline - top;
  const step = (w - left - right) / (monthly.length - 1);
  const pts = monthly.map((m, i) => [left + i * step, baseline - (m.sales / max) * plotHeight]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${left},${baseline} ${line} ${w - right},${baseline}`;
  return <div className="dash-trend">
    <svg viewBox={`0 0 ${w} ${h}`} className="dash-trend__svg" aria-hidden="true">
      {[0, 0.5, 1].map((f) => <g key={f}>
        <line x1={left} x2={w - right} y1={baseline - f * plotHeight} y2={baseline - f * plotHeight} className="dash-trend__grid" />
        <text x={left - 8} y={baseline - f * plotHeight + 3} textAnchor="end" className="dash-trend__label">{formatINR(Math.round(max * f))}</text>
      </g>)}
      <polygon points={area} className="dash-trend__area" />
      <polyline points={line} className="dash-trend__line" />
      {pts.map(([x, y], i) => <circle key={monthly[i].label} cx={x} cy={y} r="3" className="dash-trend__dot"><title>{monthly[i].label}: {formatINR(monthly[i].sales)}</title></circle>)}
      {monthly.map((m, i) => (monthly.length <= 12 || i % 6 === 0 || i === monthly.length - 1) && <text key={m.label} x={left + i * step} y={h - 9} textAnchor="middle" className="dash-trend__label">{m.shortLabel}</text>)}
    </svg>
    <details className="dash-alt">
      <summary data-testid="button-trend-table">View monthly values as text</summary>
      <table className="dash-mini-table"><caption className="dash-sr">Monthly demo sales</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Demo sales</th></tr></thead>
        <tbody>{monthly.map((m) => <tr key={m.label}><th scope="row">{m.label}</th><td>{formatINR(m.sales)}</td></tr>)}</tbody>
      </table>
    </details>
  </div>;
}
