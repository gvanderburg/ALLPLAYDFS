import './_group.css';
import { useState, type KeyboardEvent } from 'react';
import {
  Activity, ArrowDownToLine, CalendarDays, ChevronRight, CircleHelp,
  Clock3, Film, LockKeyhole, Menu, Newspaper, RefreshCw, ShieldCheck,
  Smartphone, UserRound, X,
} from 'lucide-react';

const SPORTS = [
  { id: 'nfl', label: 'NFL' },
  { id: 'nhl', label: 'NHL' },
  { id: 'wnba', label: 'WNBA' },
  { id: 'nba', label: 'NBA' },
  { id: 'mlb', label: 'MLB' },
  { id: 'nascar', label: 'NASCAR' },
  { id: 'cfb', label: 'CFB' },
] as const;

const NAV = [
  { label: 'Dashboard', href: '#dashboard', icon: Activity },
  { label: 'Projections', href: '/projections', icon: LockKeyhole },
  { label: 'News', href: '/news', icon: Newspaper },
  { label: 'Takes', href: '/takes', icon: Film },
  { label: 'Feedback', href: '/feedback', icon: CircleHelp },
  { label: 'Account', href: '/account', icon: UserRound },
];

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function ClearDailyFlow() {
  const [date, setDate] = useState(todayLocal);
  const [sport, setSport] = useState<(typeof SPORTS)[number]['id']>('nfl');
  const [installOpen, setInstallOpen] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentSport = SPORTS.find((item) => item.id === sport)?.label ?? 'NFL';
  const dateObj = new Date(`${date}T12:00:00`);
  const chosenDate = dateObj.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const dayName = dateObj.toLocaleDateString(undefined, { weekday: 'long' });

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % SPORTS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + SPORTS.length) % SPORTS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SPORTS.length - 1;
    else return;
    event.preventDefault();
    const nextSport = SPORTS[next].id;
    setSport(nextSport);
    document.getElementById(`cdf-tab-${nextSport}`)?.focus();
  };

  return <div className="app-shell dashboard-extraction cdf" id="dashboard">
    <style>{`
      .cdf {
        --cdf-bg:#111211; --cdf-panel:#191a19; --cdf-raised:#222423; --cdf-line:#303330;
        --cdf-soft:#a4aaa2; --cdf-ink:#e7e9e6; --cdf-green:#56bd87;
        grid-template-columns:208px minmax(0,1fr); grid-template-rows:62px minmax(calc(100dvh - 62px),auto);
        background:#111211; color:var(--cdf-ink); min-height:100dvh;
      }
      .cdf * { box-sizing:border-box; }
      .cdf .topbar { grid-column:1/-1; grid-row:1; height:62px; padding:0 24px; background:#151615; border-color:#292b29; }
      .cdf .brand { gap:9px; text-decoration:none; }
      .cdf .brand-mark { width:27px; height:27px; border-radius:6px; background:var(--cdf-green); color:#132019; }
      .cdf .brand-name { color:var(--cdf-ink); font:700 16px 'Space Grotesk',sans-serif; letter-spacing:.025em; }
      .cdf .topbar-right { display:flex; align-items:center; gap:8px; }
      .cdf .install-top { min-height:35px; padding:0 13px; }
      .cdf .menu-toggle { display:none; }
      .cdf .side-rail { grid-column:1; grid-row:2; position:sticky; top:62px; align-self:start; height:calc(100dvh - 62px); min-height:500px; padding:27px 13px 18px; display:flex; flex-direction:column; background:#151615; border-right:1px solid var(--cdf-line); }
      .cdf .rail-caption { padding:0 10px; color:#a4aaa2; font:500 9px var(--app-font-mono); letter-spacing:.13em; }
      .cdf .rail-link { display:flex; align-items:center; gap:10px; min-height:40px; margin-top:4px; padding:0 10px; border-radius:5px; color:#b7bcb5; text-decoration:none; font-size:12px; }
      .cdf .rail-link:first-of-type { margin-top:12px; }
      .cdf .rail-link:hover { background:#222423; color:#f0f1ee; }
      .cdf .rail-link.selected { background:#20392b; color:#a0dfb8; }
      .cdf .rail-link.selected svg { color:var(--cdf-green); }
      .cdf .rail-note { display:flex; gap:9px; margin:23px 6px 0; padding:11px 10px; border:1px solid var(--cdf-line); border-radius:5px; color:#a8ada6; font-size:10px; line-height:1.5; }
      .cdf .rail-live-dot { width:7px; height:7px; margin-top:4px; flex:none; border-radius:50%; background:#d6ad62; }
      .cdf .rail-bottom { margin-top:auto; padding-top:15px; border-top:1px solid var(--cdf-line); }
      .cdf .rail-sports { padding:9px; color:#9ca29a; font:9px/1.8 var(--app-font-mono); }
      .cdf .main-wrap { grid-column:2; grid-row:2; width:min(1500px,100%); min-width:0; padding:29px clamp(18px,3vw,42px) 42px; }
      .cdf .sandbox-note { display:flex; align-items:center; gap:8px; margin-bottom:18px; padding:9px 12px; border-left:2px solid #d6ad62; background:#1d1c18; color:#c5b992; font:9px/1.5 var(--app-font-mono); letter-spacing:.025em; }
      .cdf .page-heading { margin-bottom:20px; }
      .cdf .page-heading h1 { margin:5px 0 8px; color:var(--cdf-ink); font-size:clamp(28px,3vw,38px); letter-spacing:-.045em; }
      .cdf .eyebrow { color:var(--cdf-green); }
      .cdf .subhead { max-width:670px; color:#b3b8b0; line-height:1.55; }
      .cdf .date-stamp { color:#d8dcd6; }
      .cdf .date-stamp .freshness { display:flex; align-items:center; gap:6px; color:#d6bd80; font:9px var(--app-font-mono); letter-spacing:.06em; }
      .cdf .control-bar { margin-bottom:14px; padding:10px 12px; border-radius:7px; background:var(--cdf-panel); border-color:var(--cdf-line); }
      .cdf .date-field { background:#131413; color:var(--cdf-ink); border-color:#373a37; }
      .cdf .btn { border-radius:5px; }
      .cdf .btn-quiet { background:transparent; color:#d3d7d0; }
      .cdf .btn-primary { background:var(--cdf-green); border-color:var(--cdf-green); color:#102117; font-weight:700; }
      .cdf .btn-primary:hover { background:#69ce94; border-color:#69ce94; }
      .cdf .sport-tabs { gap:5px; padding:2px 0 11px; overflow-x:auto; scrollbar-width:thin; scrollbar-color:#424742 transparent; }
      .cdf .sport-tab { min-width:67px; padding:10px 15px; border:1px solid transparent; border-radius:5px; background:#1b1d1b; color:#c5cac3; }
      .cdf .sport-tab:hover:not(.active) { background:#272a27; border-color:#414641; }
      .cdf .sport-tab.active { background:var(--cdf-green); color:#102117; border-color:var(--cdf-green); }
      .cdf .flow-grid { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(265px,.8fr); gap:14px; align-items:start; }
      .cdf .flow-stack { display:grid; gap:14px; min-width:0; }
      .cdf .panel { background:var(--cdf-panel); border-color:var(--cdf-line); border-radius:7px; overflow:hidden; }
      .cdf .panel-head { min-height:49px; padding:12px 15px; background:#202220; border-color:var(--cdf-line); }
      .cdf .panel-title { display:flex; align-items:center; gap:9px; color:#e6e9e4; font-size:13px; }
      .cdf .panel-title svg { color:var(--cdf-green); }
      .cdf .panel-meta { color:#a4aaa2; font:9px var(--app-font-mono); letter-spacing:.07em; }
      .cdf .panel-body { padding:15px; }
      .cdf .slate-empty { display:grid; grid-template-columns:42px minmax(0,1fr); gap:13px; align-items:start; padding:16px; border:1px solid #303330; border-radius:6px; background:#151615; }
      .cdf .empty-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:6px; background:#252925; color:#8fd5a9; }
      .cdf .slate-empty h3 { margin:1px 0 5px; color:#e3e6e0; font:600 13px 'Space Grotesk',sans-serif; }
      .cdf .slate-empty p { margin:0; color:#a5aaa3; font-size:11px; line-height:1.55; }
      .cdf .slate-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .cdf .slate-actions .btn { min-height:33px; font-size:10px; }
      .cdf .news-entry { display:flex; gap:12px; align-items:flex-start; padding:16px; border:1px solid #303330; border-radius:6px; background:#151615; }
      .cdf .news-entry-mark { display:grid; place-items:center; width:35px; height:35px; flex:none; border-radius:6px; background:#252925; color:#8fd5a9; }
      .cdf .news-entry h3 { margin:0 0 5px; color:#e4e7e1; font:600 13px 'Space Grotesk',sans-serif; }
      .cdf .news-entry p { margin:0 0 10px; color:#a5aaa3; font-size:11px; line-height:1.55; }
      .cdf .text-link { display:inline-flex; align-items:center; gap:5px; color:#8fd5a9; text-decoration:none; font-size:11px; font-weight:600; }
      .cdf .text-link:hover { color:#c0efd0; }
      .cdf .model-card { position:relative; padding:16px; border:1px solid #39483e; border-radius:6px; background:linear-gradient(130deg,#202c25,#1c211e 64%); }
      .cdf .model-kicker { color:#9ed7b2; font:9px var(--app-font-mono); letter-spacing:.11em; }
      .cdf .model-card h3 { margin:7px 0 7px; color:#eff2ed; font:600 16px 'Space Grotesk',sans-serif; }
      .cdf .model-card p { margin:0; color:#b6c0b8; font-size:11px; line-height:1.6; }
      .cdf .model-lock { display:flex; gap:8px; align-items:flex-start; margin-top:14px; padding-top:12px; border-top:1px solid #3a473d; color:#d1d8d1; font-size:10px; line-height:1.5; }
      .cdf .model-lock svg { flex:none; color:#9ed7b2; }
      .cdf .model-action { margin-top:13px; }
      .cdf .model-action .btn { width:100%; justify-content:center; }
      .cdf .micro-note { margin:10px 0 0; color:#a4aaa2; font-size:10px; line-height:1.5; }
      .cdf .footer-line { padding-top:20px; color:#8d938c; font:9px var(--app-font-mono); letter-spacing:.07em; }
      .cdf .install-modal { background:#191a19; border-color:#414440; }
      .cdf button:focus-visible, .cdf a:focus-visible, .cdf input:focus-visible { outline:2px solid #90dfb0; outline-offset:3px; }
      @media (max-width: 950px) {
        .cdf { grid-template-columns:minmax(0,1fr); grid-template-rows:62px auto; }
        .cdf .side-rail { display:none; }
        .cdf .main-wrap { grid-column:1; }
        .cdf .flow-grid { grid-template-columns:minmax(0,1fr); }
      }
      @media (max-width: 620px) {
        .cdf { grid-template-rows:58px auto; }
        .cdf .topbar { height:58px; padding:0 11px; gap:8px; }
        .cdf .topbar-right { gap:6px; }
        .cdf .install-top { min-height:33px; padding:0 9px; font-size:10px; white-space:nowrap; }
        .cdf .menu-toggle { display:inline-flex; width:32px; min-width:32px; height:32px; padding:0; align-items:center; justify-content:center; }
        .cdf .topbar .brand-name { font-size:14px; }
        .cdf .main-wrap { padding:20px 12px 32px; }
        .cdf .sandbox-note { align-items:flex-start; margin-bottom:15px; }
        .cdf .page-heading { display:block; margin-bottom:15px; }
        .cdf .page-heading h1 { font-size:clamp(28px,8vw,35px); }
        .cdf .date-stamp { text-align:left; margin-top:11px; }
        .cdf .control-bar { align-items:flex-start; gap:9px; }
        .cdf .action-group { display:grid; grid-template-columns:1fr 1fr; width:100%; }
        .cdf .action-group .btn { justify-content:center; }
        .cdf .sport-tabs { margin-right:-12px; padding-right:12px; }
        .cdf .sport-tab { min-height:40px; min-width:61px; padding:9px 12px; }
        .cdf .panel-head { padding:11px 12px; }
        .cdf .panel-body { padding:12px; }
        .cdf .slate-empty { grid-template-columns:34px minmax(0,1fr); gap:10px; padding:12px; }
        .cdf .empty-icon { width:33px; height:33px; }
        .cdf .slate-actions { display:grid; grid-template-columns:1fr; }
        .cdf .slate-actions .btn { justify-content:center; }
        .cdf .rail-mobile-open { display:block; }
        .cdf .side-rail.rail-mobile-open { position:fixed; z-index:30; top:58px; left:0; bottom:0; width:min(250px,82vw); height:auto; min-height:0; box-shadow:12px 0 28px rgba(0,0,0,.3); }
      }
      @media (prefers-reduced-motion: reduce) { .cdf *, .cdf *::before, .cdf *::after { scroll-behavior:auto !important; animation-duration:.01ms !important; } }
    `}</style>

    <header className="topbar">
      <a href="#dashboard" className="brand" aria-label="ALLPLAY Dashboard"><span className="brand-mark"><Activity size={17} strokeWidth={2.4} /></span><span className="brand-name">ALLPLAY</span></a>
      <div className="topbar-right">
        <span className="today-label">Your sports, at a glance</span>
        <button className="btn btn-quiet menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen}><Menu size={16} /></button>
        <button className="btn btn-primary install-top" onClick={() => setInstallOpen(true)}><ArrowDownToLine size={14} /> Install app</button>
      </div>
    </header>

    <aside className={`side-rail ${menuOpen ? 'rail-mobile-open' : ''}`} aria-label="Dashboard navigation">
      <div className="rail-caption">YOUR ALLPLAY</div>
      {NAV.map(({ label, href, icon: Icon }, index) => <a key={label} className={`rail-link ${index === 0 ? 'selected' : ''}`} href={href} aria-current={index === 0 ? 'page' : undefined} onClick={() => setMenuOpen(false)}><Icon size={15} />{label}</a>)}
      <div className="rail-note"><span className="rail-live-dot" /><span>Slate status is shown here. News is free; projections are member-only.</span></div>
      <div className="rail-bottom"><span className="rail-caption">SEVEN SPORTS</span><div className="rail-sports">NFL · NHL · WNBA<br />NBA · MLB · NASCAR · CFB</div></div>
    </aside>

    <main className="main-wrap">
      <div className="sandbox-note"><CircleHelp size={13} /> PREVIEW MODE · Live slate and news feeds aren’t connected in this mockup.</div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your daily slate <span style={{ color: 'var(--slate-muted)' }}>/</span> {dayName}</div>
          <h1>A clearer view of today.</h1>
          <p className="subhead">Pick a league and date. Start with the slate, then follow the details that matter to you.</p>
        </div>
        <div className="date-stamp"><div>{chosenDate}</div><div className="freshness" style={{ marginTop: 6 }}><Clock3 size={12} /> DATA STATUS UNAVAILABLE</div></div>
      </div>

      <div className="control-bar">
        <div className="filter-group"><label className="micro-label" htmlFor="cdf-date">Slate date</label><input id="cdf-date" className="date-field" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="action-group">
          <a className="btn btn-quiet" href="/news"><Newspaper size={14} /> Free news</a>
          <button className="btn btn-primary" onClick={() => { setRefreshRequested(true); window.setTimeout(() => setRefreshRequested(false), 2200); }}><RefreshCw size={14} /> {refreshRequested ? 'Preview only' : 'Refresh'}</button>
        </div>
      </div>

      <div className="sport-tabs" role="tablist" aria-label="Choose a sport">
        {SPORTS.map((item, index) => <button key={item.id} id={`cdf-tab-${item.id}`} className={`sport-tab ${sport === item.id ? 'active' : ''}`} type="button" role="tab" aria-selected={sport === item.id} aria-controls="cdf-sport-panel" tabIndex={sport === item.id ? 0 : -1} onClick={() => setSport(item.id)} onKeyDown={(event) => handleTabKey(event, index)}>{item.label}</button>)}
      </div>

      <section id="cdf-sport-panel" role="tabpanel" aria-labelledby={`cdf-tab-${sport}`}>
        <div className="flow-grid">
          <div className="flow-stack">
            <section className="panel" aria-labelledby="cdf-slate-heading">
              <div className="panel-head panel-head-accent"><h2 className="panel-title" id="cdf-slate-heading"><CalendarDays size={16} /> {currentSport} slate</h2><span className="panel-meta">NOT AVAILABLE</span></div>
              <div className="panel-body">
                <div className="slate-empty">
                  <div className="empty-icon"><CalendarDays size={17} /></div>
                  <div><h3>No slate data in this preview</h3><p>We can’t confirm games, totals, or available lines for {currentSport} on {chosenDate}. Nothing is being filled in with sample matchups.</p>
                    <div className="slate-actions"><button className="btn btn-quiet" onClick={() => { setRefreshRequested(true); window.setTimeout(() => setRefreshRequested(false), 2200); }}><RefreshCw size={13} /> Try again</button><a className="btn btn-quiet" href="/news"><Newspaper size={13} /> Browse free news</a></div>
                  </div>
                </div>
              </div>
            </section>
            <section className="panel" aria-labelledby="cdf-news-heading">
              <div className="panel-head panel-head-accent"><h2 className="panel-title" id="cdf-news-heading"><Newspaper size={16} /> Follow the story</h2><span className="panel-meta">FREE</span></div>
              <div className="panel-body">
                <div className="news-entry"><div className="news-entry-mark"><Newspaper size={16} /></div><div><h3>Sports news, without a paywall</h3><p>Go straight to the ALLPLAY news desk for the latest stories. This preview doesn’t contain live headlines.</p><a className="text-link" href="/news">Open free news <ChevronRight size={14} /></a></div></div>
              </div>
            </section>
          </div>
          <div className="flow-stack">
            <section className="panel" aria-labelledby="cdf-projections-heading">
              <div className="panel-head panel-head-accent"><h2 className="panel-title" id="cdf-projections-heading"><Activity size={16} /> ALLPLAY projections</h2><span className="panel-meta">MEMBER ACCESS</span></div>
              <div className="panel-body">
                <div className="model-card">
                  <span className="model-kicker">A SEPARATE RESEARCH SHEET</span>
                  <h3>Our model, with its working shown.</h3>
                  <p>ALLPLAY’s own matchup estimates and supporting research live on a dedicated projections sheet. Forecasts aren’t shown on this dashboard.</p>
                  <div className="model-lock"><ShieldCheck size={15} /><span>The full projections sheet requires verified member access. No provider forecasts are included.</span></div>
                  <div className="model-action"><a className="btn btn-primary" href="/projections">About the projections sheet <ChevronRight size={14} /></a></div>
                </div>
                <p className="micro-note">Free news stays open to everyone. Projection access is handled separately through your account.</p>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title"><Smartphone size={15} /> Take ALLPLAY with you</h2></div>
              <div className="panel-body"><p className="micro-note" style={{ margin: '0 0 12px' }}>Add a quick launch to your home screen or desktop.</p><button className="btn btn-quiet" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setInstallOpen(true)}><ArrowDownToLine size={14} /> Install / setup help</button></div>
            </section>
          </div>
        </div>
      </section>
      <div className="footer-line">ALLPLAY · YOUR SLATE, YOUR CALL</div>

      {installOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstallOpen(false); }}>
        <section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="cdf-install-title">
          <div className="modal-top"><div><div className="eyebrow">Ready when you are</div><h2 id="cdf-install-title">Keep ALLPLAY close</h2></div><button className="btn btn-quiet icon-btn" onClick={() => setInstallOpen(false)} aria-label="Close install help"><X size={16} /></button></div>
          <p className="modal-copy">Add ALLPLAY to your home screen or desktop for a fast, app-like launch.</p>
          <ol className="install-steps"><li>Open your browser menu near the address bar.</li><li>Choose <b>Install app</b> or <b>Add to home screen</b>.</li><li>Confirm the prompt to launch ALLPLAY on its own.</li></ol>
          <div className="install-note">Install availability depends on your browser and device. On desktop, look for the install icon in the address bar.</div>
          <div className="modal-actions"><button className="btn btn-quiet" onClick={() => setInstallOpen(false)}>Done</button></div>
        </section>
      </div>}
    </main>
  </div>;
}
