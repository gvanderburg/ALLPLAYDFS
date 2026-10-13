import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useGetDfsDashboard, getGetDfsDashboardQueryKey } from '@workspace/api-client-react';
import type { DfsEvent, DfsNewsItem, DfsSport, DfsSalaryPlatform } from '@workspace/api-client-react';
import SalaryControls from '@/components/salary-controls';
import { ModelPreview } from '@/components/model-projections';
import MembershipCheckoutButton from '@/components/membership-checkout-button';
import useMembership from '@/hooks/use-membership';
import {
  Activity, AlertCircle, ArrowDownToLine, CalendarDays,
  Download, ExternalLink, Newspaper, RefreshCw, ShieldCheck,
  Smartphone, TrendingUp, X, Film,
} from 'lucide-react';

const SPORTS: { id: DfsSport; name: string; short: string }[] = [
  { id: 'nfl', name: 'NFL', short: 'NFL' },
  { id: 'nhl', name: 'NHL', short: 'NHL' }, { id: 'wnba', name: 'WNBA', short: 'WNBA' },
  { id: 'nba', name: 'NBA', short: 'NBA' }, { id: 'mlb', name: 'MLB', short: 'MLB' },
  { id: 'nascar', name: 'NASCAR', short: 'NASCAR' }, { id: 'cfb', name: 'College football', short: 'CFB' },
];

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return 'Time TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, options ?? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\r\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = href; link.download = filename; link.click(); URL.revokeObjectURL(href);
}
function eventExportRows(events: DfsEvent[]) {
  return events.map((event) => ({
    sport: event.sport, league: event.league, event: event.name, startTime: event.startTime,
    status: event.status, venue: event.venue ?? '', totalPoints: event.totalPoints ?? '',
    spread: event.spread ?? '', oddsSource: event.oddsSource ?? '',
  }));
}
function SalaryOnlyRows({ rows }: { rows: { id: string; name: string; team?: string | null; opponent?: string | null; position?: string | null; rosterPositions?: string | null; salary?: number | null; salarySource?: string | null }[] }) {
  if (!rows.length) return <div className="salary-only-empty">No salary entries for this sport and slate. Salary data is kept separate from the ALLPLAY model sheet.</div>;
  return <div className="salary-only-scroll" role="region" aria-label="Salary-only player list" tabIndex={0}><table className="salary-only-table"><thead><tr><th>PLAYER</th><th>POS</th><th>TEAM</th><th>OPP</th><th>SALARY</th></tr></thead><tbody>{rows.map((player) => <tr key={player.id}><td>{player.name}</td><td>{player.rosterPositions || player.position || '—'}</td><td>{player.team || '—'}</td><td>{player.opponent || '—'}</td><td title={player.salarySource ?? 'Salary source not provided'}>{player.salary == null ? '—' : `$${player.salary.toLocaleString('en-US')}`}</td></tr>)}</tbody></table></div>;
}
function SportLabel({ sport }: { sport: string }) {
  return <span className="type-tag">{sport.toUpperCase()}</span>;
}
function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className="state-box"><div className="state-icon">{icon}</div><strong>{title}</strong><p>{copy}</p></div>;
}
function EventSlate({ events, loading }: { events: DfsEvent[]; loading: boolean }) {
  if (loading) return <div className="slate-list">{[1, 2, 3].map((n) => <div className="skeleton" key={n} style={{ height: 76 }} />)}</div>;
  if (!events.length) return <EmptyState icon={<CalendarDays size={17} />} title="No events on this slate" copy="There are no events returned for this date and sport selection." />;
  return <div className="slate-list">{events.map((event) => {
    const [away, home] = [...event.competitors].sort((a, b) => (a.homeAway === 'away' ? -1 : b.homeAway === 'away' ? 1 : 0));
    const teamGame = away?.homeAway === 'away' && home?.homeAway === 'home';
    const live = /live|in progress|in-progress/i.test(event.status);
    return <article className="event-row" key={event.id} data-testid={`event-${event.id}`}>
      <div>
        <div className="event-league">{event.league} <span style={{ color: 'var(--slate-muted)' }}>·</span> {formatDate(event.startTime, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>
        <div className="event-name">{event.shortName || event.name}</div>
        {teamGame && <div className="competitors" style={{ marginTop: 9 }}>
          <span className="team-chip">{away?.abbreviation ?? '—'}</span><span>{away?.name ?? 'TBD'}</span>
          {away?.score != null && <b>{away.score}</b>}
          <span className="versus">vs</span>
          <span className="team-chip">{home?.abbreviation ?? '—'}</span><span>{home?.name ?? 'TBD'}</span>
          {home?.score != null && <b>{home.score}</b>}
        </div>}
      </div>
      <div className="event-right">
        <span className={`event-time ${live ? 'status-live' : ''}`}>{live ? event.status : formatDate(event.startTime, { hour: 'numeric', minute: '2-digit' })}</span>
        <span className={`total-pill ${event.totalPoints == null ? 'missing' : ''}`}>{event.sport === 'nascar' ? 'Race odds unavailable' : event.totalPoints == null ? 'Total —' : `O/U ${event.totalPoints}`}</span>
        {teamGame && <div className="event-lines">
          <div><span>Spread</span><strong>{away?.abbreviation ?? 'Away'} {signedLine(away?.spread, true)} · {home?.abbreviation ?? 'Home'} {signedLine(home?.spread, true)}</strong></div>
          <div><span>Moneyline</span><strong>{away?.abbreviation ?? 'Away'} {signedLine(away?.moneyline)} · {home?.abbreviation ?? 'Home'} {signedLine(home?.moneyline)}</strong></div>
        </div>}
        {event.oddsSource && <span className="event-odds-source">{event.oddsSource} · American odds</span>}
      </div>
    </article>;
  })}</div>;
}
function signedLine(value?: number | null, pick = false) {
  if (value == null) return '—';
  if (pick && value === 0) return 'PK';
  return value > 0 ? `+${value}` : String(value);
}
function NewsFeed({ news, loading }: { news: DfsNewsItem[]; loading: boolean }) {
  if (loading) return <div style={{ display: 'grid', gap: 13 }}>{[1, 2, 3].map((n) => <div key={n} style={{ display: 'flex', gap: 12 }}><div className="skeleton" style={{ width: 57, height: 57 }} /><div style={{ flex: 1 }}><div className="skeleton" style={{ height: 12, marginBottom: 8 }} /><div className="skeleton" style={{ height: 10, width: '70%' }} /></div></div>)}</div>;
  if (!news.length) return <EmptyState icon={<Newspaper size={17} />} title="No recent news" copy="No news items were returned for this date and sport selection." />;
  return <div className="news-list">{news.map((item) => {
    const content = <>
      {item.image ? <img className="news-thumb" src={item.image} alt="" loading="lazy" /> : <div className="news-thumb news-fallback"><Newspaper size={18} /></div>}
      <div><div className="news-title">{item.title}</div>{item.description && <p className="news-desc">{item.description}</p>}
        <div className="news-byline"><SportLabel sport={item.sport} /><span>{item.source}</span><span>·</span><time>{formatDate(item.publishedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>{item.url && <ExternalLink size={11} />}</div>
      </div>
    </>;
    return item.url
      ? <a className="news-item" key={item.id} href={item.url} target="_blank" rel="noreferrer" aria-label={`${item.title} (opens in new tab)`} data-testid={`news-${item.id}`}>{content}</a>
      : <article className="news-item" key={item.id} data-testid={`news-${item.id}`}>{content}</article>;
  })}</div>;
}
function InstallDialog({ onClose, onInstall, canInstall, isInstalled, installing, installError }: { onClose: () => void; onInstall: () => void; canInstall: boolean; isInstalled: boolean; installing: boolean; installError: string | null }) {
  const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div className="modal-top"><div><div className="eyebrow">Ready when you are</div><h2 id="install-title">Keep your slate close</h2></div><button className="btn btn-quiet icon-btn" onClick={onClose} aria-label="Close installation help"><X size={16} /></button></div>
      <p className="modal-copy">Add the DFS cockpit to your home screen or desktop for a focused, app-like launch. Your date and league filters stay right here in the dashboard.</p>
      {installError && <div className="install-note" role="alert">{installError}</div>}
      {isInstalled ? <div className="install-note">This dashboard is already installed on this device.</div> :
        canInstall ? <div className="install-note">Your browser can install this dashboard now. Choose Install to add it to your apps.</div> :
          <ol className="install-steps">{isAppleMobile ? <>
            <li>Open this page in Safari.</li><li>Tap the Share button at the bottom of the screen.</li><li>Scroll the share sheet and choose <b>Add to Home Screen</b>, then tap Add.</li>
          </> : <>
            <li>Open your browser menu near the address bar.</li><li>Choose <b>Install app</b> or <b>Add to home screen</b>.</li><li>Confirm the prompt to launch it as a standalone app.</li>
          </>}</ol>}
      {!isAppleMobile && !canInstall && !isInstalled && <div className="install-note">Install availability depends on the browser and secure app hosting. On desktop, look for the install icon in the address bar.</div>}
      <div className="modal-actions"><button className="btn btn-quiet" onClick={onClose}>Not now</button>{canInstall && !isInstalled && <button className="btn btn-primary" onClick={onInstall} disabled={installing}><ArrowDownToLine size={15} /> {installing ? 'Installing…' : 'Install app'}</button>}</div>
    </section>
  </div>;
}

export default function Dashboard({ projectionsOnly = false }: { projectionsOnly?: boolean }) {
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const signedIn = authLoaded && isSignedIn === true;
  const overviewPath = signedIn ? '/user-portal' : '/';
  useEffect(() => {
    document.title = projectionsOnly ? 'Player Projections | ALLPLAY' : 'DFS Dashboard | ALLPLAY';
    document.querySelector('meta[name="description"]')?.setAttribute('content', projectionsOnly
        ? 'ALLPLAY independent raw-stat matchup model sheets across seven sports. Membership required.'
      : 'ALLPLAY daily fantasy sports news, game slates, betting lines and member-only player data.');
  }, [projectionsOnly]);
  const membership = useMembership(signedIn);
  const [date, setDate] = useState(localDateString);
  const [automaticDate, setAutomaticDate] = useState(true);
  const [advanceNotice, setAdvanceNotice] = useState<string | null>(null);
  const [sport, setSport] = useState<DfsSport>('nfl');
  const [salaryPlatform, setSalaryPlatform] = useState<DfsSalaryPlatform>('draftkings');
  const [salarySelection, setSalarySelection] = useState<{ context: string; id: string }>();
  const salaryContext = `${sport}:${date}:${salaryPlatform}`;
  const slateId = salarySelection?.context === salaryContext ? salarySelection.id : undefined;
  const [installOpen, setInstallOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const nextSlateIfEmpty = automaticDate && date === localDateString();
  const params = useMemo(() => ({ date, sport, salaryPlatform, slateId, nextSlateIfEmpty }), [date, sport, salaryPlatform, slateId, nextSlateIfEmpty]);
  const dashboardKey = useMemo(() => [...getGetDfsDashboardQueryKey(params), { clerkUserId: signedIn ? userId ?? 'signed-in' : 'signed-out' }] as const, [params, signedIn, userId]);
  const query = useGetDfsDashboard(params, { query: { queryKey: dashboardKey, refetchOnWindowFocus: false, refetchInterval: 5 * 60 * 1000 } });
  const data = query.data;
  const loading = query.isLoading || query.isFetching;
  const events = (data?.events ?? []).filter((event) => event.sport === sport);
  const sourceProjections = (data?.projections ?? []).filter((player) => player.sport === sport);
  const memberStatus = membership.data;
  const membershipUnavailable = membership.isError || (!!memberStatus && (!memberStatus.ready || !!memberStatus.error || memberStatus.status.toLowerCase() === 'unavailable' || memberStatus.signedIn !== true));
  const canSeeForecasts = signedIn && memberStatus?.hasAccess === true && memberStatus.ready && !memberStatus.error && memberStatus.status.toLowerCase() !== 'unavailable' && memberStatus.signedIn === true && data?.projectionsLocked === false;
  const projections = canSeeForecasts ? sourceProjections : [];
  const salaryCoverage = data?.salaryCoverage?.platform === salaryPlatform ? data.salaryCoverage : undefined;
   const salaryRows = projections.filter((player) => player.salary != null);
  const news = (data?.news ?? []).filter((item) => item.sport === sport);
  const currentSportCoverage = data?.sportCoverage?.find((item) => item.sport === sport);
  const coverageList = currentSportCoverage ? [currentSportCoverage] : [];
  const sportName = SPORTS.find((item) => item.id === sport)?.name ?? sport.toUpperCase();

  useEffect(() => {
    const resolvedDate = data?.date.slice(0, 10);
    if (automaticDate && data?.autoAdvanced && resolvedDate && resolvedDate !== date) {
      setAdvanceNotice(`No ${sport.toUpperCase()} games on ${date}. Showing the next published slate: ${resolvedDate}.`);
      setSalarySelection(undefined);
      setDate(resolvedDate);
    }
  }, [data, automaticDate, date, sport]);
  const selectSport = (nextSport: DfsSport) => {
    setSport(nextSport);
    setAdvanceNotice(null);
    setSalarySelection(undefined);
    if (automaticDate) setDate(localDateString());
  };

  useEffect(() => {
    const handlePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    const handleInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', handlePrompt); window.removeEventListener('appinstalled', handleInstalled); };
  }, []);
  const doInstall = async () => {
    if (!installPrompt || installing) return;
    const prompt = installPrompt as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    setInstalling(true);
    setInstallError(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        setInstallOpen(false);
      }
    } catch {
      setInstallError('The browser could not open its install prompt. Use the browser’s install menu or the instructions below.');
      setInstallOpen(true);
    } finally {
      setInstallPrompt(null);
      setInstalling(false);
    }
  };
  const quickInstall = () => {
    if (installPrompt && !installed) void doInstall();
    else {
      setInstallError(null);
      setInstallOpen(true);
    }
  };
  const refresh = () => query.refetch();
  const formatUpdatedAt = data?.updatedAt ? formatDate(data.updatedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand" aria-label="ALLPLAY home" data-testid="link-home"><span className="brand-mark"><Activity size={18} strokeWidth={2.4} /></span><span className="brand-name">ALLPLAY</span></Link>
      <div className="topbar-right"><span className="today-label">Personal fantasy cockpit</span><Link href="/projections" className="btn btn-quiet account-header-link" aria-label="ALLPLAY model sheet" data-testid="link-model-mobile"><TrendingUp size={14} />Model</Link><Link href="/takes" className="btn btn-quiet account-header-link" aria-label="Game takes" data-testid="link-takes-mobile"><Film size={14} />Takes</Link>{signedIn ? <Link href="/account" className="btn btn-quiet account-header-link" data-testid="link-account">Account</Link> : <Link href="/sign-in" className="btn btn-quiet account-header-link" data-testid="link-sign-in">Sign in</Link>}<button className="btn btn-primary header-install-btn" onClick={quickInstall} disabled={installed || installing} data-testid="button-install-top"><ArrowDownToLine size={15} />{installed ? 'Installed' : installing ? 'Installing…' : 'Install app'}</button><span className="user-dot" aria-label={signedIn ? 'Signed-in personal dashboard' : 'Personal dashboard'}>{signedIn ? 'ME' : 'FREE'}</span></div>
    </header>
    <aside className="side-rail" aria-label="Dashboard navigation">
      <div className="rail-caption">YOUR WORKSPACE</div>
      <Link className={`rail-link ${projectionsOnly ? '' : 'selected'}`} href={overviewPath} aria-current={projectionsOnly ? undefined : 'page'}><Activity size={15} />Overview</Link>
      <Link className="rail-link" href={projectionsOnly ? `${overviewPath}#slate-section` : '#slate-section'}><CalendarDays size={15} />Live slate</Link>
      <Link className={`rail-link ${projectionsOnly ? 'selected' : ''}`} href="/projections" aria-current={projectionsOnly ? 'page' : undefined} data-testid="link-projections"><TrendingUp size={15} />Projections</Link>
      <Link className="rail-link" href="/takes" data-testid="link-takes-sidebar"><Film size={15} />Game takes</Link>
      <Link className="rail-link" href={projectionsOnly ? `${overviewPath}#news-section` : '#news-section'}><Newspaper size={15} />News desk</Link>
      <div className="rail-note"><span className="rail-live-dot" />Slate data refreshes every 5 minutes</div>
      <div className="rail-bottom"><span className="rail-caption">BUILT FOR EVERY LEAGUE</span><div className="rail-sports">NFL · NHL · WNBA<br />NBA · MLB · NASCAR · CFB</div></div>
    </aside>
    <main className={`main-wrap ${projectionsOnly ? 'projections-main' : ''}`} id="overview">
      <div className="page-heading">
         <div><div className="eyebrow">{projectionsOnly ? 'Your player research' : 'Your daily edge'} <span style={{ color: 'var(--slate-muted)' }}> / </span> {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}</div><h1>{projectionsOnly ? 'Player projections' : 'Slate, in focus.'}</h1><p className="subhead">{projectionsOnly ? 'ALLPLAY custom raw-stat estimates, with the calculation trail in view.' : 'Every matchup, number and note for the decisions ahead.'}</p></div>
        <div className="date-stamp"><div>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div><div style={{ marginTop: 5, color: 'var(--slate-muted)' }}>{formatUpdatedAt ? `DATA UPDATED ${formatUpdatedAt.toUpperCase()}` : 'AWAITING DATA'}</div></div>
      </div>
      <div className="control-bar">
        <div className="filter-group">
          <label className="micro-label" htmlFor="slate-date">Slate</label>
          <input id="slate-date" className="date-field" type="date" value={date} onChange={(e) => { setAutomaticDate(e.target.value === localDateString()); setAdvanceNotice(null); setSalarySelection(undefined); setDate(e.target.value); }} aria-label="Select slate date" data-testid="input-slate-date" />
        </div>
        <div className="action-group">
          {projectionsOnly && <Link href={overviewPath} className="btn btn-quiet">Overview</Link>}
          {!projectionsOnly && <button className="btn btn-quiet" onClick={() => downloadCsv(`${sport}-events-${date}.csv`, eventExportRows(events))} disabled={!events.length} aria-label="Export event slate as CSV" data-testid="button-export-events"><Download size={15} /> Events</button>}
          <Link className="btn btn-quiet" href="/projections" aria-label="Open ALLPLAY custom model sheet" data-testid="link-model-sheet"><TrendingUp size={15} /> Own model</Link>
          <button className="btn btn-primary" onClick={refresh} disabled={query.isFetching} data-testid="button-refresh"><RefreshCw size={15} className={query.isFetching ? 'spin' : ''} /> Refresh</button>
          <button className="btn btn-quiet icon-btn" onClick={() => setInstallOpen(true)} aria-label="Installation help" title="Install dashboard" data-testid="button-install-help"><Smartphone size={16} /></button>
        </div>
      </div>

      <div className="sport-tabs" role="tablist" aria-label="Sports">
        {SPORTS.map((item, index) => <button
          key={item.id}
          id={`sport-tab-${item.id}`}
          className={`sport-tab ${sport === item.id ? 'active' : ''}`}
          role="tab"
          aria-label={item.name}
          aria-selected={sport === item.id}
          aria-controls="sport-panel"
          tabIndex={sport === item.id ? 0 : -1}
          data-testid={`tab-${item.id}`}
          onClick={() => selectSport(item.id)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === 'ArrowRight') next = (index + 1) % SPORTS.length;
            else if (event.key === 'ArrowLeft') next = (index - 1 + SPORTS.length) % SPORTS.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = SPORTS.length - 1;
            else return;
            event.preventDefault();
            const nextSport = SPORTS[next].id;
            selectSport(nextSport);
            const tab = document.getElementById(`sport-tab-${nextSport}`);
            tab?.focus({ preventScroll: true });
            tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
        >{item.short}</button>)}
      </div>

      <div id="sport-panel" role="tabpanel" aria-labelledby={`sport-tab-${sport}`}>
      {query.isError && <div className="error-box" role="alert" data-testid="status-dashboard-error"><span><AlertCircle size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} />Couldn’t load this slate. Check your connection and try again.</span><button className="btn" onClick={refresh}><RefreshCw size={14} /> Retry</button></div>}
      {(advanceNotice || data?.slateNotice) && <div className="slate-notice" role="status" data-testid="slate-advance-notice"><CalendarDays size={15} /><span>{advanceNotice || data?.slateNotice}</span></div>}
      <div style={{ height: 17 }} />

      {coverageList.length > 0 && <section className="coverage-strip" aria-label="Sport data coverage" data-testid="coverage-sports">
        {coverageList.map((coverage) => <div className="coverage-item" key={coverage.sport} title={coverage.message} data-testid={`coverage-${coverage.sport}`}>
          <div className="coverage-name">{coverage.label}</div>
          <div className="coverage-dots" aria-label={`${coverage.eventsAvailable ? 'Events' : 'No events'}, ${coverage.projectionsAvailable ? 'projections' : 'no projections'}, ${coverage.newsAvailable ? 'news' : 'no news'}`}>
            <span className={`coverage-dot ${coverage.eventsAvailable ? '' : 'off'}`} title="Events" /><span className={`coverage-dot ${coverage.projectionsAvailable ? '' : 'off'}`} title="Projections" /><span className={`coverage-dot ${coverage.newsAvailable ? '' : 'off'}`} title="News" />
          </div>
          <div className="coverage-caption">E · P · N</div>
        </div>)}
      </section>}
      {coverageList.length > 0 && <div className="coverage-legend"><span><i className="coverage-dot" /> Events</span><span><i className="coverage-dot" /> Projections</span><span><i className="coverage-dot" /> News</span><span className="coverage-legend-note">Dimmed indicator means this feed is not available for that sport.</span></div>}

      {!projectionsOnly && <section className="summary-strip" aria-label={`${sportName} slate summary`} data-testid="summary-slate">
        <div className="summary-intro"><span className="summary-kicker">AT A GLANCE</span><span className="summary-sport">{sportName}</span></div>
        <div className="summary-metric"><strong>{events.length}</strong><span>EVENTS</span></div>
        <div className="summary-metric"><strong>{events.filter((event) => event.totalPoints != null).length}</strong><span>TOTALS</span></div>
        <div className="summary-metric"><strong>{canSeeForecasts ? salaryRows.length : 'Locked'}</strong><span>PLAYER SALARIES</span></div>
        <Link className="summary-metric summary-model-link" href="/projections" aria-label="Open own model sheet"><strong>OPEN</strong><span>OWN MODEL SHEET</span></Link>
      </section>}

      <div className={`content-grid ${projectionsOnly ? 'projections-page-grid' : ''}`}>
        <div className="left-stack">
          {!projectionsOnly && <section className="panel" id="slate-section" aria-labelledby="slate-heading">
            <div className="panel-head panel-head-accent"><h2 className="panel-title" id="slate-heading"><CalendarDays size={16} /> {sportName} slate</h2><span className="panel-meta">{loading ? 'UPDATING' : `${events.length} ${events.length === 1 ? 'EVENT' : 'EVENTS'}`}</span></div>
            <div className="panel-body"><EventSlate events={events} loading={loading && !data} /></div>
          </section>}
          <section className="panel" id="projections-section" aria-labelledby="projections-heading">
            <div className="panel-head panel-head-accent"><h2 className="panel-title" id="projections-heading"><TrendingUp size={16} /> ALLPLAY custom model</h2><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="panel-meta">RAW MATCHUP STATS</span><Link href="/projections" className="btn btn-quiet" style={{ height: 29, fontSize: 10 }} data-testid="link-full-projections">Full model sheet</Link></div></div>
            <div className="panel-body" style={{ paddingTop: 12, paddingBottom: 15 }}>
              {!projectionsOnly && <ModelPreview sport={sport} date={date} />}
              {projectionsOnly && <ModelPreview sport={sport} date={date} />}
              <details className="salary-only-disclosure">
                <summary>Salary-only view <span>Platform salary rows are not model projections</span></summary>
                {!canSeeForecasts ? <div className="salary-locked-note"><ShieldCheck size={14} /> Salary browsing stays behind verified member access. No forecast values appear here.</div>
                  : <><SalaryControls platform={salaryPlatform} coverage={salaryCoverage} loading={loading} onPlatformChange={setSalaryPlatform} onSlateChange={(id) => setSalarySelection({ context: salaryContext, id })} /><p className="salary-only-note">Salary metadata only. No third-party projections, predicted points, or projection-derived value are shown.</p><SalaryOnlyRows rows={salaryRows} /></>}
              </details>
              {!canSeeForecasts && <div className="member-cta">
                <div className="member-cta-copy">
                  <h3 className="member-cta-title"><ShieldCheck size={15} /> {membershipUnavailable ? 'Member access could not be verified' : membership.isLoading && signedIn ? 'Checking model access' : 'ALLPLAY model sheet is member-only'}</h3>
                  <p>{membershipUnavailable ? (memberStatus?.error || 'Player model data stays sealed until access is verified. Retry from account settings.') : membership.isLoading && signedIn ? 'Player data stays locked while your account status loads.' : 'Join to inspect ALLPLAY estimates, matchup adjustments and raw historical appearances. No provider forecast data is included.'}</p>
                </div>
                <div className="member-cta-action">{signedIn ? membershipUnavailable || membership.isLoading || memberStatus?.hasAccess ? <Link href="/account" className="btn btn-quiet">Membership status</Link> : <MembershipCheckoutButton signedIn={signedIn} label="Join ALLPLAY" /> : <Link href="/sign-in" className="btn btn-primary">Sign in to continue</Link>}</div>
              </div>}
            </div>
          </section>
        </div>
        {!projectionsOnly && <div className="right-stack">
          <section className="panel" id="news-section" aria-labelledby="news-heading">
            <div className="panel-head panel-head-accent"><h2 className="panel-title" id="news-heading"><Newspaper size={16} /> {sportName} news</h2><span className="panel-meta">{loading ? 'UPDATING' : `${news.length} STORIES`}</span></div>
            <div key={sport} className="panel-body news-scroll" role="region" aria-labelledby="news-heading" tabIndex={0} data-testid="news-scroll"><NewsFeed news={news} loading={loading && !data} /></div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title"><Smartphone size={16} /> Your slate, one tap away</h2></div>
            <div className="panel-body">
              <p className="coverage-detail" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>Install this dashboard for a fast, focused home-screen launch on your devices.</p>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setInstallOpen(true)} data-testid="button-install"><ArrowDownToLine size={15} /> Install / setup help</button>
            </div>
          </section>
        </div>}
      </div>
      </div>
      <div className="footer-line">BUILT FOR THE MOMENT BEFORE LOCK · YOUR SLATE, YOUR CALL</div>
    </main>
    {installOpen && <InstallDialog onClose={() => setInstallOpen(false)} onInstall={doInstall} canInstall={!!installPrompt} isInstalled={installed} installing={installing} installError={installError} />}
  </div>;
}
