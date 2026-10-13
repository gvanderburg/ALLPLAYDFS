import './_group.css';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDownToLine, CalendarDays, ChevronRight, Download, Film, LockKeyhole,
  Newspaper, RefreshCw, ShieldCheck, Smartphone, TrendingUp,
} from 'lucide-react';

const SPORTS = [
  { id: 'nfl', name: 'NFL', short: 'NFL' },
  { id: 'nhl', name: 'NHL', short: 'NHL' },
  { id: 'wnba', name: 'WNBA', short: 'WNBA' },
  { id: 'nba', name: 'NBA', short: 'NBA' },
  { id: 'mlb', name: 'MLB', short: 'MLB' },
  { id: 'nascar', name: 'NASCAR', short: 'NASCAR' },
  { id: 'cfb', name: 'College football', short: 'CFB' },
] as const;

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className="state-box"><div className="state-icon">{icon}</div><strong>{title}</strong><p>{copy}</p></div>;
}

function ModelPreview() {
  // Mirrors the source ModelPreview's signed-out/access-locked branch. Auth,
  // membership, model, and dashboard data are deliberately stubbed in sandbox.
  return <div className="model-preview">
    <div className="model-preview-head">
      <div><span className="model-kicker">ALLPLAY CUSTOM MODEL</span><h3>Independent player research</h3><p>Historical stat estimates plus site-rule fantasy simulations where scoring inputs are supported. Not a provider forecast.</p></div>
      <a href="#projections" className="btn btn-quiet">Open full sheet <ChevronRight size={14} /></a>
    </div>
    <div className="model-preview-lock"><LockKeyhole size={16} />Member access required to inspect model estimates.</div>
    <a href="#projections" className="model-preview-link">Inspect calculations, recent appearances &amp; settings <ChevronRight size={14} /></a>
  </div>;
}

export default function Current() {
  const [date, setDate] = useState(localDateString);
  const [sport, setSport] = useState<(typeof SPORTS)[number]['id']>('nfl');
  const [installOpen, setInstallOpen] = useState(false);
  const [installed] = useState(false);
  const events: never[] = [];
  const news: never[] = [];
  const loading = false;
  const sportName = useMemo(() => SPORTS.find((item) => item.id === sport)?.name ?? sport.toUpperCase(), [sport]);
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
  const fullDate = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  return <div className="app-shell dashboard-extraction">
    <header className="topbar">
      <a href="#overview" className="brand" aria-label="ALLPLAY home"><span className="brand-mark"><Activity size={18} strokeWidth={2.4} /></span><span className="brand-name">ALLPLAY</span></a>
      <div className="topbar-right">
        <span className="today-label">Personal fantasy cockpit</span>
        <a href="#projections" className="btn btn-quiet account-header-link"><TrendingUp size={14} />Model</a>
        <a href="#takes" className="btn btn-quiet account-header-link"><Film size={14} />Takes</a>
        <a href="#feedback" className="btn btn-quiet account-header-link">Feedback</a>
        <a href="#sign-in" className="btn btn-quiet account-header-link">Sign in</a>
        <button className="btn btn-primary header-install-btn" onClick={() => setInstallOpen(true)} disabled={installed}><ArrowDownToLine size={15} />{installed ? 'Installed' : 'Install app'}</button>
        <span className="user-dot" aria-label="Personal dashboard">FREE</span>
      </div>
    </header>

    <aside className="side-rail" aria-label="Dashboard navigation">
      <div className="rail-caption">YOUR WORKSPACE</div>
      <a className="rail-link selected" href="#overview" aria-current="page"><Activity size={15} />Overview</a>
      <a className="rail-link" href="#slate-section"><CalendarDays size={15} />Live slate</a>
      <a className="rail-link" href="#projections"><TrendingUp size={15} />Projections</a>
      <a className="rail-link" href="#takes"><Film size={15} />Game takes</a>
      <a className="rail-link" href="#feedback">Feedback</a>
      <a className="rail-link" href="#news-section"><Newspaper size={15} />News desk</a>
      <div className="rail-note"><span className="rail-live-dot" />Slate data refreshes every 5 minutes</div>
      <div className="rail-bottom"><span className="rail-caption">BUILT FOR EVERY LEAGUE</span><div className="rail-sports">NFL · NHL · WNBA<br />NBA · MLB · NASCAR · CFB</div></div>
    </aside>

    <main className="main-wrap" id="overview">
      <div className="sandbox-data-note">SANDBOX PREVIEW · API, membership and authentication are stubbed; no live data is shown.</div>
      <div className="page-heading">
        <div><div className="eyebrow">Your daily edge <span style={{ color: 'var(--slate-muted)' }}> / </span> {weekday}</div><h1>Slate, in focus.</h1><p className="subhead">Every matchup, number and note for the decisions ahead.</p></div>
        <div className="date-stamp"><div>{fullDate}</div><div style={{ marginTop: 5, color: 'var(--slate-muted)' }}>AWAITING DATA</div></div>
      </div>
      <div className="control-bar">
        <div className="filter-group"><label className="micro-label" htmlFor="slate-date">Slate</label><input id="slate-date" className="date-field" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Select slate date" /></div>
        <div className="action-group">
          <button className="btn btn-quiet" disabled={!events.length} aria-label="Export event slate as CSV"><Download size={15} /> Events</button>
          <a className="btn btn-quiet" href="#projections" aria-label="Open ALLPLAY custom model sheet"><TrendingUp size={15} /> Own model</a>
          <button className="btn btn-primary" onClick={() => {}}><RefreshCw size={15} /> Refresh</button>
          <button className="btn btn-quiet icon-btn" onClick={() => setInstallOpen(true)} aria-label="Installation help" title="Install dashboard"><Smartphone size={16} /></button>
        </div>
      </div>

      <div className="sport-tabs" role="tablist" aria-label="Sports">
        {SPORTS.map((item) => <button key={item.id} id={`sport-tab-${item.id}`} className={`sport-tab ${sport === item.id ? 'active' : ''}`} role="tab" aria-label={item.name} aria-selected={sport === item.id} aria-controls="sport-panel" tabIndex={sport === item.id ? 0 : -1} onClick={() => setSport(item.id)}>{item.short}</button>)}
      </div>

      <div id="sport-panel" role="tabpanel" aria-labelledby={`sport-tab-${sport}`}>
        <div style={{ height: 17 }} />
        <section className="summary-strip" aria-label={`${sportName} slate summary`}>
          <div className="summary-intro"><span className="summary-kicker">AT A GLANCE</span><span className="summary-sport">{sportName}</span></div>
          <div className="summary-metric"><strong>0</strong><span>EVENTS</span></div>
          <div className="summary-metric"><strong>0</strong><span>TOTALS</span></div>
          <div className="summary-metric"><strong>Locked</strong><span>PLAYER SALARIES</span></div>
          <a className="summary-metric summary-model-link" href="#projections"><strong>OPEN</strong><span>OWN MODEL SHEET</span></a>
        </section>
        <div className="content-grid">
          <div className="left-stack">
            <section className="panel" id="slate-section" aria-labelledby="slate-heading">
              <div className="panel-head panel-head-accent"><h2 className="panel-title" id="slate-heading"><CalendarDays size={16} /> {sportName} slate</h2><span className="panel-meta">{loading ? 'UPDATING' : '0 EVENTS'}</span></div>
              <div className="panel-body"><EmptyState icon={<CalendarDays size={17} />} title="No events on this slate" copy="There are no events returned for this date and sport selection." /></div>
            </section>
            <section className="panel" id="projections" aria-labelledby="projections-heading">
              <div className="panel-head panel-head-accent"><h2 className="panel-title" id="projections-heading"><TrendingUp size={16} /> ALLPLAY custom model</h2><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="panel-meta">RAW MATCHUP STATS</span><a href="#projections" className="btn btn-quiet" style={{ height: 29, fontSize: 10 }}>Full model sheet</a></div></div>
              <div className="panel-body" style={{ paddingTop: 12, paddingBottom: 15 }}>
                <ModelPreview />
                <details className="salary-only-disclosure"><summary>Salary-only view <span>Platform salary rows are not model projections</span></summary><div className="salary-locked-note"><ShieldCheck size={14} />Salary browsing stays behind verified member access. No forecast values appear here.</div></details>
                <div className="member-cta">
                  <div className="member-cta-copy"><h3 className="member-cta-title"><ShieldCheck size={15} />ALLPLAY model sheet is member-only</h3><p>Join to inspect ALLPLAY estimates, matchup adjustments and raw historical appearances. No provider forecast data is included.</p></div>
                  <div className="member-cta-action"><a href="#sign-in" className="btn btn-primary">Sign in to continue</a></div>
                </div>
              </div>
            </section>
          </div>
          <div className="right-stack">
            <section className="panel" id="news-section" aria-labelledby="news-heading">
              <div className="panel-head panel-head-accent"><h2 className="panel-title" id="news-heading"><Newspaper size={16} /> {sportName} news</h2><span className="panel-meta">0 STORIES</span></div>
              <div className="panel-body news-scroll" role="region" aria-labelledby="news-heading" tabIndex={0}><EmptyState icon={<Newspaper size={17} />} title="No recent news" copy="No news items were returned for this date and sport selection." /></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title"><Smartphone size={16} /> Your slate, one tap away</h2></div>
              <div className="panel-body"><p className="coverage-detail" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>Install this dashboard for a fast, focused home-screen launch on your devices.</p><button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setInstallOpen(true)}><ArrowDownToLine size={15} /> Install / setup help</button></div>
            </section>
          </div>
        </div>
      </div>
      <div className="footer-line">BUILT FOR THE MOMENT BEFORE LOCK · YOUR SLATE, YOUR CALL</div>
    </main>
    {installOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstallOpen(false); }}><section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title"><div className="modal-top"><div><div className="eyebrow">Ready when you are</div><h2 id="install-title">Keep your slate close</h2></div><button className="btn btn-quiet icon-btn" onClick={() => setInstallOpen(false)} aria-label="Close installation help">×</button></div><p className="modal-copy">Add the DFS cockpit to your home screen or desktop for a focused, app-like launch. Your date and league filters stay right here in the dashboard.</p><ol className="install-steps"><li>Open your browser menu near the address bar.</li><li>Choose <b>Install app</b> or <b>Add to home screen</b>.</li><li>Confirm the prompt to launch it as a standalone app.</li></ol><div className="install-note">Install availability depends on the browser and secure app hosting. On desktop, look for the install icon in the address bar.</div><div className="modal-actions"><button className="btn btn-quiet" onClick={() => setInstallOpen(false)}>Not now</button></div></section></div>}
  </div>;
}
