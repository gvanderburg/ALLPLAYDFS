import { useState, type KeyboardEvent } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, CalendarDays, Check, ChevronRight,
  CircleHelp, Clock3, Film, LockKeyhole, Menu, Newspaper, RefreshCw,
  ShieldCheck, Smartphone, X,
} from 'lucide-react';

const SPORTS = ['NFL', 'NHL', 'WNBA', 'NBA', 'MLB', 'NASCAR', 'CFB'] as const;

const HISTORICAL_NHL = [
  { time: '3:00 PM', venue: 'Little Caesars Arena', away: ['NJD', 'New Jersey Devils', 5], home: ['DET', 'Detroit Red Wings', 4], total: '6.5', spread: '−1.5' },
  { time: '3:15 PM', venue: 'Nationwide Arena', away: ['FLA', 'Florida Panthers', 7], home: ['CBJ', 'Columbus Blue Jackets', 3], total: '5.5', spread: '−1.5' },
  { time: '3:30 PM', venue: 'Bell Centre', away: ['BUF', 'Buffalo Sabres', 3], home: ['MTL', 'Montreal Canadiens', 4], total: '6.5', spread: '−1.5' },
  { time: '3:45 PM', venue: 'Lenovo Center', away: ['WSH', 'Washington Capitals', 2], home: ['CAR', 'Carolina Hurricanes', 4], total: '6.5', spread: '−1.5' },
  { time: '4:00 PM', venue: 'Xfinity Mobile Arena', away: ['SEA', 'Seattle Kraken', 3], home: ['PHI', 'Philadelphia Flyers', 2], total: '5.5', spread: '+1.5' },
  { time: '4:15 PM', venue: 'Madison Square Garden', away: ['TBL', 'Tampa Bay Lightning', 1], home: ['NYR', 'New York Rangers', 4], total: '5.5', spread: '+1.5' },
  { time: '4:30 PM', venue: 'Canadian Tire Centre', away: ['STL', 'St. Louis Blues', 7], home: ['OTT', 'Ottawa Senators', 2], total: '5.5', spread: '+1.5' },
  { time: '4:45 PM', venue: 'UBS Arena', away: ['VAN', 'Vancouver Canucks', 2], home: ['NYI', 'New York Islanders', 3], total: '5.5', spread: '—' },
] as const;

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function RedBlack() {
  const [date, setDate] = useState(todayLocal);
  const [sport, setSport] = useState<(typeof SPORTS)[number]>('NHL');
  const [installOpen, setInstallOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const chosenDate = new Date(`${date}T12:00:00`);
  const dateLabel = chosenDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const weekday = chosenDate.toLocaleDateString(undefined, { weekday: 'long' });

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 700);
  };

  const onSportKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % SPORTS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + SPORTS.length) % SPORTS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SPORTS.length - 1;
    else return;
    event.preventDefault();
    const nextSport = SPORTS[next];
    setSport(nextSport);
    setShowHistory(nextSport === 'NHL');
    document.getElementById(`rb-tab-${SPORTS[next]}`)?.focus();
  };

  return <div className="rb-app" id="overview">
    <style>{`
      .rb-app {
        --rb-bg:#111112; --rb-rail:#171718; --rb-panel:#1c1c1e; --rb-raised:#242426;
        --rb-line:#343437; --rb-ink:#f1efee; --rb-muted:#aaa6a5; --rb-dim:#858181;
        --rb-red:#ed493f; --rb-red-soft:#ff786d; --rb-red-ink:#1b1110; --rb-warm:#d2b393;
        min-height:100dvh; display:grid; grid-template-columns:214px minmax(0,1fr); grid-template-rows:62px auto 1fr;
        color:var(--rb-ink); background:var(--rb-bg); font:13px/1.45 'DM Sans',ui-sans-serif,system-ui,sans-serif;
      }
      .rb-app * { box-sizing:border-box; }
      .rb-app button,.rb-app input { font:inherit; }
      .rb-app a { color:inherit; }
      .rb-top { grid-column:1/-1; display:flex; align-items:center; justify-content:space-between; padding:0 25px; background:#181819; border-bottom:1px solid #303033; }
      .rb-brand { display:flex; align-items:center; gap:10px; color:var(--rb-ink); text-decoration:none; font:700 16px 'Space Grotesk',sans-serif; letter-spacing:.035em; }
      .rb-mark { display:grid; place-items:center; width:29px; height:29px; border-radius:5px; background:var(--rb-red); color:#200d0b; }
      .rb-top-right { display:flex; align-items:center; gap:9px; }
      .rb-top-note { color:var(--rb-muted); margin-right:8px; font-size:11px; }
      .rb-link-pill,.rb-btn { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:0 11px; border:1px solid var(--rb-line); border-radius:5px; color:#dedad9; background:transparent; text-decoration:none; font-size:11px; font-weight:650; cursor:pointer; transition:background .16s,transform .16s,border-color .16s; }
      .rb-link-pill:hover,.rb-btn:hover { background:#2c2c2f; border-color:#555458; }
      .rb-btn:active { transform:translateY(1px); }
      .rb-btn-primary { background:var(--rb-red); border-color:var(--rb-red); color:var(--rb-red-ink); font-weight:750; }
      .rb-btn-primary:hover { background:#ff5b50; border-color:#ff5b50; }
      .rb-menu { display:none; width:34px; padding:0; }
      .rb-rail { grid-column:1; grid-row:2; min-height:calc(100dvh - 62px); display:flex; flex-direction:column; padding:26px 12px 18px; background:var(--rb-rail); border-right:1px solid #303033; }
      .rb-overline { padding:0 10px; color:var(--rb-dim); font:700 9px 'Space Mono',monospace; letter-spacing:.14em; text-transform:uppercase; }
      .rb-nav { display:grid; gap:4px; margin-top:13px; }
      .rb-nav a { display:flex; align-items:center; gap:10px; min-height:39px; padding:0 10px; border-radius:4px; color:#c0bcbb; text-decoration:none; font-size:12px; }
      .rb-nav a:hover { background:#262628; color:var(--rb-ink); }
      .rb-nav a[aria-current="page"] { background:#39211f; color:#ffaaa3; box-shadow:inset 2px 0 var(--rb-red); }
      .rb-nav a[aria-current="page"] svg { color:var(--rb-red-soft); }
      .rb-rail-note { display:flex; gap:9px; margin:20px 5px 0; padding:11px 9px; border:1px solid #3a3534; border-radius:4px; color:#b9b3b1; font-size:10px; line-height:1.55; }
      .rb-note-mark { flex:none; display:grid; place-items:center; width:16px; height:16px; margin-top:1px; border:1px solid #9e655f; border-radius:50%; color:#ff9b92; font:700 10px 'Space Mono',monospace; }
      .rb-rail-foot { margin-top:auto; padding:15px 9px 0; border-top:1px solid var(--rb-line); }
      .rb-sport-list { margin-top:9px; color:#aaa5a4; font:10px/1.9 'Space Mono',monospace; }
      .rb-main { width:min(1500px,100%); min-width:0; padding:28px clamp(18px,3vw,42px) 98px; }
      .rb-preview-label { display:flex; align-items:center; gap:8px; margin-bottom:17px; padding:8px 11px; border:1px solid #65413e; background:#261b1a; color:#e1aba6; font:9px/1.5 'Space Mono',monospace; letter-spacing:.025em; }
      .rb-preview-label svg { flex:none; color:#ff8a80; }
      .rb-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:19px; }
      .rb-eyebrow { color:var(--rb-red-soft); font:700 9px 'Space Mono',monospace; letter-spacing:.13em; text-transform:uppercase; }
      .rb-heading h1 { margin:7px 0 7px; font:600 clamp(31px,3.4vw,43px)/1 'Space Grotesk',sans-serif; letter-spacing:-.055em; }
      .rb-heading p { max-width:640px; margin:0; color:#b8b3b2; font-size:12px; line-height:1.55; }
      .rb-date-stamp { min-width:178px; padding:0 0 2px 15px; border-left:1px solid var(--rb-line); font-size:12px; font-weight:650; }
      .rb-date-stamp small { display:flex; align-items:center; gap:6px; margin-top:7px; color:var(--rb-warm); font:9px 'Space Mono',monospace; letter-spacing:.055em; text-transform:uppercase; }
      .rb-controls { display:flex; justify-content:space-between; align-items:flex-end; gap:14px; padding:11px 12px; border:1px solid var(--rb-line); border-radius:6px; background:var(--rb-panel); }
      .rb-field label { display:block; margin-bottom:5px; color:var(--rb-muted); font:700 9px 'Space Mono',monospace; letter-spacing:.09em; text-transform:uppercase; }
      .rb-field input { width:168px; height:34px; padding:0 9px; border:1px solid #454548; border-radius:4px; color:var(--rb-ink); background:#141415; color-scheme:dark; }
      .rb-control-actions { display:flex; gap:7px; }
      .rb-tabs { display:flex; gap:5px; overflow-x:auto; margin:13px 0 16px; padding:1px 0 4px; scrollbar-width:thin; }
      .rb-tab { flex:none; min-width:62px; height:37px; padding:0 12px; border:1px solid #333336; border-radius:4px; background:#1c1c1e; color:#c9c5c4; font:700 10px 'Space Mono',monospace; letter-spacing:.04em; cursor:pointer; }
      .rb-tab:hover { border-color:#6b4b48; background:#272324; }
      .rb-tab[aria-selected="true"] { border-color:var(--rb-red); background:var(--rb-red); color:#20110f; box-shadow:inset 0 -2px rgba(39,12,10,.3); }
      .rb-summary { display:grid; grid-template-columns:minmax(180px,1.4fr) repeat(3,minmax(100px,.62fr)); margin-bottom:14px; overflow:hidden; border:1px solid var(--rb-line); border-radius:6px; background:#1b1b1d; }
      .rb-summary-intro,.rb-metric { display:flex; flex-direction:column; justify-content:center; min-height:68px; padding:11px 15px; }
      .rb-summary-intro { gap:3px; }
      .rb-summary-intro span { color:var(--rb-muted); font:700 9px 'Space Mono',monospace; letter-spacing:.12em; }
      .rb-summary-intro strong { font:600 17px 'Space Grotesk',sans-serif; }
      .rb-metric { border-left:1px solid var(--rb-line); }
      .rb-metric strong { font:600 18px 'Space Grotesk',sans-serif; color:#eee9e8; }
      .rb-metric span { margin-top:2px; color:#a9a3a2; font:8px 'Space Mono',monospace; letter-spacing:.07em; }
      .rb-layout { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(265px,.78fr); gap:13px; align-items:start; }
      .rb-stack { display:grid; gap:13px; min-width:0; }
      .rb-panel { overflow:hidden; border:1px solid var(--rb-line); border-radius:6px; background:var(--rb-panel); }
      .rb-panel-head { display:flex; align-items:center; justify-content:space-between; min-height:46px; gap:10px; padding:0 14px; border-bottom:1px solid var(--rb-line); background:#222224; }
      .rb-panel-title { display:flex; align-items:center; gap:8px; margin:0; font:650 12px 'Space Grotesk',sans-serif; }
      .rb-panel-title svg { color:var(--rb-red-soft); }
      .rb-panel-meta { color:#c6b4b1; font:8px 'Space Mono',monospace; letter-spacing:.08em; text-align:right; }
      .rb-body { padding:13px; }
      .rb-history-note { display:flex; gap:8px; align-items:flex-start; margin:0 0 10px; padding:9px 10px; border:1px solid #78453f; border-left:3px solid var(--rb-red); border-radius:3px; background:#2b1e1d; color:#f0c5c0; font:9px/1.5 'Space Mono',monospace; }
      .rb-history-note svg { flex:none; color:#ff8a80; }
      .rb-game-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
      .rb-game { min-width:0; overflow:hidden; border:1px solid #3a393c; border-radius:4px; background:#202022; box-shadow:0 2px 8px rgba(0,0,0,.12); }
      .rb-game-top { display:flex; justify-content:space-between; align-items:center; min-height:30px; padding:5px 9px; border-bottom:1px solid #39383b; background:#272729; }
      .rb-game-time { color:#bdb8b7; font:8px 'Space Mono',monospace; letter-spacing:.06em; }
      .rb-final { padding:2px 5px; border:1px solid #80635f; border-radius:2px; color:#e6c2be; font:8px 'Space Mono',monospace; letter-spacing:.06em; }
      .rb-game-main { display:grid; gap:7px; padding:8px; }
      .rb-teams { min-width:0; }
      .rb-team { display:grid; grid-template-columns:27px minmax(0,1fr) 20px; align-items:center; gap:6px; min-height:30px; }
      .rb-team + .rb-team { border-top:1px solid #353437; }
      .rb-team-code { display:grid; place-items:center; width:24px; height:23px; border:1px solid #48474a; border-radius:3px; color:#e0dcdb; background:#2c2b2e; font:8px 'Space Mono',monospace; }
      .rb-team-name { overflow:hidden; color:#e0dcdb; font-size:9px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
      .rb-score { color:#f3eeed; font:600 14px 'Space Grotesk',sans-serif; text-align:right; }
      .rb-markets { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); border:1px solid #39383b; border-radius:3px; background:#19191b; }
      .rb-markets div { min-width:0; padding:5px 6px; }
      .rb-markets div + div { border-left:1px solid #39383b; }
      .rb-markets small { display:block; margin-bottom:3px; color:#aaa5a4; font:7px 'Space Mono',monospace; letter-spacing:.03em; white-space:nowrap; }
      .rb-markets strong { display:block; color:#ebe6e5; font:600 11px 'Space Mono',monospace; }
      .rb-game-foot { display:flex; justify-content:space-between; gap:7px; min-height:25px; padding:5px 8px; border-top:1px solid #39383b; color:#a6a1a0; font-size:8px; }
      .rb-venue { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rb-empty { display:grid; grid-template-columns:37px minmax(0,1fr); gap:11px; padding:14px; border:1px solid #38383a; border-radius:4px; background:#171719; }
      .rb-empty-icon,.rb-news-icon { display:grid; place-items:center; flex:none; width:34px; height:34px; border:1px solid #59403e; border-radius:4px; background:#2d201f; color:#ff8b81; }
      .rb-empty h3,.rb-news h3 { margin:1px 0 5px; font:600 13px 'Space Grotesk',sans-serif; }
      .rb-empty p,.rb-news p { margin:0; color:#b2adac; font-size:10px; line-height:1.6; }
      .rb-empty-actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:11px; }
      .rb-empty-actions .rb-btn { min-height:30px; font-size:10px; }
      .rb-news { display:flex; align-items:flex-start; gap:11px; padding:13px; border:1px solid #38383a; border-radius:4px; background:#171719; }
      .rb-news .rb-news-icon { width:32px; height:32px; }
      .rb-text-link { display:inline-flex; align-items:center; gap:5px; margin-top:8px; color:#ff958c; font-size:10px; font-weight:700; text-decoration:none; }
      .rb-text-link:hover { color:#ffc0ba; }
      .rb-model-card { padding:14px; border:1px solid #70433f; border-radius:4px; background:linear-gradient(135deg,#2b201f,#211d1d 68%); }
      .rb-model-kicker { color:#ff9b92; font:700 8px 'Space Mono',monospace; letter-spacing:.11em; }
      .rb-model-card h3 { margin:7px 0 6px; font:600 16px 'Space Grotesk',sans-serif; }
      .rb-model-card p { margin:0; color:#c5bdbc; font-size:10px; line-height:1.6; }
      .rb-model-lock { display:flex; align-items:flex-start; gap:8px; margin-top:12px; padding-top:10px; border-top:1px solid #5b3b38; color:#e3d5d3; font-size:9px; line-height:1.55; }
      .rb-model-lock svg { flex:none; color:#ff958c; }
      .rb-price { display:flex; align-items:baseline; gap:5px; margin-top:11px; color:#f5e7e5; }
      .rb-price strong { font:600 19px 'Space Grotesk',sans-serif; }
      .rb-price span { color:#c6aeab; font-size:9px; }
      .rb-member-link { display:flex; justify-content:space-between; width:100%; margin-top:11px; text-decoration:none; }
      .rb-small-note { margin:9px 0 0; color:#aaa4a3; font-size:9px; line-height:1.55; }
      .rb-install-copy { margin:0 0 11px; color:#b4afae; font-size:10px; line-height:1.6; }
      .rb-bottom-line { margin-top:19px; color:#85807f; font:8px 'Space Mono',monospace; letter-spacing:.1em; }
      .rb-ticker {
        position:sticky; z-index:25; grid-column:1/-1; grid-row:2; top:62px; bottom:auto; display:grid;
        grid-template-columns:205px minmax(0,1fr); align-items:center; gap:12px;
        min-height:68px; padding:7px 12px calc(7px + env(safe-area-inset-bottom));
        border-top:1px solid #4a3432; background:rgba(16,16,17,.97);
        box-shadow:0 -8px 28px rgba(0,0,0,.26); backdrop-filter:blur(12px);
      }
      .rb-ticker-label { display:grid; gap:2px; min-width:0; }
      .rb-ticker-kicker { color:#ff8a80; font:700 8px 'Space Mono',monospace; letter-spacing:.1em; text-transform:uppercase; }
      .rb-ticker-title { color:#eee9e8; font:600 11px 'Space Grotesk',sans-serif; }
      .rb-ticker-hint { overflow:hidden; color:#aaa5a4; font:7px 'Space Mono',monospace; text-overflow:ellipsis; white-space:nowrap; }
      .rb-ticker-track { display:flex; gap:7px; min-width:0; overflow-x:auto; overscroll-behavior-x:contain; padding:2px 0; scrollbar-color:#65413e #1b1b1d; scrollbar-width:thin; scroll-snap-type:x proximity; touch-action:pan-x; }
      .rb-ticker-game { flex:0 0 184px; display:grid; gap:2px; min-width:0; min-height:48px; padding:5px 8px; border:1px solid #39383b; border-radius:4px; background:#1d1d1f; color:var(--rb-ink); cursor:pointer; text-align:left; scroll-snap-align:start; transition:transform .16s,border-color .16s,background .16s; }
      .rb-ticker-game:hover { transform:translateY(-1px); border-color:#ce554d; background:#272122; }
      .rb-ticker-game:focus-visible { outline:2px solid #ff8a80; outline-offset:2px; }
      .rb-ticker-meta,.rb-ticker-markets { display:flex; justify-content:space-between; align-items:center; gap:6px; }
      .rb-ticker-meta { color:#aba6a5; font:7px 'Space Mono',monospace; letter-spacing:.04em; }
      .rb-ticker-sport { color:#ff8a80; font-weight:700; }
      .rb-ticker-scoreline { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:5px; font:700 9px 'Space Mono',monospace; }
      .rb-ticker-scoreline span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rb-ticker-scoreline span:last-child { overflow:hidden; text-align:right; text-overflow:ellipsis; white-space:nowrap; }
      .rb-ticker-scoreline strong { color:#f0e9e7; white-space:nowrap; }
      .rb-ticker-markets { color:#bbb4b2; font:7px 'Space Mono',monospace; }
      .rb-ticker-empty { display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; color:#b9b3b2; font-size:10px; }
      .rb-ticker-empty span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rb-ticker-action { display:inline-flex; align-items:center; gap:5px; flex:none; padding:6px 8px; border:1px solid #58403d; border-radius:4px; background:#261e1d; color:#ffaaa3; cursor:pointer; font-size:9px; font-weight:700; }
      .rb-ticker-action:hover { border-color:#b45049; background:#332220; }
      .rb-modal-backdrop { position:fixed; z-index:50; inset:0; display:grid; place-items:center; padding:18px; background:rgba(5,5,6,.78); }
      .rb-modal { width:min(440px,100%); padding:21px; border:1px solid #51413f; border-radius:7px; background:#222123; box-shadow:0 20px 60px rgba(0,0,0,.42); }
      .rb-modal-top { display:flex; justify-content:space-between; gap:12px; }
      .rb-modal h2 { margin:6px 0 0; font:600 23px 'Space Grotesk',sans-serif; letter-spacing:-.03em; }
      .rb-modal p,.rb-modal li { color:#c0b9b8; font-size:11px; line-height:1.65; }
      .rb-modal ol { padding-left:19px; }
      .rb-close { display:grid; place-items:center; width:30px; height:30px; padding:0; }
      .rb-modal-actions { display:flex; justify-content:flex-end; margin-top:18px; }
      .rb-app :focus-visible { outline:2px solid #ff8d83; outline-offset:3px; }
      .rb-app button:disabled { cursor:wait; opacity:.78; }
      @media(max-width:960px) { .rb-app { grid-template-columns:180px minmax(0,1fr); } .rb-layout { grid-template-columns:minmax(0,1fr); } }
      @media(max-width:680px) {
        .rb-app { grid-template-columns:minmax(0,1fr); grid-template-rows:56px auto; }
        .rb-top { padding:0 12px; } .rb-top-note,.rb-link-pill { display:none; } .rb-menu { display:inline-flex; }
        .rb-top-right { gap:7px; }
        .rb-rail { display:none; }
        .rb-rail.rb-mobile-open { position:fixed; z-index:30; top:56px; left:0; bottom:0; display:flex; width:min(260px,84vw); min-height:0; box-shadow:12px 0 30px rgba(0,0,0,.4); }
        .rb-main { grid-column:1; padding:19px 12px 126px; }
        .rb-preview-label { align-items:flex-start; margin-bottom:14px; font-size:8px; }
        .rb-heading { display:block; margin-bottom:15px; }
        .rb-heading h1 { font-size:34px; }
        .rb-date-stamp { margin-top:13px; padding:0; border:0; }
        .rb-controls { display:grid; grid-template-columns:1fr; gap:10px; }
        .rb-field input { width:100%; }
        .rb-control-actions { display:grid; grid-template-columns:1fr 1fr; }
        .rb-control-actions .rb-btn { width:100%; }
        .rb-tabs { margin-right:-12px; padding-right:12px; }
        .rb-tab { min-width:59px; height:39px; }
        .rb-summary { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .rb-summary-intro { grid-column:1/-1; min-height:auto; padding:10px 12px; border-bottom:1px solid var(--rb-line); }
        .rb-summary-intro strong { font-size:15px; }
        .rb-metric { min-height:59px; padding:9px 10px; }
        .rb-metric:first-of-type { border-left:0; }
        .rb-panel-head { padding:0 11px; }
        .rb-body { padding:10px; }
        .rb-game-grid { grid-template-columns:minmax(0,1fr); }
        .rb-game-main { grid-template-columns:minmax(0,1fr); }
        .rb-ticker { grid-template-columns:minmax(0,1fr); gap:4px; min-height:86px; padding:5px 8px calc(5px + env(safe-area-inset-bottom)); }
        .rb-ticker-label { display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .rb-ticker-kicker { font-size:7px; }
        .rb-ticker-title { font-size:9px; }
        .rb-ticker-hint { max-width:43%; font-size:8px; }
        .rb-ticker-track { margin-right:-8px; padding-right:8px; }
        .rb-ticker-game { flex-basis:166px; min-height:44px; padding:4px 7px; }
        .rb-ticker-empty { min-height:42px; font-size:8px; }
        .rb-ticker-action { padding:5px 6px; font-size:8px; }
        .rb-empty { grid-template-columns:31px minmax(0,1fr); gap:9px; padding:11px; }
        .rb-empty-icon { width:29px; height:29px; }
        .rb-empty-actions { display:grid; grid-template-columns:1fr; }
        .rb-empty-actions .rb-btn { justify-content:center; }
      }
      @media(prefers-reduced-motion:reduce) { .rb-app * { scroll-behavior:auto!important; transition:none!important; } }
      .rb-top { position:sticky; top:0; z-index:30; }
      .rb-rail { grid-row:3; }
      .rb-main { grid-column:2; grid-row:3; padding-bottom:32px; }
      @media(max-width:680px) {
        .rb-app { grid-template-rows:56px auto 1fr; }
        .rb-ticker { top:56px; padding-bottom:5px; }
        .rb-main { grid-column:1; padding-bottom:32px; }
      }
    `}</style>

    <header className="rb-top">
      <a className="rb-brand" href="#overview" aria-label="ALLPLAY dashboard">
        <span className="rb-mark"><Activity size={16} strokeWidth={2.6} /></span>ALLPLAY
      </a>
      <div className="rb-top-right">
        <span className="rb-top-note">Research desk · seven sports</span>
        <a className="rb-link-pill" href="#free-news"><Newspaper size={13} /> Free news</a>
        <a className="rb-link-pill" href="#member-projections"><LockKeyhole size={13} /> Model</a>
        <button className="rb-btn rb-btn-primary" onClick={() => setInstallOpen(true)}><ArrowDownToLine size={14} /> Install app</button>
        <button className="rb-btn rb-menu" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen}><Menu size={16} /></button>
      </div>
    </header>

    <aside className={`rb-rail ${menuOpen ? 'rb-mobile-open' : ''}`} aria-label="Dashboard navigation">
      <div className="rb-overline">Your workspace</div>
      <nav className="rb-nav">
        <a href="#overview" aria-current="page" onClick={() => setMenuOpen(false)}><Activity size={15} />Overview</a>
        <a href="#slate" onClick={() => setMenuOpen(false)}><CalendarDays size={15} />Slate &amp; lines</a>
        <a href="#member-projections" onClick={() => setMenuOpen(false)}><LockKeyhole size={15} />Projections</a>
        <a href="#free-news" onClick={() => setMenuOpen(false)}><Newspaper size={15} />News desk</a>
        <a href="#takes" onClick={() => setMenuOpen(false)}><Film size={15} />Game takes</a>
        <a href="#help" onClick={() => setMenuOpen(false)}><CircleHelp size={15} />Feedback</a>
      </nav>
      <div className="rb-rail-note"><span className="rb-note-mark">i</span><span>Preview data is intentionally limited. Red marks the ALLPLAY selection — it is not an alert.</span></div>
      <div className="rb-rail-foot"><div className="rb-overline">Seven sports</div><div className="rb-sport-list">NFL · NHL · WNBA<br />NBA · MLB · NASCAR · CFB</div></div>
    </aside>

    <main className="rb-main">
      <div className="rb-preview-label"><CircleHelp size={13} /> PREVIEW MODE · No live slate, lines, news or player data is connected. NHL cards below are historical layout examples only.</div>
      <div className="rb-heading">
        <div>
          <div className="rb-eyebrow">The research desk <span style={{ color: 'var(--rb-dim)' }}>/</span> {weekday}</div>
          <h1>Slate. Then signal.</h1>
          <p>Scan the schedule and game context first. Open the independent ALLPLAY player model only when you want the deeper work.</p>
        </div>
        <div className="rb-date-stamp">{dateLabel}<small><Clock3 size={11} /> Feed status unavailable</small></div>
      </div>

      <div className="rb-controls">
        <div className="rb-field"><label htmlFor="rb-date">Slate date</label><input id="rb-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="rb-control-actions">
          <a className="rb-btn" href="#free-news"><Newspaper size={14} /> Free news</a>
          <button className="rb-btn" onClick={refresh} disabled={refreshing}><RefreshCw size={14} />{refreshing ? 'Preview only' : 'Refresh'}</button>
        </div>
      </div>

      <div className="rb-tabs" role="tablist" aria-label="Choose a sport">
        {SPORTS.map((item, index) => <button key={item} id={`rb-tab-${item}`} className="rb-tab" type="button" role="tab" aria-selected={sport === item} aria-controls="rb-sport-panel" tabIndex={sport === item ? 0 : -1} onClick={() => { setSport(item); setShowHistory(item === 'NHL'); }} onKeyDown={(event) => onSportKey(event, index)}>{item}</button>)}
      </div>

      <section className="rb-summary" aria-label={`${sport} slate summary`}>
        <div className="rb-summary-intro"><span>AT A GLANCE</span><strong>{sport} · {weekday}</strong></div>
        <div className="rb-metric"><strong>—</strong><span>VERIFIED GAMES</span></div>
        <div className="rb-metric"><strong>—</strong><span>AVAILABLE LINES</span></div>
        <div className="rb-metric"><strong>Member</strong><span>PLAYER MODEL</span></div>
      </section>

      <div id="rb-sport-panel" role="tabpanel" aria-labelledby={`rb-tab-${sport}`}>
        <div className="rb-layout">
          <div className="rb-stack">
            <section className="rb-panel" id="slate" aria-labelledby="rb-slate-title">
              <div className="rb-panel-head"><h2 className="rb-panel-title" id="rb-slate-title"><CalendarDays size={15} /> {sport} slate &amp; lines</h2><span className="rb-panel-meta">{sport === 'NHL' && showHistory ? 'HISTORICAL EXAMPLE' : 'FEED UNAVAILABLE'}</span></div>
              <div className="rb-body">
                {sport === 'NHL' && showHistory ? <>
                  <div className="rb-history-note"><CircleHelp size={13} /><span>HISTORICAL LAYOUT EXAMPLE · Finished NHL reference matchups, scores and lines. Not a current slate; date selector does not alter these archived examples.</span></div>
                  <div className="rb-game-grid" aria-label="Historical NHL matchup layout examples">
                    {HISTORICAL_NHL.map((game) => <article className="rb-game" key={`${game.time}-${game.away[0]}`}>
                      <div className="rb-game-top"><span className="rb-game-time">NHL · {game.time}</span><span className="rb-final">FINAL · HISTORICAL</span></div>
                      <div className="rb-game-main">
                        <div className="rb-teams">
                          {[game.away, game.home].map(([code, name, score]) => <div className="rb-team" key={code}><span className="rb-team-code">{code}</span><span className="rb-team-name">{name}</span><strong className="rb-score">{score}</strong></div>)}
                        </div>
                        <div className="rb-markets"><div><small>VEGAS O/U</small><strong>{game.total}</strong></div><div><small>SPREAD</small><strong>{game.spread}</strong></div></div>
                      </div>
                      <div className="rb-game-foot"><span className="rb-venue">{game.venue}</span><span>Reference only</span></div>
                    </article>)}
                  </div>
                </> : <div className="rb-empty">
                  <div className="rb-empty-icon"><CalendarDays size={16} /></div>
                  <div><h3>No confirmed games in this preview</h3><p>We can’t verify {sport} matchups, totals, or lines for {dateLabel}. Nothing here is filled with invented slate data.</p>
                    <div className="rb-empty-actions">
                      <button className="rb-btn" onClick={refresh}><RefreshCw size={13} />{refreshing ? 'Preview only' : 'Check again'}</button>
                      {sport === 'NHL' && <button className="rb-btn" onClick={() => setShowHistory(true)}>View historical layout example <ArrowRight size={13} /></button>}
                    </div>
                  </div>
                </div>}
              </div>
            </section>
            <section className="rb-panel" id="free-news" aria-labelledby="rb-news-title">
              <div className="rb-panel-head"><h2 className="rb-panel-title" id="rb-news-title"><Newspaper size={15} /> Free news desk</h2><span className="rb-panel-meta">OPEN ACCESS</span></div>
              <div className="rb-body"><div className="rb-news"><div className="rb-news-icon"><Newspaper size={15} /></div><div><h3>News stays free.</h3><p>Headlines and sports reporting are open to everyone. Current stories aren’t connected in this component preview.</p><a className="rb-text-link" href="#free-news">Open free news <ChevronRight size={13} /></a></div></div></div>
            </section>
          </div>
          <div className="rb-stack">
            <section className="rb-panel" id="member-projections" aria-labelledby="rb-model-title">
              <div className="rb-panel-head"><h2 className="rb-panel-title" id="rb-model-title"><Activity size={15} /> ALLPLAY player model</h2><span className="rb-panel-meta">MEMBERS ONLY</span></div>
              <div className="rb-body">
                <div className="rb-model-card"><span className="rb-model-kicker">INDEPENDENT PLAYER RESEARCH</span><h3>Your model. Its own lane.</h3><p>ALLPLAY’s player estimates and research trail live in a separate member sheet. This dashboard preview does not expose projections or member stats.</p>
                  <div className="rb-model-lock"><ShieldCheck size={15} /><span>Player-model access requires a verified membership. Nothing gated is shown here.</span></div>
                  <div className="rb-price"><strong>$1.99</strong><span>per month · member access</span></div>
                  <a className="rb-btn rb-btn-primary rb-member-link" href="#member-projections">Explore member projections <ArrowRight size={14} /></a>
                </div>
                <p className="rb-small-note">Free news and slate context stay separate from the $1.99/month member-only player model.</p>
              </div>
            </section>
            <section className="rb-panel">
              <div className="rb-panel-head"><h2 className="rb-panel-title"><Smartphone size={15} /> Keep ALLPLAY close</h2></div>
              <div className="rb-body"><p className="rb-install-copy">Add a home-screen or desktop shortcut for a faster return to your research desk.</p><button className="rb-btn" style={{ width: '100%' }} onClick={() => setInstallOpen(true)}><ArrowDownToLine size={14} /> Install / setup help</button></div>
            </section>
          </div>
        </div>
      </div>
      <div className="rb-bottom-line" id="takes">ALLPLAY · THE MOMENT BEFORE LOCK · YOUR SLATE, YOUR CALL</div>
      <span id="help" aria-hidden="true" />

      {installOpen && <div className="rb-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstallOpen(false); }}>
        <section className="rb-modal" role="dialog" aria-modal="true" aria-labelledby="rb-install-title">
          <div className="rb-modal-top"><div><div className="rb-eyebrow">Ready when you are</div><h2 id="rb-install-title">Keep ALLPLAY close.</h2></div><button className="rb-btn rb-close" onClick={() => setInstallOpen(false)} aria-label="Close install help"><X size={15} /></button></div>
          <p>Add ALLPLAY to your home screen or desktop for a focused, app-like launch.</p>
          <ol><li>Open the browser menu near the address bar.</li><li>Choose <b>Install app</b> or <b>Add to home screen</b>.</li><li>Confirm to open ALLPLAY in its own window.</li></ol>
          <div className="rb-modal-actions"><button className="rb-btn rb-btn-primary" onClick={() => setInstallOpen(false)}><Check size={14} /> Got it</button></div>
        </section>
      </div>}
    </main>
    <section className="rb-ticker" aria-label="Historical game ticker preview">
      <div className="rb-ticker-label">
        <span className="rb-ticker-kicker">Games · scannable at a glance</span>
        <strong className="rb-ticker-title">{sport === 'NHL' ? 'NHL · finished examples' : `${sport} · feed unavailable`}</strong>
        <span className="rb-ticker-hint">Historical sample only · not live</span>
      </div>
      {sport === 'NHL' ? <div className="rb-ticker-track" role="region" aria-label="Scroll through historical NHL game examples" tabIndex={0}>
        {HISTORICAL_NHL.map((game) => <button
          className="rb-ticker-game"
          key={`ticker-${game.time}-${game.away[0]}`}
          type="button"
          aria-label={`Historical NHL final: ${game.away[1]} ${game.away[2]} at ${game.home[1]} ${game.home[2]}, ${game.time}. Over under ${game.total}, spread ${game.spread}. Open matchup examples.`}
          onClick={() => { setShowHistory(true); document.getElementById('slate')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}
        >
          <span className="rb-ticker-meta"><span className="rb-ticker-sport">NHL</span><span>FINAL · {game.time}</span></span>
          <span className="rb-ticker-scoreline"><span>{game.away[0]}</span><strong>{game.away[2]} — {game.home[2]}</strong><span>{game.home[0]}</span></span>
          <span className="rb-ticker-markets"><span>O/U {game.total}</span><span>SPREAD {game.spread}</span></span>
        </button>)}
      </div> : <div className="rb-ticker-empty" role="status">
        <span>No verified {sport} games are connected in this preview; live results aren’t being filled in.</span>
        <button className="rb-ticker-action" type="button" onClick={() => { setSport('NHL'); setShowHistory(true); document.getElementById('slate')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>See NHL examples <ChevronRight size={12} /></button>
      </div>}
    </section>
  </div>;
}

export default RedBlack;
