import { useState } from 'react';
import { cents, ratio, salesMoney } from '../services/serverMRSales.js';
import { KIND_LABELS, fullBreakdown } from './DashboardCountCard.jsx';

// Geometry only: bounded 0..100 ratios derived via exact BigInt helpers.
// Money is never added, subtracted or rounded with Number here.
const share = (amount, max) => {
  if (amount == null || max == null || cents(max) === 0n) return 0;
  const r = ratio(amount, max);
  if (r == null) return 0;
  const n = Number(r);
  return Math.max(0, Math.min(100, n));
};
const maxOf = (values) => values.filter((v) => v != null).reduce((m, v) => (m == null || cents(v) > cents(m) ? v : m), null);
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const monthLabel = (m) => MONTH.format(new Date(`${m}-01T00:00:00Z`));
const monthLong = (m) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

function ViewToggle({ view, setView, id }) {
  return <div className="mrd-toggle" role="group" aria-label="Chart or table view">
    {[['chart', 'Chart'], ['table', 'Table']].map(([v, l]) => <button key={v} type="button" aria-pressed={view === v}
      onClick={() => setView(v)} data-testid={`button-${id}-${v}`}>{l}</button>)}
  </div>;
}

export function MonthlyAchievement({ monthly, fy }) {
  const [view, setView] = useState('chart');
  const max = maxOf(monthly.map((m) => m.amount));
  const missing = monthly.filter((m) => m.amount == null).length;
  const H = 140;
  return <section className="mrw-card mrd-panel" aria-labelledby="mrd-monthly">
    <header className="mrd-panel__head">
      <div><h2 id="mrd-monthly">Monthly achievement sales</h2><small>Full financial year {fy} · approved saved orders · INR</small></div>
      <ViewToggle view={view} setView={setView} id="monthly" />
    </header>
    {view === 'chart' ? <figure className="mrd-figure">
      <svg viewBox={`0 0 ${monthly.length * 40} ${H + 22}`} className="mrd-svg" role="img"
        aria-label={`Monthly achievement for ${fy}. ${missing ? `${missing} month(s) incomplete and not plotted.` : ''} Switch to table view for exact values.`}>
        <line x1="0" x2={monthly.length * 40} y1={H} y2={H} className="mrd-axis" />
        {monthly.map((m, i) => {
          const x = i * 40 + 8;
          if (m.amount == null) return <g key={m.month}>
            <rect x={x} y={H - 24} width="24" height="24" className="mrd-bar--gap" rx="3" />
            <text x={x + 12} y={H - 30} className="mrd-svg-note" textAnchor="middle">?</text>
            <text x={x + 12} y={H + 15} textAnchor="middle" className="mrd-svg-label">{monthLabel(m.month)}</text>
            <title>{monthLong(m.month)}: incomplete, {m.unavailableOrders} order(s) without saved price</title>
          </g>;
          const h = (share(m.amount, max) / 100) * (H - 10);
          return <g key={m.month}>
            <rect x={x} y={H - h} width="24" height={Math.max(h, cents(m.amount) > 0n ? 2 : 0)} className="mrd-bar" rx="3" />
            <text x={x + 12} y={H + 15} textAnchor="middle" className="mrd-svg-label">{monthLabel(m.month)}</text>
            <title>{monthLong(m.month)}: {salesMoney(m.amount)}</title>
          </g>;
        })}
      </svg>
      <figcaption className="mrw-notice">{max ? `Tallest complete-month bar ${salesMoney(max)}.` : 'No complete-month amounts are available.'}
        {missing ? ' Outlined months have unavailable saved prices and are not plotted as zero.' : ''}</figcaption>
    </figure> : <div className="mrw-scroll" role="region" aria-label="Monthly achievement table" tabIndex={0}>
      <table className="mrw-table mrd-table"><thead><tr><th scope="col">Month</th><th scope="col" className="num">Achievement</th><th scope="col" className="num">Known (partial)</th><th scope="col" className="num">Unpriced orders</th></tr></thead>
        <tbody>{monthly.map((m) => <tr key={m.month}><th scope="row">{monthLong(m.month)}</th>
          <td className="num">{m.amount == null ? 'Incomplete' : salesMoney(m.amount)}</td>
          <td className="num">{m.amount == null ? `${salesMoney(m.knownSales)} (incomplete)` : '—'}</td>
          <td className="num">{m.unavailableOrders}</td></tr>)}</tbody></table>
    </div>}
  </section>;
}

export function QuarterComparison({ quarters, fy }) {
  const [view, setView] = useState('chart');
  const max = maxOf(quarters.flatMap((q) => [q.target, q.complete ? q.knownSales : null]));
  return <section className="mrw-card mrd-panel" aria-labelledby="mrd-quarters-chart">
    <header className="mrd-panel__head">
      <div><h2 id="mrd-quarters-chart">Quarterly target vs achievement</h2><small>Full financial year {fy} · INR</small></div>
      <ViewToggle view={view} setView={setView} id="quarters" />
    </header>
    {view === 'chart' ? <figure className="mrd-figure">
      <ul className="mrd-legend" aria-hidden="true"><li><i className="mrd-swatch mrd-swatch--target" />Saved target</li><li><i className="mrd-swatch" />Achievement</li></ul>
      <div className="mrd-hbars" role="img" aria-label={`Quarterly target versus achievement for ${fy}. Switch to table view for exact values.`}>
        {quarters.map((q) => <div className="mrd-hbars__row" key={q.period}>
          <span className="mrd-hbars__q">{q.period}</span>
          <div className="mrd-hbars__tracks">
            <div className="mrd-track">{q.target != null ? <i className="mrd-fill mrd-fill--target" style={{ transform: `scaleX(${share(q.target, max) / 100})` }} /> : <em>No active target</em>}</div>
            <div className="mrd-track">{q.complete ? <i className="mrd-fill" style={{ transform: `scaleX(${share(q.knownSales, max) / 100})` }} /> : <em>Incomplete · not plotted</em>}</div>
          </div>
        </div>)}
      </div>
      <figcaption className="mrw-notice">{max ? `Shared scale: full bar ${salesMoney(max)}.` : 'No comparable amounts available.'} Missing targets and incomplete achievement are not plotted. Use Table for exact values.</figcaption>
    </figure> : <div className="mrw-scroll" role="region" aria-label="Quarterly comparison table" tabIndex={0}>
      <table className="mrw-table mrd-table"><thead><tr><th scope="col">Quarter</th><th scope="col" className="num">Target</th><th scope="col" className="num">Achievement</th><th scope="col" className="num">Percent</th></tr></thead>
        <tbody>{quarters.map((q) => <tr key={q.period}><th scope="row">{q.period}</th><td className="num">{salesMoney(q.target)}</td>
          <td className="num">{q.complete ? salesMoney(q.knownSales) : `${salesMoney(q.knownSales)} known (incomplete)`}</td>
          <td className="num">{q.percentage == null ? 'Unavailable' : `${q.percentage}%`}</td></tr>)}</tbody></table>
    </div>}
  </section>;
}

const R = 46, C = 2 * Math.PI * R;
export function TypeDistribution({ orders, periodLabel }) {
  const rows = fullBreakdown(orders.byType);
  let acc = 0;
  return <section className="mrw-card mrd-panel" aria-labelledby="mrd-types">
    <header className="mrd-panel__head"><div><h2 id="mrd-types">Orders by type</h2><small>Selected period · {periodLabel}</small></div></header>
    {orders.total === 0 ? <p className="mrw-notice" role="status">No submitted orders in this period, so there is no distribution to show.</p> :
      <div className="mrd-donut">
        <svg viewBox="0 0 120 120" className="mrd-donut__svg" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="mrd-donut__base" />
          {rows.map((r, i) => {
            const frac = Number(BigInt(r.count) * 1000000000n / BigInt(orders.total)) / 1000000000;
            const seg = <circle key={r.kind} cx="60" cy="60" r={R} className={`mrd-donut__seg mrd-tone-${i}`}
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} transform="rotate(-90 60 60)" />;
            acc += frac;
            return frac > 0 ? seg : null;
          })}
          <text x="60" y="58" textAnchor="middle" className="mrd-donut__total">{orders.total}</text>
          <text x="60" y="74" textAnchor="middle" className="mrd-svg-label">orders</text>
        </svg>
        <table className="mrd-type-table"><caption className="mrw-notice">{orders.total} submitted orders by type</caption>
          <thead><tr><th scope="col">Type</th><th scope="col" className="num">Orders</th><th scope="col" className="num">Share</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.kind}><th scope="row"><i className={`mrd-dot mrd-tone-${i}`} aria-hidden="true" />{KIND_LABELS[r.kind]}</th>
            <td className="num">{r.count}</td><td className="num">{r.percentage}%</td></tr>)}</tbody></table>
      </div>}
  </section>;
}
