import { useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, Film, LockKeyhole, Newspaper, RefreshCw, ShieldCheck,
  TrendingUp, X,
} from 'lucide-react';

const SPORTS = ['NFL', 'NHL', 'WNBA', 'NBA', 'MLB', 'NASCAR', 'CFB'];

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function SlateRefined() {
  const [sport, setSport] = useState('NFL');
  const [date, setDate] = useState(localDate);
  const [refreshing, setRefreshing] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const selectedDate = new Date(`${date}T12:00:00`);
  const day = selectedDate.toLocaleDateString(undefined, { weekday: 'long' });
  const prettyDate = selectedDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  const retry = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 900);
  };

  return <div className="sr-app">
    <style>{`
      .sr-app {
        --ink:#edf0eb; --muted:#a6afa6; --dim:#7f8981; --base:#202521;
        --rail:#1b201d; --panel:#272e29; --raised:#303832; --line:#3d4840;
        --mint:#8dd7aa; --mint-ink:#15241a; --amber:#d8ba79;
        display:grid; grid-template-columns:218px minmax(0,1fr); grid-template-rows:66px 1fr;
        min-height:100dvh; background:var(--base); color:var(--ink);
        font-family:'DM Sans',ui-sans-serif,system-ui,sans-serif; font-size:13px;
      }
      .sr-app * { box-sizing:border-box; }
      .sr-app button,.sr-app a,.sr-app input { font:inherit; }
      .sr-topbar { grid-column:1/-1; display:flex; align-items:center; justify-content:space-between; padding:0 30px; background:#1d231f; border-bottom:1px solid #354039; }
      .sr-brand { display:flex; gap:10px; align-items:center; color:var(--ink); text-decoration:none; font-size:16px; font-weight:750; letter-spacing:.04em; }
      .sr-mark { display:grid; place-items:center; width:30px; height:30px; border-radius:7px; background:var(--mint); color:#17251b; }
      .sr-top-actions { display:flex; align-items:center; gap:10px; }
      .sr-top-caption { color:var(--muted); font-size:11px; letter-spacing:.025em; margin-right:6px; }
      .sr-pill { display:inline-flex; align-items:center; gap:7px; min-height:30px; padding:0 11px; border:1px solid var(--line); border-radius:5px; color:#c6cec7; text-decoration:none; font-size:11px; }
      .sr-pill:hover { background:var(--raised); color:var(--ink); }
      .sr-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:34px; padding:0 12px; border:1px solid var(--line); border-radius:5px; background:var(--raised); color:var(--ink); cursor:pointer; font-size:11px; font-weight:650; transition:transform .18s,background .18s; }
      .sr-button:hover { transform:translateY(-1px); background:#3a453d; }
      .sr-button-primary { border-color:var(--mint); background:var(--mint); color:var(--mint-ink); }
      .sr-button-primary:hover { background:#a0e3b8; }
      .sr-rail { grid-column:1; grid-row:2; display:flex; flex-direction:column; min-height:calc(100dvh - 66px); padding:28px 13px 18px; background:var(--rail); border-right:1px solid #354039; }
      .sr-overline { color:var(--dim); font-size:9px; font-weight:700; letter-spacing:.15em; text-transform:uppercase; }
      .sr-rail .sr-overline { padding:0 10px; margin-bottom:12px; }
      .sr-nav { display:grid; gap:4px; }
      .sr-nav a { display:flex; align-items:center; gap:11px; min-height:39px; padding:0 11px; border-radius:5px; color:#b5beb6; text-decoration:none; font-size:12px; }
      .sr-nav a:hover { background:#29312b; color:var(--ink); }
      .sr-nav a.active { background:#2a3b30; color:#b8edc9; }
      .sr-nav a.active svg { color:var(--mint); }
      .sr-rail-status { display:flex; gap:9px; margin:23px 5px 0; padding:12px 10px; border:1px solid var(--line); border-radius:5px; color:var(--muted); font-size:10px; line-height:1.5; }
      .sr-status-dot { flex:none; width:7px; height:7px; margin-top:4px; border-radius:50%; background:var(--amber); }
      .sr-rail-bottom { margin-top:auto; padding:16px 10px 0; border-top:1px solid var(--line); }
      .sr-sports-note { margin-top:9px; color:#929d94; font-size:10px; line-height:1.8; }
      .sr-main { width:min(1480px,100%); padding:35px clamp(20px,3.1vw,48px) 42px; }
      .sr-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:24px; }
      .sr-crumb { color:var(--mint); font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      .sr-heading h1 { margin:8px 0 7px; font-family:'Space Grotesk',ui-sans-serif,sans-serif; font-size:clamp(31px,3.2vw,43px); line-height:1.04; letter-spacing:-.05em; font-weight:600; }
      .sr-heading p { max-width:610px; margin:0; color:#b4bdb5; line-height:1.55; font-size:12px; }
      .sr-date-mark { min-width:194px; padding:0 0 3px 17px; border-left:1px solid var(--line); }
      .sr-date-mark strong { display:block; font-size:13px; font-weight:600; }
      .sr-date-mark span { display:flex; align-items:center; gap:6px; margin-top:7px; color:var(--muted); font-size:9px; letter-spacing:.08em; text-transform:uppercase; }
      .sr-date-mark span svg { color:var(--amber); }
      .sr-controls { display:flex; align-items:end; justify-content:space-between; gap:16px; padding:12px 14px; border:1px solid var(--line); border-radius:7px; background:var(--panel); }
      .sr-field label { display:block; margin:0 0 6px; color:var(--muted); font-size:9px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
      .sr-field input { height:34px; width:168px; padding:0 9px; border:1px solid #49554b; border-radius:4px; background:#202722; color:var(--ink); color-scheme:dark; }
      .sr-control-actions { display:flex; gap:8px; }
      .sr-tabs { display:flex; gap:5px; overflow-x:auto; margin:14px 0 18px; padding:0 0 3px; scrollbar-width:thin; }
      .sr-tab { flex:none; min-width:62px; height:37px; border:1px solid transparent; border-radius:5px; background:#2a312c; color:#bec7bf; font-size:10px; font-weight:700; letter-spacing:.05em; cursor:pointer; }
      .sr-tab:hover { border-color:#536057; }
      .sr-tab[aria-selected="true"] { background:var(--mint); color:var(--mint-ink); }
      .sr-summary { display:grid; grid-template-columns:minmax(210px,1.5fr) repeat(3,minmax(105px,.68fr)); margin-bottom:17px; overflow:hidden; border:1px solid var(--line); border-radius:7px; background:#252c27; }
      .sr-summary-intro,.sr-metric { display:flex; flex-direction:column; justify-content:center; min-height:76px; padding:13px 17px; }
      .sr-summary-intro { gap:5px; }
      .sr-summary-intro span:first-child { color:var(--muted); font-size:9px; font-weight:700; letter-spacing:.12em; }
      .sr-summary-intro strong { font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:600; }
      .sr-metric { border-left:1px solid var(--line); }
      .sr-metric strong { color:#dce4dc; font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:600; }
      .sr-metric span { margin-top:3px; color:var(--muted); font-size:8px; font-weight:700; letter-spacing:.09em; }
      .sr-grid { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(270px,.78fr); align-items:start; gap:15px; }
      .sr-stack { display:grid; gap:15px; min-width:0; }
      .sr-panel { overflow:hidden; border:1px solid var(--line); border-radius:7px; background:var(--panel); }
      .sr-panel-head { display:flex; align-items:center; justify-content:space-between; min-height:48px; padding:0 15px; border-bottom:1px solid var(--line); background:#2b332d; }
      .sr-panel-title { display:flex; align-items:center; gap:9px; margin:0; font-size:12px; font-weight:650; }
      .sr-panel-title svg { color:var(--mint); }
      .sr-panel-meta { color:#a8b2a9; font-size:9px; font-weight:650; letter-spacing:.09em; }
      .sr-panel-body { padding:15px; }
      .sr-empty { display:grid; grid-template-columns:42px minmax(0,1fr); gap:13px; align-items:start; padding:17px; border:1px solid #3b463e; border-radius:6px; background:#202722; }
      .sr-empty-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:6px; background:#2e3a31; color:var(--mint); }
      .sr-empty h3 { margin:1px 0 5px; font-family:'Space Grotesk',sans-serif; font-size:14px; font-weight:600; }
      .sr-empty p { max-width:540px; margin:0; color:#aab4ab; font-size:11px; line-height:1.6; }
      .sr-empty-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:13px; }
      .sr-empty-actions .sr-button { min-height:30px; font-size:10px; }
      .sr-model { padding:17px; border:1px solid #435449; border-radius:6px; background:linear-gradient(145deg,#2d3c32,#252e28 72%); }
      .sr-model-kicker { color:#a9dfba; font-size:9px; font-weight:700; letter-spacing:.12em; }
      .sr-model h3 { margin:8px 0 7px; font-family:'Space Grotesk',sans-serif; font-size:17px; font-weight:600; letter-spacing:-.02em; }
      .sr-model p { margin:0; color:#bac5bc; font-size:11px; line-height:1.6; }
      .sr-lock-note { display:flex; gap:8px; margin-top:15px; padding-top:13px; border-top:1px solid #46544a; color:#d5ded6; font-size:10px; line-height:1.5; }
      .sr-lock-note svg { flex:none; color:var(--mint); }
      .sr-model-link { display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:14px; text-decoration:none; }
      .sr-news-copy { display:flex; gap:12px; align-items:flex-start; padding:14px; border:1px solid var(--line); border-radius:6px; background:#202722; }
      .sr-news-icon { display:grid; place-items:center; flex:none; width:34px; height:34px; border-radius:6px; background:#303a32; color:var(--mint); }
      .sr-news-copy strong { display:block; margin:1px 0 5px; font-size:12px; }
      .sr-news-copy p { margin:0; color:#abb5ac; font-size:10px; line-height:1.55; }
      .sr-text-link { display:inline-flex; align-items:center; gap:5px; margin-top:10px; color:#9ee1b5; font-size:10px; font-weight:700; text-decoration:none; }
      .sr-footnote { margin:12px 0 0; color:#939e95; font-size:10px; line-height:1.55; }
      .sr-footer { margin-top:21px; color:#778279; font-size:9px; letter-spacing:.11em; }
      .sr-modal-bg { position:fixed; z-index:20; inset:0; display:grid; place-items:center; padding:20px; background:rgba(8,12,9,.72); }
      .sr-modal { width:min(460px,100%); padding:22px; border:1px solid #526056; border-radius:9px; background:#252d27; box-shadow:0 22px 70px rgba(0,0,0,.35); }
      .sr-modal-head { display:flex; justify-content:space-between; align-items:flex-start; }
      .sr-modal h2 { margin:7px 0 0; font:600 23px 'Space Grotesk',sans-serif; }
      .sr-modal p,.sr-modal li { color:#b7c1b9; font-size:12px; line-height:1.6; }
      .sr-modal ol { padding-left:20px; }
      .sr-modal-actions { display:flex; justify-content:flex-end; margin-top:20px; }
      .sr-close { display:grid; place-items:center; width:30px; height:30px; padding:0; border:1px solid var(--line); border-radius:5px; background:transparent; color:var(--ink); cursor:pointer; }
      .sr-spin { animation:sr-rotate .8s linear infinite; }
      @keyframes sr-rotate { to { transform:rotate(360deg); } }
      .sr-app :focus-visible { outline:2px solid var(--mint); outline-offset:3px; }
      @media(max-width:940px) { .sr-app { grid-template-columns:180px minmax(0,1fr); } .sr-grid { grid-template-columns:minmax(0,1fr); } .sr-main { padding:28px 22px 36px; } }
      @media(max-width:680px) {
        .sr-app { grid-template-columns:minmax(0,1fr); grid-template-rows:58px auto; }
        .sr-topbar { padding:0 14px; } .sr-top-caption,.sr-pill { display:none; }
        .sr-rail { display:none; } .sr-main { grid-column:1; padding:23px 14px 30px; }
        .sr-heading { display:block; margin-bottom:18px; } .sr-heading h1 { font-size:34px; }
        .sr-date-mark { margin-top:15px; padding:0; border:0; }
        .sr-controls { display:grid; grid-template-columns:1fr; align-items:stretch; }
        .sr-field input { width:100%; } .sr-control-actions { display:grid; grid-template-columns:1fr 1fr; }
        .sr-control-actions .sr-button { width:100%; }
        .sr-tabs { margin-right:-14px; padding-right:14px; }
        .sr-summary { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .sr-summary-intro { grid-column:1/-1; min-height:auto; padding:12px 14px; border-bottom:1px solid var(--line); }
        .sr-summary-intro strong { font-size:16px; }
        .sr-metric { min-height:66px; padding:11px 12px; } .sr-metric:first-of-type { border-left:0; }
        .sr-panel-head { padding:0 12px; } .sr-panel-body { padding:12px; }
        .sr-empty { grid-template-columns:34px minmax(0,1fr); gap:10px; padding:12px; }
        .sr-empty-icon { width:32px; height:32px; }
        .sr-empty-actions { display:grid; grid-template-columns:1fr; }
      }
      @media(prefers-reduced-motion:reduce) { .sr-app * { scroll-behavior:auto!important; transition:none!important; } }
    `}</style>

    <header className="sr-topbar">
      <a className="sr-brand" href="#overview" aria-label="ALLPLAY home"><span className="sr-mark"><Activity size={17} strokeWidth={2.5} /></span>ALLPLAY</a>
      <div className="sr-top-actions">
        <span className="sr-top-caption">Your sports, at a glance</span>
        <a className="sr-pill" href="#model"><TrendingUp size={13} /> Model</a>
        <a className="sr-pill" href="#news"><Newspaper size={13} /> News</a>
        <button className="sr-button sr-button-primary" onClick={() => setInstallOpen(true)}><ArrowDownToLine size={14} /> Install app</button>
      </div>
    </header>

    <aside className="sr-rail" aria-label="Dashboard navigation">
      <div className="sr-overline">Your workspace</div>
      <nav className="sr-nav">
        <a href="#overview" className="active" aria-current="page"><Activity size={15} />Overview</a>
        <a href="#slate"><CalendarDays size={15} />Live slate</a>
        <a href="#model"><LockKeyhole size={15} />Projections</a>
        <a href="#news"><Newspaper size={15} />News desk</a>
        <a href="#takes"><Film size={15} />Game takes</a>
        <a href="#help"><CircleHelp size={15} />Feedback</a>
      </nav>
      <div className="sr-rail-status"><span className="sr-status-dot" /><span>Slate status is shown here. News is free; player research requires verified member access.</span></div>
      <div className="sr-rail-bottom"><div className="sr-overline">Seven sports</div><div className="sr-sports-note">NFL · NHL · WNBA<br />NBA · MLB · NASCAR · CFB</div></div>
    </aside>

    <main className="sr-main" id="overview">
      <div className="sr-heading">
        <div>
          <div className="sr-crumb">Your daily slate <span style={{ color: 'var(--dim)' }}>/</span> {day}</div>
          <h1>Slate, in focus.</h1>
          <p>Start with today’s matchups. Move into ALLPLAY research when you’re ready to look closer.</p>
        </div>
        <div className="sr-date-mark"><strong>{prettyDate}</strong><span><Clock3 size={12} /> Feed status unavailable in preview</span></div>
      </div>

      <div className="sr-controls">
        <div className="sr-field"><label htmlFor="sr-date">Slate date</label><input id="sr-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="sr-control-actions">
          <a className="sr-button" href="#news"><Newspaper size={14} /> Free news</a>
          <button className="sr-button" onClick={retry} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'sr-spin' : ''} />{refreshing ? 'Checking…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="sr-tabs" role="tablist" aria-label="Choose a sport">
        {SPORTS.map((item) => <button key={item} className="sr-tab" role="tab" aria-selected={sport === item} onClick={() => setSport(item)}>{item}</button>)}
      </div>

      <section className="sr-summary" aria-label={`${sport} slate summary`}>
        <div className="sr-summary-intro"><span>AT A GLANCE</span><strong>{sport} · {day}</strong></div>
        <div className="sr-metric"><strong>—</strong><span>CONFIRMED GAMES</span></div>
        <div className="sr-metric"><strong>—</strong><span>AVAILABLE TOTALS</span></div>
        <div className="sr-metric"><strong>Member</strong><span>PLAYER RESEARCH</span></div>
      </section>

      <div className="sr-grid">
        <div className="sr-stack">
          <section className="sr-panel" id="slate" aria-labelledby="sr-slate-title">
            <div className="sr-panel-head"><h2 className="sr-panel-title" id="sr-slate-title"><CalendarDays size={16} /> {sport} slate</h2><span className="sr-panel-meta">AWAITING VERIFIED FEED</span></div>
            <div className="sr-panel-body">
              <div className="sr-empty">
                <div className="sr-empty-icon"><CalendarDays size={17} /></div>
                <div><h3>No confirmed games in this preview</h3><p>We can’t verify {sport} matchups, totals, or lines for {prettyDate} here. We’ve left the slate clear rather than filling it with sample games.</p>
                  <div className="sr-empty-actions"><button className="sr-button" onClick={retry}><RefreshCw size={13} />{refreshing ? 'Checking…' : 'Check again'}</button><button className="sr-button" onClick={() => setDate(localDate())}>Return to today <ArrowRight size={13} /></button></div>
                </div>
              </div>
            </div>
          </section>

          <section className="sr-panel" id="news" aria-labelledby="sr-news-title">
            <div className="sr-panel-head"><h2 className="sr-panel-title" id="sr-news-title"><Newspaper size={16} /> Stay in the story</h2><span className="sr-panel-meta">FREE</span></div>
            <div className="sr-panel-body">
              <div className="sr-news-copy"><div className="sr-news-icon"><Newspaper size={16} /></div><div><strong>Sports news stays open to everyone.</strong><p>Head to the ALLPLAY news desk for current stories. Headlines aren’t connected in this component preview.</p><a className="sr-text-link" href="#news">Open free news <ArrowRight size={13} /></a></div></div>
            </div>
          </section>
        </div>

        <div className="sr-stack">
          <section className="sr-panel" id="model" aria-labelledby="sr-model-title">
            <div className="sr-panel-head"><h2 className="sr-panel-title" id="sr-model-title"><TrendingUp size={16} /> ALLPLAY model</h2><span className="sr-panel-meta">MEMBER ACCESS</span></div>
            <div className="sr-panel-body">
              <div className="sr-model"><span className="sr-model-kicker">A SEPARATE RESEARCH SHEET</span><h3>Our estimates, with the work in view.</h3><p>Explore ALLPLAY’s own matchup estimates and supporting historical research on a dedicated model sheet. Provider forecasts are not included.</p>
                <div className="sr-lock-note"><ShieldCheck size={15} /><span>Player estimates remain hidden until membership is verified. No gated data is shown in this preview.</span></div>
                <a className="sr-button sr-button-primary sr-model-link" href="#projections">About the model sheet <ArrowRight size={14} /></a>
              </div>
              <p className="sr-footnote">Free slate context and news stay separate from member-only projection data.</p>
            </div>
          </section>
          <section className="sr-panel">
            <div className="sr-panel-head"><h2 className="sr-panel-title"><ArrowDownToLine size={15} /> Take ALLPLAY with you</h2><ChevronDown size={14} color="var(--muted)" /></div>
            <div className="sr-panel-body"><p className="sr-footnote" style={{ marginTop: 0, marginBottom: 13 }}>Keep your slate one tap away with a home-screen or desktop shortcut.</p><button className="sr-button" style={{ width: '100%' }} onClick={() => setInstallOpen(true)}><ArrowDownToLine size={14} /> Install / setup help</button></div>
          </section>
        </div>
      </div>
      <div className="sr-footer">ALLPLAY · YOUR SLATE, YOUR CALL</div>
    </main>

    {installOpen && <div className="sr-modal-bg" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstallOpen(false); }}>
      <section className="sr-modal" role="dialog" aria-modal="true" aria-labelledby="sr-install-title">
        <div className="sr-modal-head"><div><div className="sr-crumb">Ready when you are</div><h2 id="sr-install-title">Keep ALLPLAY close.</h2></div><button className="sr-close" onClick={() => setInstallOpen(false)} aria-label="Close install help"><X size={15} /></button></div>
        <p>Add the dashboard to your home screen or desktop for a focused launch.</p>
        <ol><li>Open your browser menu near the address bar.</li><li>Choose <b>Install app</b> or <b>Add to home screen</b>.</li><li>Confirm to open ALLPLAY in its own window.</li></ol>
        <div className="sr-modal-actions"><button className="sr-button sr-button-primary" onClick={() => setInstallOpen(false)}><Check size={14} /> Got it</button></div>
      </section>
    </div>}
  </div>;
}
