import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, BadgeIndianRupee, CircleSlash, ClipboardList, Clock3, FilePlus2, Loader, PackageCheck, Receipt, RefreshCw, Stethoscope, Target, Truck, Undo2, UserRound, Wallet, Scale } from 'lucide-react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { mrDisplayIdentity } from '../auth/displayIdentity.js';
import { fiscalBounds, salesMoney } from '../services/serverMRSales.js';
import { Empty, useDate } from './common.jsx';
import { useMRDashboard } from './useMRDashboard.js';
import { useSalesYears } from './useSalesAchievement.js';
import { useDoctorPayments, useFinancialRestrictions, useSavedOrderRefresh } from './useDashboardFeeds.js';
import FinancialRestrictions, { RestrictionSummary } from './FinancialRestrictions.jsx';
import DoctorPayments from './DoctorPayments.jsx';
import DashboardCountCard, { DirectoryCard, FinancialCard, KIND_LABELS } from './DashboardCountCard.jsx';
import { MonthlyAchievement, QuarterComparison, TypeDistribution } from './DashboardCharts.jsx';
import './dashboard.css';

const PERIODS = [['all', 'Full year'], ['Q1', 'Q1'], ['Q2', 'Q2'], ['Q3', 'Q3'], ['Q4', 'Q4']];
const STATUSES = [['Pending', Clock3, 'status'], ['In process', Loader, 'status'], ['Shipped', Truck, 'status'], ['Delivered', PackageCheck, 'status'], ['Rejected', CircleSlash, 'alert'], ['Returned', Undo2, 'alert']];
const ORDER_LINKS = { IT: '/mr/orders/immunotherapy', Kit: '/mr/orders/kits-consumables', SPT: '/mr/orders/spt', Lupin: '/mr/orders/lupin' };
const STATE_NOTICE = { missing: 'No saved target', inactive: 'Target inactive', deleted: 'Target deleted' };
const TABS = [['overview', 'Overview'], ['payments', 'Doctor payments'], ['performance', 'Performance']];
const slug = (s) => s.toLowerCase().replace(/\s+/g, '-');
const over100 = (p) => p != null && BigInt(p.replace('.', '')) > 10000n;
const fillOf = (p) => (p == null ? 0 : over100(p) ? 100 : Math.max(0, Math.min(100, Number(p))));

function Progress({ a, label }) {
  const p = a.percentage;
  if (p == null) return <div className="mrd-meter mrd-meter--off" aria-hidden="true" />;
  return <div className="mrd-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fillOf(p)}
    aria-valuetext={`${p} percent of target${over100(p) ? ', over target' : ''}`}>
    <i style={{ transform: `scaleX(${fillOf(p) / 100})` }} />
  </div>;
}

function notes(a) {
  const out = [];
  if (STATE_NOTICE[a.targetState]) out.push(STATE_NOTICE[a.targetState]);
  if (a.target === '0.00') out.push('Zero target · % unavailable');
  if (!a.complete) out.push(`${a.unavailableOrders} unavailable contribution(s) · incomplete`);
  return out;
}

function Achievement({ a, date, title, big, testId }) {
  const n = notes(a);
  return <article className={`mrd-ach${big ? ' mrd-ach--annual' : ''}`} aria-labelledby={`${testId}-h`} data-testid={testId}>
    <header><h3 id={`${testId}-h`}>{title}</h3><small>{date(a.dateFrom)} – {date(a.dateTo)}</small></header>
    <p className="mrd-ach__pct"><strong data-testid={`${testId}-percent`}>{a.percentage == null ? 'Unavailable' : `${a.percentage}%`}</strong>
      {over100(a.percentage) && <span className="mrw-pill mrw-pill--ok">Over target</span>}</p>
    <Progress a={a} label={`${title} achievement`} />
    <dl className="mrd-ach__dl">
      <div><dt>Saved target</dt><dd>{a.target == null ? '—' : salesMoney(a.target)}</dd></div>
      <div><dt>{a.complete ? 'Achievement' : 'Known (incomplete)'}</dt><dd>{salesMoney(a.knownSales)}</dd></div>
      <div><dt>Remaining</dt><dd>{a.remaining == null ? 'Unavailable' : salesMoney(a.remaining)}</dd></div>
      <div><dt>Approved orders</dt><dd>{a.total}</dd></div>
    </dl>
    {n.length > 0 && <ul className="mrd-ach__notes">{n.map((t) => <li key={t}>{t}</li>)}</ul>}
  </article>;
}

function Skeleton() {
  return <div className="mrd-skel" role="status" aria-label="Loading dashboard">
    <div className="mrd-grid">{Array.from({ length: 6 }, (_, i) => <span key={i} className="mrd-skel__card" />)}</div>
    <span className="mrd-skel__wide" />
  </div>;
}

function ReportGate({ report, children }) {
  if (report.loading && !report.data) return <Skeleton />;
  if (report.error && !report.data) return <div className="mrw-card mrd-error" role="alert">
    <strong>Dashboard unavailable.</strong><span>{report.error}</span><span className="mrw-notice">No figures are estimated.</span>
    <button type="button" className="admin-button" onClick={report.refresh} data-testid="button-dashboard-retry">Retry</button>
  </div>;
  return report.data ? children(report.data) : null;
}

export default function Dashboard() {
  const { user } = useAdminSession();
  const date = useDate();
  const [year, setYear] = useState(null);
  const [period, setPeriod] = useState('all');
  const [yearOffset, setYearOffset] = useState(0);
  const [tab, setTab] = useState('overview');
  const [tick, setTick] = useState(0);
  const tabRefs = useRef({});
  // Single freshness owner for restrictions + Doctor payments: saved-order event, channel, focus/visibility, 45s.
  useSavedOrderRefresh(() => setTick((n) => n + 1), 45000);
  const report = useMRDashboard({ year, period, refreshKey: tick });
  const years = useSalesYears(yearOffset);
  const restrictions = useFinancialRestrictions(tick);
  const payments = useDoctorPayments(tick);
  const data = report.data;
  const id = mrDisplayIdentity(user);
  const selectedYear = year ?? data?.startYear ?? years.data?.currentYear;
  const choices = [...new Set([...(years.data?.items || []), selectedYear].filter((y) => y != null))].sort((a, b) => b - a);
  const fy = selectedYear ? `FY ${selectedYear}–${String(selectedYear + 1).slice(-2)}` : 'Current FY';
  const range = selectedYear ? fiscalBounds(selectedYear, period) : null;
  const periodLabel = `${period === 'all' ? 'Full year' : period}${range ? ` · ${date(range[0])} – ${date(range[1])}` : ''}`;
  const refresh = () => { report.refresh(); years.refresh(); setTick((n) => n + 1); };
  const scope = `Selected period · ${periodLabel}`;

  const select = (v, focus) => { setTab(v); if (focus) tabRefs.current[v]?.focus(); };
  const onTabKey = (e) => {
    const i = TABS.findIndex(([v]) => v === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    select(TABS[(next + TABS.length) % TABS.length][0], true);
  };
  const panel = (v) => ({ role: 'tabpanel', tabIndex: 0, id: `mrd-panel-${v}`, 'aria-labelledby': `mrd-tab-${v}`, hidden: tab !== v, className: 'mrd-view', 'data-testid': `panel-tab-${v}` });

  return <div className="mrd">
    <header className="mrd-head" aria-labelledby="mrw-greet">
      <div className="mrd-head__id">
        <h1 id="mrw-greet" tabIndex={-1} data-testid="heading-mr-page">Hi, {user?.display_name?.trim() || 'there'}</h1>
        <p className="mrd-head__who" data-testid="text-mr-identity"><strong>{id.name}</strong><span>{id.account}</span></p>
      </div>
      <div className="mrd-head__actions">
        <button type="button" className="admin-button admin-button--secondary mrd-refresh" onClick={refresh} disabled={report.loading} data-testid="button-dashboard-refresh">
          <RefreshCw size={15} aria-hidden="true" /> Refresh</button>
        <Link href="/mr/orders/immunotherapy/new" className="admin-button mrd-new" data-testid="link-shortcut-order"><FilePlus2 size={15} aria-hidden="true" />New order</Link>
      </div>
      <div className="mrd-controls">
        <label className="mrw-field">Financial year<select className="admin-select" value={selectedYear ?? ''} disabled={!choices.length}
          onChange={(e) => setYear(Number(e.target.value))} data-testid="select-dashboard-year">
          {!choices.length && <option value="">Loading…</option>}
          {choices.map((y) => <option key={y} value={y}>{y}–{y + 1}</option>)}
        </select></label>
        <div className="mrw-field"><span className="mrd-label" id="mrd-period-label">Order period</span>
          <div className="mrd-seg" role="group" aria-labelledby="mrd-period-label">
            {PERIODS.map(([v, l]) => <button key={v} type="button" aria-pressed={period === v} onClick={() => setPeriod(v)} data-testid={`button-period-${v}`}>{l}</button>)}
          </div></div>
        {(yearOffset > 0 || (years.data && years.data.total > 50)) && <div className="mrd-years">
          <button type="button" className="mrd-link" disabled={yearOffset === 0 || years.loading} onClick={() => setYearOffset((n) => Math.max(0, n - 50))}>Newer years</button>
          <button type="button" className="mrd-link" disabled={years.loading || !years.data || yearOffset + 50 >= years.data.total} onClick={() => setYearOffset((n) => n + 50)}>Older years</button>
        </div>}
        <nav className="mrd-shortcuts" aria-label="Shortcuts">
          <Link href="/mr/doctors" data-testid="link-shortcut-doctors"><Stethoscope size={14} aria-hidden="true" />Doctors</Link>
          <Link href="/mr/targets" data-testid="link-shortcut-targets"><Target size={14} aria-hidden="true" />Targets</Link>
          <Link href="/mr/accounts" data-testid="link-shortcut-payment"><Wallet size={14} aria-hidden="true" />Accounts</Link>
        </nav>
      </div>
      {years.error && <p className="mrw-notice mrd-head__full" role="alert">{years.error} <button type="button" className="mrd-link" onClick={years.refresh}>Retry years</button></p>}
      <div className="mrd-tabs mrd-head__full" role="tablist" aria-label="Dashboard views" onKeyDown={onTabKey}>
        {TABS.map(([v, l]) => <button key={v} ref={(el) => { tabRefs.current[v] = el; }} type="button" role="tab" id={`mrd-tab-${v}`}
          aria-selected={tab === v} aria-controls={`mrd-panel-${v}`} tabIndex={tab === v ? 0 : -1}
          onClick={() => select(v)} data-testid={`tab-dashboard-${v}`}>{l}
          {v === 'payments' && restrictions.data?.total > 0 && <span className="mrd-tabs__badge" aria-label={`${restrictions.data.total} blocked`}>{restrictions.data.total}</span>}
        </button>)}
      </div>
    </header>

    <div {...panel('overview')}>
      <RestrictionSummary state={restrictions} onOpen={() => select('payments', true)} />
      <ReportGate report={report}>{(d) => <>
        <p className="mrd-scope" role="status" aria-live="polite" data-testid="status-dashboard-scope">Orders: {periodLabel} · Directory: current</p>
        <section aria-labelledby="mrd-financial" className="mrd-group">
          <h2 id="mrd-financial" className="mrd-group__title">Financial summary <small>{fy} · {periodLabel} · Saved order dates</small></h2>
          <div className="mrd-grid mrd-grid--financial">
            <FinancialCard icon={BadgeIndianRupee} label="Total Sales" metric={d.financial.totals.totalSales} onRetry={report.refresh} testId="card-total-sales" />
            <FinancialCard icon={Receipt} label="Gross Sales" metric={d.financial.totals.grossSales} onRetry={report.refresh} testId="card-gross-sales" />
            <FinancialCard icon={Scale} label="Actual Sales" metric={d.financial.totals.actualSales} onRetry={report.refresh} testId="card-actual-sales" />
            <FinancialCard icon={Wallet} label="Due Amount" metric={d.financial.totals.dueAmount} onRetry={report.refresh} testId="card-due-amount" />
          </div>
          <p className="mrw-notice">Configured contributions only, not complete all-order totals. Total Sales uses saved Business Parking;
            Gross and Actual Sales both use saved invoice totals. Due Amount includes unpaid and received-but-unverified amounts,
            including payable returned orders. Other order-type financial formulas are not configured.</p>
        </section>
        <section aria-labelledby="mrd-overview" className="mrd-group">
          <h2 id="mrd-overview" className="sr-only">Counts</h2>
          <div className="mrd-grid mrd-grid--live">
            <DashboardCountCard active={tab === 'overview'} icon={ClipboardList} label="Total Orders" total={d.orders.total} byType={d.orders.byType} scope={scope} tone="primary" testId="card-total-orders" />
            <DirectoryCard icon={Stethoscope} label="Assigned Doctors" value={d.directory.doctors} testId="card-total-doctors" />
            <DirectoryCard icon={UserRound} label="Assigned Patients" value={d.directory.patients} testId="card-total-patients" />
          </div>
        </section>
        <section aria-labelledby="mrd-status" className="mrd-group">
          <h2 id="mrd-status" className="mrd-group__title">Order status <small>{periodLabel}</small></h2>
          <div className="mrd-grid mrd-grid--status">
            {STATUSES.map(([s, Icon, tone]) => { const row = d.statuses.find((r) => r.label === s);
              return <DashboardCountCard active={tab === 'overview'} key={s} icon={Icon} label={s} tone={tone} total={row.total} byType={row.byType} scope={scope} testId={`card-status-${slug(s)}`} />; })}
          </div>
        </section>
        <div className="mrd-split">
          <section className="mrw-card mrd-panel mrd-annual" aria-labelledby="mrd-annual-h" data-testid="panel-annual-compact">
            <header className="mrd-panel__head"><div><h2 id="mrd-annual-h">Annual target</h2><small>Full {fy}</small></div>
              <button type="button" className="mrd-link" onClick={() => select('performance', true)} data-testid="button-open-performance">Performance <ArrowRight size={13} aria-hidden="true" /></button></header>
            <p className="mrd-ach__pct"><strong>{d.annual.percentage == null ? 'Unavailable' : `${d.annual.percentage}%`}</strong>
              {over100(d.annual.percentage) && <span className="mrw-pill mrw-pill--ok">Over target</span>}</p>
            <Progress a={d.annual} label={`Annual ${fy} achievement`} />
            <p className="mrd-annual__line"><span>{d.annual.complete ? 'Achieved' : 'Known (incomplete)'} {salesMoney(d.annual.knownSales)}</span>
              <span>Target {d.annual.target == null ? '—' : salesMoney(d.annual.target)}</span></p>
          </section>
          <section className="mrw-card mrd-panel" aria-labelledby="mrd-recent">
            <header className="mrd-panel__head"><div><h2 id="mrd-recent">Recent orders</h2><small>Latest {d.recentLimit} · {periodLabel}</small></div></header>
            {d.recent.length === 0 ? <Empty title="No orders in this period" text="Create an order or choose another period." to="/mr/orders" action="Go to orders" /> :
              <ul className="mrd-recent">{d.recent.slice(0, d.recentLimit).map((o) => <li key={o.key}>
                <Link href={ORDER_LINKS[o.kind]} data-testid={`link-recent-${o.key}`}>
                  <span className="mrd-recent__main"><strong>{o.number}</strong><small>{o.classification === 'Free kit' ? 'Free kit' : KIND_LABELS[o.kind]} · {date(o.date)}</small></span>
                  <span className={`mrd-status mrd-status--${slug(o.status)}`}>{o.status}</span>
                </Link></li>)}</ul>}
          </section>
        </div>
      </>}</ReportGate>
    </div>

    <div {...panel('payments')}>
      <FinancialRestrictions state={restrictions} />
      <DoctorPayments state={payments} />
    </div>

    <div {...panel('performance')}>
      <ReportGate report={report}>{(d) => <>
        <section aria-labelledby="mrd-targets" className="mrd-group">
          <h2 id="mrd-targets" className="mrd-group__title">Target achievement <small>Full {fy} · approved orders</small></h2>
          <div className="mrd-ach-grid">
            <Achievement a={d.annual} date={date} title={`Annual ${fy}`} big testId="panel-annual" />
            {d.quarters.map((q) => <Achievement key={q.period} a={q} date={date} title={q.period} testId={`panel-${q.period.toLowerCase()}`} />)}
          </div>
        </section>
        <div className="mrd-charts">
          <MonthlyAchievement monthly={d.monthly} fy={fy} />
          <QuarterComparison quarters={d.quarters} fy={fy} />
          <TypeDistribution orders={d.orders} periodLabel={periodLabel} />
        </div>
      </>}</ReportGate>
    </div>
  </div>;
}
