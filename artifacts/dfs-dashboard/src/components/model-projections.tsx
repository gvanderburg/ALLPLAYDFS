import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { getGetDfsDashboardQueryKey, useGetDfsDashboard } from '@workspace/api-client-react';
import type { DfsDashboard, DfsSalaryPlatform, DfsSport, GetDfsDashboardParams, GetModelProjectionsParams, ModelMetric, ModelPlayerProjection, ModelProjectionSheet, ModelStatEstimate } from '@workspace/api-client-react';
import MembershipCheckoutButton from '@/components/membership-checkout-button';
import { ResearchShortlist } from '@/components/research-shortlist';
import { useModelProjections } from '@/hooks/use-model-projections';
import { buildModelSheetCsv, findUniqueSelectedSlateSalary } from '@/lib/model-sheet-export';
import { InjuryBadge } from '@/components/injury-badge';
import { PublishedMatchupCell } from '@/components/published-matchup-cell';
import { MatchupReportManager } from '@/components/matchup-report-manager';
import { positionRanks, formatValueMultiple } from '@/lib/position-ranks';
import { deriveLineupInsights } from '@/lib/lineup-insights';
import {
  Activity, AlertCircle, ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, BarChart3,
  CalendarDays, ChevronRight, CircleHelp, Download, Film, Info,
  LockKeyhole, Newspaper, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal,
  TrendingUp, UserRound,
} from 'lucide-react';

export const MODEL_SPORTS: { id: DfsSport; label: string; short: string }[] = [
  { id: 'nfl', label: 'NFL', short: 'NFL' },
  { id: 'nhl', label: 'NHL', short: 'NHL' },
  { id: 'wnba', label: 'WNBA', short: 'WNBA' },
  { id: 'nba', label: 'NBA', short: 'NBA' },
  { id: 'mlb', label: 'MLB', short: 'MLB' },
  { id: 'nascar', label: 'NASCAR', short: 'NASCAR' },
  { id: 'cfb', label: 'College football', short: 'CFB' },
];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const defaultSettings = { recentGames: 5, recentWeight: 70, matchupWeight: 25 };
type Settings = typeof defaultSettings;
const fmt = (value: number | null | undefined, unit = '') => value == null || !Number.isFinite(value) ? '—' : `${Number(value.toFixed(2))}${unit ? ` ${unit}` : ''}`;
const readableDate = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(value.includes('T') ? { hour: 'numeric', minute: '2-digit' } : {}) }) : '—';
const fantasySites = ['draftkings', 'fanduel', 'yahoo', 'ownersbox'] as const;
type FantasySite = typeof fantasySites[number];
const siteLabel = (site: FantasySite) => ({ draftkings: 'DraftKings', fanduel: 'FanDuel', yahoo: 'Yahoo', ownersbox: 'OwnersBox' })[site];
const forecastFor = (player: ModelPlayerProjection, site: FantasySite) => player.roleContext?.eligible === false ? undefined : player.fantasy?.find((item) => item.site === site);

function exportSheet(sheet: ModelProjectionSheet, dashboard: DfsDashboard | undefined, platform: DfsSalaryPlatform) {
  if (sheet.status !== 'ready') return;
  const csv = buildModelSheetCsv(sheet, dashboard, platform);
  if (!csv) return;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `allplay-${sheet.sport}-${sheet.slateDate}-research.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function AccessGate({ signedIn, membership, onRefresh }: { signedIn: boolean; membership: ReturnType<typeof useModelProjections>['membership']; onRefresh: () => void }) {
  const member = membership.data;
  const unavailable = membership.isError || !!member?.error || (!!member && (!member.ready || member.status.toLowerCase() === 'unavailable'));
  return <section className="model-gate">
    <div className="model-gate-icon"><LockKeyhole size={20} /></div>
    <span className="model-kicker">PRIVATE MODEL ROOM</span>
    <h2>{membership.isLoading && signedIn ? 'Verifying your membership' : unavailable ? 'Access could not be verified' : 'Independent projections, member access'}</h2>
    <p>{membership.isLoading && signedIn
      ? 'The model sheet stays sealed until your account is checked.'
      : unavailable
        ? 'No player estimates are shown until ALLPLAY confirms access. Retry or check your account.'
        : 'Independent raw-stat estimates, site-rule fantasy simulations where supported, model inputs and each player’s recent history.'}</p>
    <div className="model-gate-actions">
      {!signedIn ? <Link href="/sign-in" className="btn btn-primary">Sign in to verify</Link>
        : unavailable ? <><button type="button" className="btn btn-primary" onClick={onRefresh}><RefreshCw size={14} /> Retry access check</button><Link href="/account" className="btn btn-quiet">Account</Link></>
          : member?.hasAccess ? <button type="button" className="btn btn-quiet" onClick={onRefresh}><RefreshCw size={14} /> Check access again</button>
            : <><MembershipCheckoutButton signedIn={signedIn} label="Join ALLPLAY" /><Link href="/account" className="btn btn-quiet">Membership details</Link></>}
    </div>
    <small><ShieldCheck size={13} /> Player data is never saved in this browser.</small>
  </section>;
}

function ModelState({ sheet, loading, error, onRetry }: { sheet?: ModelProjectionSheet; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <div className="model-state model-state-loading" aria-label="Loading model sheet">
    <div className="model-loading-heading"><div className="skeleton" /><div className="skeleton" /></div>
    {[0, 1, 2, 3].map((n) => <div className="skeleton model-loading-row" key={n} />)}
    <span>Loading the requested sport and date…</span>
  </div>;
  if (error || sheet?.status === 'error') return <div className="model-state" role="alert"><AlertCircle size={22} /><h3>The model sheet did not load</h3><p>Player values remain hidden until the request succeeds.</p><button className="btn btn-primary" onClick={onRetry}><RefreshCw size={14} /> Retry model</button></div>;
  if (sheet?.status === 'warming') return <div className="model-warming" role="status">
    <div className="warming-mark"><RefreshCw size={17} className="model-pulse" /></div>
    <div className="warming-copy"><span className="model-kicker">MODEL IN PROGRESS</span><strong>Building the {sheet.sport.toUpperCase()} sheet</strong><p>Processing {sheet.processedGames} of {sheet.totalGames} games · {sheet.failedGames} failed · {sheet.observedTeams} teams observed</p></div>
    <div className="warming-progress" role="progressbar" aria-valuenow={sheet.totalGames ? Math.round(sheet.processedGames / sheet.totalGames * 100) : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ transform: `scaleX(${sheet.totalGames ? Math.min(1, sheet.processedGames / sheet.totalGames) : 0})` }} /></div>
  </div>;
  if (sheet?.status === 'unavailable') return <div className="model-state"><CircleHelp size={22} /><h3>Sheet unavailable for this slate</h3><p>{sheet.notes.join(' ') || `There is no published ${sheet.sport.toUpperCase()} model data for ${sheet.requestedDate}.`}</p><small>Unavailable is a real coverage state, not a zero projection.</small></div>;
  return null;
}

const MetricRank = memo(function MetricRank({ stat, tier }: { stat?: ModelStatEstimate; tier?: string }) {
  const value = stat?.projected;
  if (value == null) return <span className="model-number model-missing">—</span>;
  return <span className={`model-number model-tier-${tier ?? 'mid-high'}`} title="Relative only to this sheet; not a calibrated probability">{value.toFixed(2)}</span>;
});

function HistoryTrendCell({ player, metric }: { player: ModelPlayerProjection; metric?: ModelMetric }) {
  if (!metric) return <span className="model-history-unavailable">—</span>;
  const observations = player.history
    .map((item, index) => ({
      date: item.date,
      timestamp: Date.parse(item.date),
      value: item.stats[metric.id],
      index,
    }))
    .filter((item) => Number.isFinite(item.timestamp) && Number.isFinite(item.value))
    .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  if (observations.length < 2) {
    return <span className="model-history-unavailable" title={`Fewer than two dated actual ${metric.label} observations are available.`}>—</span>;
  }
  const values = observations.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = observations.map((item, index) => ({
    x: 3 + index * (64 / (observations.length - 1)),
    y: 15 - ((item.value - min) / span) * 12,
  }));
  const accessibleText = `Actual ${metric.label} observations, oldest to newest: ${observations
    .map((item) => `${readableDate(item.date)}: ${fmt(item.value, metric.unit)}`)
    .join('; ')}.`;
  const estimate = player.stats.find((stat) => stat.id === metric.id);
  const delta = estimate?.projected != null && estimate.recentAverage != null
    ? estimate.projected - estimate.recentAverage
    : null;
  const favorable = delta == null || delta === 0 ? 'neutral' : delta * (metric.higherIsBetter ? 1 : -1) > 0 ? 'favorable' : 'unfavorable';
  return <span className="model-history-trend" title={accessibleText}>
    <svg className="model-history-sparkline" viewBox="0 0 70 18" role="img" aria-label={accessibleText}>
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
      {points.map((point, index) => <circle key={`${observations[index].date}-${index}`} cx={point.x} cy={point.y} r="1.35" />)}
    </svg>
    {delta != null && <small className={`model-history-delta delta-${favorable}`} title={`ALLPLAY estimate minus recent actual average: ${fmt(delta, metric.unit)}. Color indicates raw-stat direction only; it is not a confidence rating.`}>Δ {delta > 0 ? '+' : ''}{delta.toFixed(2)}</small>}
  </span>;
}

function PlayerDetail({ player, sheet, metrics }: { player: ModelPlayerProjection; sheet: ModelProjectionSheet; metrics: ModelMetric[] }) {
  const forecasts = player.fantasy ?? [];
  return <div className="model-detail">
    {player.reason && <div className="model-reason"><Info size={14} />{player.reason}</div>}
    <section className="fantasy-detail">
      <div className="model-history-head"><strong>FANTASY SCORING · ALLPLAY SIMULATIONS</strong><span>Source verified where available · not backtested</span></div>
      <p className="fantasy-detail-note">Where a scoring source is verified, published site rules convert ALLPLAY's independent stat forecasts. Unsupported scoring stays unavailable. Ready forecasts include full points and ranges. Partial tracked points are a known-stat subtotal, never a full projection. Percentiles describe simulated outcomes, not confidence intervals.</p>
      <div className="fantasy-detail-grid">{fantasySites.map((site) => {
        const forecast = forecasts.find((item) => item.site === site);
        const ready = forecast?.status === 'ready';
        return <article className="fantasy-site-detail" key={site}>
          <div><strong>{siteLabel(site)}</strong><span className={`forecast-status forecast-${forecast?.status ?? 'unavailable'}`}>{forecast?.status ?? 'unavailable'}</span></div>
          <dl><dt>Full mean</dt><dd>{fmt(ready ? forecast.mean : null)}</dd><dt>Tracked subtotal</dt><dd>{fmt(forecast?.trackedMean)}</dd><dt>Std / simulations</dt><dd>{ready ? `${fmt(forecast.std)} / ${forecast.simulations || '—'}` : '—'}</dd></dl>
          <p>{forecast?.missingStats.length ? `Missing inputs: ${forecast.missingStats.join(', ')}` : forecast ? 'No missing scored inputs reported.' : 'No forecast published.'}</p>
          {forecast?.scoringSource && <a href={forecast.scoringSource} target="_blank" rel="noreferrer">Scoring rules source</a>}
          <small>Rules as of {forecast?.rulesAsOf || '—'} · sample {forecast?.sampleSize ?? '—'}</small>
          {forecast?.notes.map((note, index) => <small key={`${site}-note-${index}`}>{note}</small>)}
        </article>;
      })}</div>
    </section>
    <div className="model-detail-table-wrap">
      <table className="model-detail-table"><thead><tr><th>STAT</th><th>ESTIMATE</th><th>RECENT AVG</th><th>BASELINE ≤10</th><th>OPP RANK</th><th>ADJUSTMENT</th><th>OPP AVG</th><th>LEAGUE AVG</th><th>SAMPLE</th></tr></thead>
        <tbody>{player.stats.map((stat) => {
          const metric = metrics.find((item) => item.id === stat.id);
          return <tr key={stat.id}><th>{metric?.label ?? stat.id}<small>{metric?.unit || 'raw stat'}</small></th><td className="detail-highlight">{fmt(stat.projected, metric?.unit)}</td><td>{fmt(stat.recentAverage, metric?.unit)} <small>n={stat.recentSampleSize}</small></td><td>{fmt(stat.baselineAverage, metric?.unit)}</td><td>{stat.opponentRank == null ? '—' : `${stat.opponentRank} / ${stat.rankedTeams || '—'}`}<small>{stat.rankedTeams ? 'observed teams' : 'unranked'}</small></td><td>{fmt(stat.matchupMultiplier, '×')}</td><td>{fmt(stat.opponentMean, metric?.unit)}<small>{stat.matchupBasis || 'Per game'} · {stat.defenseGames} games</small></td><td>{fmt(stat.leagueMean, metric?.unit)}<small>{stat.matchupBasis || 'Per game'}</small></td><td>{stat.sampleSize} <small>total</small></td></tr>;
        })}</tbody>
      </table>
    </div>
    <div className="model-history">
      {sheet.sport === 'nascar' && <p className="model-reference-note">Starting inputs: {player.stats.filter(stat => ['start', 'qualifyingStart'].includes(stat.id)).map(stat => `${sheet.metrics.find(metric => metric.id === stat.id)?.label}: ${stat.matchupBasis || 'Unavailable'}`).join(' · ')}. Lap forecasts use verified race lap rates scaled to scheduled length. Fastest-lap counts are unavailable from the official weekend feed; DraftKings full totals remain blank. FanDuel uses original qualifying position separately from adjusted starting position.</p>}
      {player.stats.some(stat => stat.ratePriorMean != null) && <p className="model-reference-note">Rare-event efficiency uses observed league evidence: {player.stats.filter(stat => stat.ratePriorMean != null).map(stat => `${sheet.metrics.find(metric => metric.id === stat.id)?.label || stat.id}: ${(stat.ratePriorMean! * 100).toFixed(2)}% per opportunity, prior strength ${(stat.ratePriorOpportunities ?? 0).toFixed(1)} (${stat.ratePriorScope || 'cohort not published'})`).join(' · ')}. These are stabilizing historical inputs, not calibrated outcome probabilities.</p>}
      <div className="model-history-head"><strong>LAST PERFORMANCES</strong><span>{player.history.length} appearances · cutoff {readableDate(sheet.effectiveAsOf)}</span></div>
      {player.history.length ? <div className="model-history-list">{player.history.map((item) => <article className="model-history-row" key={`${player.id}-${item.eventId}-${item.date}`}><time>{readableDate(item.date)}</time><span>vs {item.opponent || '—'}</span><div>{Object.entries(item.stats).map(([id, value]) => {
        const metric = metrics.find((candidate) => candidate.id === id);
        return <span className="history-stat" key={id}><b>{fmt(value)}</b><small>{metric?.label ?? id}</small></span>;
      })}</div></article>)}</div> : <p className="model-history-empty">No appearance-level history was published for this player.</p>}
    </div>
  </div>;
}

export function PlayerTable({ sheet, dashboard, platform, onPlatformChange }: { sheet: ModelProjectionSheet; dashboard?: DfsDashboard; platform: DfsSalaryPlatform; onPlatformChange: (platform: DfsSalaryPlatform) => void }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const hasScoring = sheet.players.some(player => forecastFor(player, platform)?.status === 'ready');
  const historyMetric = useMemo(() => sheet.metrics.find((metric) => sheet.players.some((player) =>
    player.history.filter((item) => Number.isFinite(Date.parse(item.date)) && Number.isFinite(item.stats[metric.id])).length >= 2,
  )) ?? sheet.metrics[0], [sheet.metrics, sheet.players]);
  const [sortBy, setSortBy] = useState(hasScoring ? 'fantasy:mean' : 'name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [columnView, setColumnView] = useState<'full' | 'raw' | 'fantasy'>('full');
  const [fantasySite, setFantasySite] = useState<FantasySite>(platform);
  const [detailPlayer, setDetailPlayer] = useState<ModelPlayerProjection | null>(null);
  const research = useMemo(() => deriveLineupInsights(sheet, dashboard, platform, fantasySite, 'balanced'), [sheet, dashboard, platform, fantasySite]);
  const researchByPlayer = useMemo(() => new Map(research.rows.map((row) => [row.playerId, row])), [research.rows]);
  const positionRankByPlayer = useMemo(() => positionRanks(sheet, fantasySite), [sheet, fantasySite]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const detailDialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { setDetailPlayer(null); }, [sheet]);
  useEffect(() => {
    if (!detailPlayer) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailPlayer(null);
      if (event.key === 'Tab') {
        const focusable = detailDialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const elements = [...(focusable ?? [])].filter((element) => element.getAttribute('aria-hidden') !== 'true');
        if (!elements.length) {
          event.preventDefault();
          return;
        }
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || !detailDialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !detailDialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [detailPlayer]);
  const salaryRows = useMemo(() => {
    return sheet.players.map((player) => ({ playerId: player.id,
      row: findUniqueSelectedSlateSalary(player, sheet, dashboard, platform) }));
  }, [dashboard, sheet, platform]);
  const salaryFor = (playerId: string) => salaryRows.find((item) => item.playerId === playerId)?.row?.salary;
  const salaryCoverage = dashboard?.salaryCoverage;
  const matchupFor = (player: ModelPlayerProjection) => {
    if (!dashboard || dashboard.date?.slice(0, 10) !== sheet.slateDate?.slice(0, 10)) return undefined;
    const team = player.team.trim().toLocaleLowerCase();
    const opponent = player.opponent.trim().toLocaleLowerCase();
    if (!team || !opponent) return undefined;
    const games = dashboard.events.filter((event) => event.sport === sheet.sport && event.competitors.some((item) => item.abbreviation.trim().toLocaleLowerCase() === team) && event.competitors.some((item) => item.abbreviation.trim().toLocaleLowerCase() === opponent));
    if (games.length !== 1) return undefined;
    return games[0].competitors.find((item) => item.abbreviation.trim().toLocaleLowerCase() === team);
  };
  const roles = useMemo(() => [...new Set(sheet.players.map((player) => player.position).filter(Boolean))].sort(), [sheet.players]);
  const rankTiers = useMemo(() => {
    const result = new Map<string, Map<string, string>>();
    for (const metric of sheet.metrics) {
      const players = sheet.players.flatMap((player) => {
        const value = player.stats.find((stat) => stat.id === metric.id)?.projected;
        return value == null ? [] : [{ id: player.id, value }];
      });
      const sorted = players.map((player) => player.value).sort((a, b) => metric.higherIsBetter ? b - a : a - b);
      const tiers = new Map<string, string>();
      for (const player of players) {
        const rank = sorted.indexOf(player.value);
        const percentile = sorted.length < 2 ? .5 : rank / (sorted.length - 1);
        tiers.set(player.id, percentile < .25 ? 'high' : percentile < .5 ? 'mid-high' : percentile < .75 ? 'mid-low' : 'low');
      }
      result.set(metric.id, tiers);
    }
    return result;
  }, [sheet.metrics, sheet.players]);
  const fantasyTiers = useMemo(() => {
    const result = new Map<string, Map<string, string>>();
    const keys = ['mean', 'value', 'p25', 'p50', 'p75', 'p85', 'p95', 'p99', 'std'] as const;
    for (const key of keys) {
      const ranked = sheet.players.flatMap((player) => {
        const forecast = forecastFor(player, fantasySite);
        if (forecast?.status !== 'ready') return [];
        const salary = salaryFor(player.id);
        const value = key === 'value'
          ? fantasySite === platform && salary != null && salary > 0 ? (forecast.mean ?? NaN) / (salary / 1000) : null
          : forecast[key];
        return value == null || !Number.isFinite(value) ? [] : [{ id: player.id, value }];
      });
      const sorted = ranked.map((item) => item.value).sort((a, b) => b - a);
      const tiers = new Map<string, string>();
      for (const item of ranked) {
        const percentile = sorted.length < 2 ? .5 : sorted.indexOf(item.value) / (sorted.length - 1);
        tiers.set(item.id, percentile < .25 ? 'high' : percentile < .5 ? 'mid-high' : percentile < .75 ? 'mid-low' : 'low');
      }
      result.set(`fantasy:${key}`, tiers);
    }
    return result;
  }, [sheet.players, fantasySite, platform, salaryRows]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sheet.players.filter((player) =>
      (!term || [player.id, player.name, player.team, player.opponent, player.position].some((value) => value.toLowerCase().includes(term)))
      && (role === 'all' || player.position === role),
    ).sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name) * (direction === 'asc' ? 1 : -1);
      const valueFor = (player: ModelPlayerProjection) => {
        const pick = researchByPlayer.get(player.id);
        if (sortBy === 'research:rank') return pick?.rank ?? null;
        if (sortBy === 'position:rank') return positionRankByPlayer.get(player.id)?.rank ?? null;
        if (sortBy.startsWith('published:')) return player.publishedMatchups?.find(row => row.source === sortBy.slice(10))?.rank ?? null;
        if (sortBy === 'research:ownership') return pick?.estimatedOwnership ?? null;
        if (sortBy.startsWith('fantasy:')) {
          const key = sortBy.slice('fantasy:'.length) as 'mean' | 'value' | 'p25' | 'p50' | 'p75' | 'p85' | 'p95' | 'p99' | 'std';
          const forecast = forecastFor(player, fantasySite);
          if (forecast?.status !== 'ready') return null;
          if (key === 'value') {
            const salary = salaryFor(player.id);
            return fantasySite === platform && salary != null && salary > 0 && forecast.mean != null
              ? forecast.mean / (salary / 1000)
              : null;
          }
          return forecast[key];
        }
        return player.stats.find((stat) => stat.id === sortBy)?.projected;
      };
      const av = valueFor(a);
      const bv = valueFor(b);
      if (av == null) return bv == null ? a.name.localeCompare(b.name) : 1;
      if (bv == null) return -1;
      return (av - bv) * (direction === 'asc' ? 1 : -1);
    });
  }, [sheet.players, search, role, sortBy, direction, fantasySite, platform, salaryRows, researchByPlayer, positionRankByPlayer]);
  const toggleSort = (id: string) => {
    if (sortBy === id) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(id); setDirection(id === 'name' || id === 'research:rank' || id === 'position:rank' || id.startsWith('published:') ? 'asc' : 'desc'); }
  };
  const sortHeader = (label: string, id: string, detail?: string) => <th key={id} aria-sort={sortBy === id ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button onClick={() => toggleSort(id)} title={`Sort by ${label}`}>{label}{sortBy === id ? direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : <ArrowUpDown size={11} />}{detail && <small>{detail}</small>}</button>
  </th>;
  return <div className="model-table-area">
     <div className="model-table-tools">
      <label className="model-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a player, team, opponent…" aria-label="Search model players" /><kbd>/</kbd></label>
      <label className="model-role-filter"><UserRound size={14} /><span className="sr-only">Filter by role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="model-salary-filter"><span>DFS site</span><select value={platform} onChange={(event) => { const next = event.target.value as DfsSalaryPlatform; onPlatformChange(next); setFantasySite(next); setSortBy('fantasy:mean'); setDirection('desc'); }} aria-label="DFS platform"><option value="draftkings">DraftKings</option><option value="fanduel">FanDuel</option></select></label>
      <label className="model-salary-filter"><span>Columns</span><select value={columnView} onChange={(event) => { const next = event.target.value as 'full' | 'raw' | 'fantasy'; setColumnView(next); setSortBy(next === 'raw' ? 'name' : 'fantasy:mean'); setDirection(next === 'raw' ? 'asc' : 'desc'); }} aria-label="Sheet columns"><option value="full">Full sheet · all categories</option><option value="raw">Raw stats</option><option value="fantasy">Fantasy scoring</option></select></label>
      {columnView !== 'raw' && <label className="model-salary-filter"><span>Scoring rules</span><select value={fantasySite} onChange={(event) => { setFantasySite(event.target.value as FantasySite); setSortBy('fantasy:mean'); setDirection('desc'); }} aria-label="Fantasy scoring site">{fantasySites.map((site) => <option key={site} value={site}>{siteLabel(site)}</option>)}</select></label>}
      <span className="model-result-count">{visible.length} <i>/</i> {sheet.players.length}</span>
    </div>
     <ResearchShortlist sheet={sheet} dashboard={dashboard} platform={platform} site={fantasySite} onOpenPlayer={(playerId) => {
       const player = sheet.players.find((item) => item.id === playerId);
       if (player) setDetailPlayer(player);
     }} />
       <div className="model-salary-coverage" role="status">Value is displayed as a compact multiple, such as 3.4x.{salaryCoverage?.platform === platform && salaryCoverage.available ? ' Matching salaries are used behind the scenes.' : ' Verified salary coverage is unavailable; value may be blank.'} Position ranks compare fully scored candidates not ruled out, by primary role on this slate—not league-wide rankings. Wings/outfielders/pitchers share their DFS role groups. Scroll sideways for all categories.</div>
       {sheet.sport === 'nfl' && <div className="model-published-notes" aria-label="Published matchup source coverage">
         {(['pff', 'fantasypros'] as const).map(source => {
           const ranking = sheet.players.flatMap(player => player.publishedMatchups ?? []).find(row => row.source === source && row.asOf);
           return <span key={source}><strong>{source === 'pff' ? 'PFF SECONDARY' : 'FANTASYPROS vs POSITION'}</strong> {ranking?.period ?? 'Source unavailable'} · {source === 'pff' ? '#1 strongest / hardest' : '#1 most allowed / easiest'}<small>{ranking?.note ?? 'Unverified or inaccessible teams stay unavailable.'} Periods and coverage can differ by position; each cell carries its own provenance.</small></span>;
         })}
         <small>Published ratings are matchup context, not replacements for ALLPLAY forecasts. Other sports need sport-specific published sources.</small>
       </div>}
    {sheet.players.length === 0 ? <div className="model-state model-empty"><TrendingUp size={22} /><h3>No player estimates published</h3><p>There are no model rows for this date. Missing samples stay blank; they are never filled with zero.</p></div>
      : visible.length === 0 ? <div className="model-state model-empty"><Search size={20} /><h3>No matching players</h3><p>Try another name or role.</p><button className="btn btn-quiet" onClick={() => { setSearch(''); setRole('all'); }}>Clear filters</button></div>
         : <div className="model-grid-scroll" role="region" aria-label="ALLPLAY full projection sheet; scroll horizontally and vertically" tabIndex={0}>
          <table className="model-grid">
              <thead><tr><th className="model-player-column"><button onClick={() => toggleSort('name')}>PLAYER {sortBy === 'name' ? direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} />}</button></th>
                {sortHeader('Research rank', 'research:rank', 'balanced shortlist')}
                 {sortHeader('Position rank', 'position:rank', `${siteLabel(fantasySite)} · slate only`)}
                {sortHeader('Est. ownership', 'research:ownership', 'heuristic · when supported')}
                <th className="model-history-cell">{historyMetric ? `RECENT ${historyMetric.label}` : 'RECENT HISTORY'}<small>actual · Δ model−recent</small></th><th>ROLE</th><th>TEAM / OPP</th>
                <th>DEPTH / PLAYING ROLE<small>dated evidence · workload</small></th>
                {sortHeader('PFF secondary', 'published:pff', '#1 strongest · NFL pass context')}
                {sortHeader('Defense vs position', 'published:fantasypros', 'FantasyPros · #1 easiest · NFL')}
                {columnView !== 'raw' && <>{sortHeader(`${siteLabel(fantasySite)} Points`, 'fantasy:mean')}{sortHeader('VALUE', 'fantasy:value', `${platform === 'draftkings' ? 'DK' : 'FD'} · multiple`)}{sortHeader('P25', 'fantasy:p25')}{sortHeader('P50', 'fantasy:p50')}{sortHeader('P75', 'fantasy:p75')}{sortHeader('P85', 'fantasy:p85')}{sortHeader('P95', 'fantasy:p95')}{sortHeader('P99', 'fantasy:p99')}{sortHeader('Std', 'fantasy:std')}<th>STATUS / INPUTS</th></>}
                {columnView !== 'fantasy' && sheet.metrics.map((metric) => <th className="model-stat-header" key={metric.id}><button onClick={() => toggleSort(metric.id)} title={`Sort by ${metric.label}`}>{metric.label}{sortBy === metric.id ? direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : <ArrowUpDown size={11} />}<small>{metric.unit || metric.group}</small></button></th>)}
                <th>ALLPLAY TEAM</th><th>ALLPLAY GAME</th>
              <th className="model-samples-head">SAMPLE</th><th aria-label="Details" /></tr></thead>
             <tbody>{visible.map((player, rowIndex) => <tr key={player.id} className="model-player-row">
                <td className="model-player-name"><span className="model-player-cell"><span className="model-row-index" title={`Row ${rowIndex + 1} in the current sorted view`}>{rowIndex + 1}</span><span title={player.participation}><strong>{player.name}</strong><InjuryBadge status={player.availability} /></span></span></td>
                <td className="research-cell">{researchByPlayer.get(player.id)?.rank ?? '—'}</td>
                 <td className="research-cell" title="Competition rank within this slate's fully scored, active primary-role peer group; tied projections share a rank.">{positionRankByPlayer.has(player.id) ? `${positionRankByPlayer.get(player.id)!.position} #${positionRankByPlayer.get(player.id)!.rank}/${positionRankByPlayer.get(player.id)!.count}` : '—'}</td>
                <td className="research-cell">{researchByPlayer.get(player.id)?.estimatedOwnership == null ? '—' : `${researchByPlayer.get(player.id)?.estimatedOwnership?.toFixed(1)}%`}</td>
                <td className="model-history-cell"><HistoryTrendCell player={player} metric={historyMetric} /></td>
              <td className="model-mono">{player.position || '—'}</td>
              <td><span className="model-team">{matchupFor(player)?.logo && <img className="model-team-logo" src={matchupFor(player)?.logo ?? undefined} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}{player.team || '—'}</span><small className="model-opponent">{matchupFor(player)?.homeAway === 'away' ? 'at' : 'vs'} {player.opponent || '—'}</small></td>
               <td className="model-playing-role" title={player.roleContext ? `${player.roleContext.source} · ${player.roleContext.asOf ?? 'Date unavailable'} · ${player.roleContext.note}` : player.participation}>
                 {player.roleContext?.sourceUrl ? <a href={player.roleContext.sourceUrl} target="_blank" rel="noopener noreferrer">{player.roleContext.label}</a> : player.roleContext?.label ?? 'Role unverified'}
                 <small>{player.roleContext?.eligible === false ? 'No supported slate workload' : player.roleContext?.recentWorkload != null ? `${player.roleContext.recentWorkload} recent ${player.roleContext.workloadUnit}` : 'Verify before lock'}</small>
               </td>
               <td className="model-stat-cell"><PublishedMatchupCell ranking={player.publishedMatchups?.find(row => row.source === 'pff')} /></td>
               <td className="model-stat-cell"><PublishedMatchupCell ranking={player.publishedMatchups?.find(row => row.source === 'fantasypros')} /></td>
               {columnView !== 'raw' && (() => {
                 const forecast = forecastFor(player, fantasySite);
                 const ready = forecast?.status === 'ready';
                 const mean = ready ? forecast.mean : null;
                 const salary = salaryFor(player.id);
                 const value = fantasySite === platform && mean != null && salary != null && salary > 0 ? mean / (salary / 1000) : null;
                 const fantasyNumber = (key: 'mean' | 'value' | 'p25' | 'p50' | 'p75' | 'p85' | 'p95' | 'p99' | 'std', number: number | null) => <span className={`model-number ${number == null ? 'model-missing' : `model-tier-${fantasyTiers.get(`fantasy:${key}`)?.get(player.id) ?? 'mid-high'}`}`} title="Relative rank within this sheet only; not a chance or calibrated probability">{key === 'value' ? formatValueMultiple(number) : fmt(number)}</span>;
                  return <><td className="model-stat-cell fantasy-mean" title={forecast?.status === 'partial' ? `Partial forecast; tracked subtotal ${fmt(forecast.trackedMean)} is not a full projection. ${forecast.missingStats.join(', ')}` : forecast?.notes.join(' ') || forecast?.status || 'No forecast published'}>{fantasyNumber('mean', mean)}</td><td className="model-stat-cell">{fantasyNumber('value', value)}</td>{(['p25', 'p50', 'p75', 'p85', 'p95', 'p99'] as const).map((key) => <td className="model-stat-cell" key={key}>{fantasyNumber(key, ready ? forecast[key] : null)}</td>)}<td className="model-stat-cell">{fantasyNumber('std', ready ? forecast.std : null)}</td><td className="forecast-cell" title={forecast?.missingStats.join(', ')}><span className={`forecast-status forecast-${forecast?.status ?? 'unavailable'}`}>{forecast?.status ?? 'unavailable'}</span><small>{forecast?.missingStats.length ? `${forecast.missingStats.length} missing inputs · see details` : ready ? 'Scored inputs complete' : 'See scoring details'}</small></td></>;
               })()}
               {columnView !== 'fantasy' && sheet.metrics.map((metric) => <td key={metric.id} className="model-stat-cell"><MetricRank stat={player.stats.find((stat) => stat.id === metric.id)} tier={rankTiers.get(metric.id)?.get(player.id)} /></td>)}
                <td className="model-stat-cell">{fmt(player.modelTeamTotal)}</td><td className="model-stat-cell">{fmt(player.modelGameTotal)}</td>
              <td className="model-sample">{player.historicalGames || '—'} <small>games</small></td>
              <td className="model-expand"><button type="button" aria-label={`Show ${player.name} calculation and history`} title="Calculation & history" onClick={(event) => { returnFocusRef.current = event.currentTarget; setDetailPlayer(player); }}><Info size={14} /></button></td>
            </tr>)}</tbody>
          </table>
        </div>}
    <div className="model-legend"><span><i className="legend-dot legend-mint" /> Higher within this sheet</span><span><i className="legend-dot legend-amber" /> Mid-range</span><span><i className="legend-dot legend-coral" /> Lower within this sheet</span><span className="legend-disclaimer">Color is relative to this slate only.</span></div>
    {detailPlayer && <div className="model-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailPlayer(null); }}><section ref={detailDialogRef} className="model-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="player-detail-title"><div className="model-detail-dialog-head"><div><span className="model-kicker">PLAYER DETAIL · PRIVATE MODEL</span><h2 id="player-detail-title">{detailPlayer.name}</h2><small className="model-id-caption">ALLPLAY model player ID · {detailPlayer.id}</small></div><button ref={closeButtonRef} className="btn btn-quiet" type="button" onClick={() => setDetailPlayer(null)}>Close</button></div><PlayerDetail player={detailPlayer} sheet={sheet} metrics={sheet.metrics} /></section></div>}
  </div>;
}

function SheetBody({ sheet, loading, error, retry, dashboard, platform, onPlatformChange }: { sheet?: ModelProjectionSheet; loading: boolean; error: boolean; retry: () => void; dashboard?: DfsDashboard; platform: DfsSalaryPlatform; onPlatformChange: (platform: DfsSalaryPlatform) => void }) {
  return <>
    <ModelState sheet={sheet} loading={loading} error={error} onRetry={retry} />
    {sheet?.status === 'ready' && <div className="model-sheet-content">
      <div className="model-sheet-overview">
        <div><span className="model-kicker">MODEL SHEET · {sheet.sport.toUpperCase()}</span><strong>{sheet.slateDate ? readableDate(sheet.slateDate) : 'Date not published'}</strong><small>Requested {sheet.requestedDate} · cut off {readableDate(sheet.effectiveAsOf)}</small></div>
        <div className="model-overview-stats"><span><b>{sheet.players.length}</b><small>PLAYERS</small></span><span><b>{sheet.gameCount}</b><small>GAMES</small></span><span><b>{sheet.observedTeams}</b><small>TEAMS</small></span><span><b>{sheet.failedGames}</b><small>FAILED</small></span></div>
      </div>
      <PlayerTable sheet={sheet} dashboard={dashboard} platform={platform} onPlatformChange={onPlatformChange} />
      <div className="model-method">
        <div className="model-method-title"><BarChart3 size={15} /><strong>WHAT PRODUCES THE NUMBER</strong><span>ALLPLAY CUSTOM MODEL · NOT BACKTESTED</span></div>
        <p>{sheet.modelFormula || 'Recent player performance is blended with up to ten appearances, then adjusted by observed opponent matchup history.'} Fantasy points are base scores, before any Showdown MVP/Captain multiplier.</p>
        <ul>{sheet.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
         <div className="model-caveats"><span>Conditional on participation</span><span>Observed ranks are not calibrated probabilities</span><span>Rank 1 = lowest observed metric</span><span>Site-rule scoring · simulation ranges are not confidence intervals</span><span>Not backtested</span>{sheet.sport === 'nascar' && <span>Same-venue history only where supported; entry pool is conditional if published</span>}</div>
      </div>
      <div className="model-sheet-footer"><span>Generated {readableDate(sheet.generatedAt)}</span><span>Source: ALLPLAY independent historical-performance matchup model</span></div>
    </div>}
  </>;
}

export function ModelPreview({ sport, date }: { sport: DfsSport; date: string }) {
  const { userId } = useAuth();
  const localDate = date.slice(0, 10);
  const params = useMemo(() => ({ sport, date: localDate, ...defaultSettings }), [sport, localDate]);
  const { sheet, query, membership, verified, signedIn } = useModelProjections(params);
  const canRead = verified && query.data?.status !== 'locked';
  const dashboardParams = useMemo<GetDfsDashboardParams>(() => ({ sport, date: sheet?.slateDate?.slice(0, 10) || localDate, salaryPlatform: 'draftkings' }), [sport, sheet?.slateDate, localDate]);
  const dashboardKey = useMemo(() => [...getGetDfsDashboardQueryKey(dashboardParams), { clerkUserId: userId ?? 'signed-out' }] as const, [dashboardParams, userId]);
  const dashboardQuery = useGetDfsDashboard(dashboardParams, { query: { queryKey: dashboardKey, enabled: canRead && sheet?.status === 'ready', refetchOnWindowFocus: false, staleTime: 60_000 } });
  const insights = useMemo(() => canRead && sheet?.status === 'ready'
    ? deriveLineupInsights(sheet, dashboardQuery.data, 'draftkings', 'draftkings', 'balanced')
    : null, [canRead, sheet, dashboardQuery.data]);
  const playerById = useMemo(() => new Map((sheet?.players ?? []).map((player) => [player.id, player])), [sheet?.players]);
  const topPicks = insights?.rows.slice(0, 4) ?? [];
  return <div className="model-preview">
     <div className="model-preview-head"><div><span className="model-kicker">ALLPLAY CUSTOM MODEL</span><h3>Independent player research</h3><p>Historical stat estimates plus site-rule fantasy simulations where scoring inputs are supported. Not a provider forecast.</p></div><Link to="/projections" className="btn btn-quiet">Open full sheet <ChevronRight size={14} /></Link></div>
    {!canRead ? <div className="model-preview-lock"><LockKeyhole size={16} />{membership.isLoading && signedIn ? 'Verifying member access…' : 'Member access required to inspect model estimates.'}</div>
       : <><div className="model-preview-meta">{sheet?.status === 'warming' ? `Processing ${sheet.processedGames} / ${sheet.totalGames} games` : sheet?.status === 'ready' ? `${sheet.players.length} players · ${sheet.gameCount} games · cutoff ${readableDate(sheet.effectiveAsOf)}` : sheet?.status === 'unavailable' ? 'No published model sheet for this date' : query.isError ? 'Model sheet unavailable' : 'Preparing requested sport sheet'}{dashboardQuery.isLoading && sheet?.status === 'ready' ? ' · checking selected DraftKings slate coverage' : ''}</div>
         {sheet?.status === 'ready' ? topPicks.length ? <div className="model-preview-picks" aria-label="Top ALLPLAY own-scored research picks">
           {topPicks.map((pick) => {
             const player = playerById.get(pick.playerId);
             return <div className="model-preview-pick" key={pick.playerId} data-testid={`research-pick-${pick.playerId}`}>
               <span className="model-preview-pick-rank">{String(pick.rank).padStart(2, '0')}</span>
               <span className="model-preview-pick-name">{pick.name}<small>{pick.position || '—'} · {pick.team || '—'} vs {pick.opponent || '—'}</small></span>
               <span className="model-preview-pick-metric"><small>ALLPLAY PTS</small><strong>{fmt(pick.points)}</strong></span>
               <span className="model-preview-pick-metric"><small>P25 / P85</small><strong>{fmt(pick.floor)} / {fmt(pick.ceiling)}</strong></span>
               <span className="model-preview-pick-metric"><small>DK VALUE</small><strong>{fmt(pick.value)}</strong></span>
               {player?.availability && <span className="sr-only">{player.availability}</span>}
             </div>;
           })}
           {dashboardQuery.isError ? <div className="model-preview-state">Salary slate coverage could not be checked; salary value and ownership are unavailable. <button className="btn btn-quiet" onClick={() => dashboardQuery.refetch()}>Retry slate</button></div>
             : insights && (insights.salaryCoverage < insights.forecastCoverage || dashboardQuery.isLoading) ? <div className="model-preview-state">{dashboardQuery.isLoading ? 'Research picks use ALLPLAY points while selected-slate salary coverage loads.' : 'Some picks lack an unambiguous salary match for the selected slate; value and ownership remain blank.'}</div> : null}
           <div className="model-preview-state">Balanced research ranking · own ALLPLAY forecasts · not a lineup. Estimated ownership, when supported, is an uncalibrated heuristic—not contest ownership.</div>
         </div> : <div className="model-preview-state">{insights?.forecastCoverage === 0 ? 'No complete positive fantasy forecasts are available for the selected scoring rules. Partial tracked points are not full projections.' : 'No eligible research picks for this slate.'}</div>
           : <div className="model-preview-state">{query.data?.status === 'locked' ? 'ALLPLAY has locked estimates for this request.' : sheet?.status === 'warming' ? <><span className="warming-inline-dot" /> Model running · refreshing every 3 seconds</> : sheet?.status === 'unavailable' ? 'This sport or date has no published model data.' : query.isError ? <button className="btn btn-quiet" onClick={() => query.refetch()}>Retry model request</button> : 'Model estimates remain hidden until ready.'}</div>}
      </>}
    <Link to="/projections" className="model-preview-link">Inspect calculations, recent appearances & settings <ChevronRight size={14} /></Link>
  </div>;
}

export default function ModelProjectionsPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const signedIn = isLoaded && isSignedIn === true;
  const [sport, setSport] = useState<DfsSport>('nfl');
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Settings>(defaultSettings);
  const [applied, setApplied] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [salaryPlatform, setSalaryPlatform] = useState<DfsSalaryPlatform>('draftkings');
  const params = useMemo<GetModelProjectionsParams>(() => ({ sport, date, ...applied }), [sport, date, applied]);
  const { sheet, query, membership, verified } = useModelProjections(params);
  const dashboardParams = useMemo<GetDfsDashboardParams>(() => ({ sport, date: sheet?.slateDate || date, salaryPlatform }), [sport, date, sheet?.slateDate, salaryPlatform]);
  const dashboardKey = useMemo(() => [...getGetDfsDashboardQueryKey(dashboardParams), { clerkUserId: userId ?? 'signed-out' }] as const, [dashboardParams, userId]);
  const dashboardQuery = useGetDfsDashboard(dashboardParams, { query: { queryKey: dashboardKey, enabled: verified && sheet?.status === 'ready', refetchOnWindowFocus: false, staleTime: 60_000 } });
  const [focusSport, setFocusSport] = useState(sport);
  useEffect(() => { setFocusSport(sport); }, [sport]);
  useEffect(() => {
    document.title = 'ALLPLAY Custom Model | Raw Stat Projections';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Inspect ALLPLAY independent raw-stat matchup estimates, assumptions, opponent inputs and recent player history.');
  }, []);
  useEffect(() => {
    const refreshAccess = () => { void membership.refetch(); };
    window.addEventListener('focus', refreshAccess);
    return () => window.removeEventListener('focus', refreshAccess);
  }, [membership.refetch]);
  const retry = async () => { await membership.refetch(); if (verified) await query.refetch(); };
  const usableSheet = verified && sheet?.status === 'ready' ? sheet : undefined;
  const selectedSport = MODEL_SPORTS.find((item) => item.id === sport)?.label ?? sport.toUpperCase();
  const applySettings = () => { setApplied({ ...draft }); setSettingsOpen(false); };
  return <div className="app-shell model-app">
    <header className="topbar"><Link href="/user-portal" className="brand" aria-label="ALLPLAY dashboard"><span className="brand-mark"><Activity size={17} /></span><span className="brand-name">ALLPLAY</span></Link>
      <nav className="topbar-right" aria-label="ALLPLAY workspace navigation"><span className="today-label">Independent model desk</span><Link href="/user-portal" className="btn btn-quiet account-header-link"><Activity size={14} />Overview</Link><Link href="/user-portal#slate-section" className="btn btn-quiet account-header-link"><CalendarDays size={14} />Slate</Link><a href={`${import.meta.env.BASE_URL}news?sport=${sport}`} target="_blank" rel="noopener noreferrer" className="btn btn-quiet account-header-link" aria-label="News desk (opens in a new tab)"><Newspaper size={14} />News</a><Link href="/takes" className="btn btn-quiet account-header-link"><Film size={14} />Takes</Link><Link href="/feedback" className="btn btn-quiet account-header-link">Feedback</Link>{signedIn ? <Link href="/account" className="btn btn-quiet account-header-link">Account</Link> : <Link href="/sign-in" className="btn btn-quiet account-header-link">Sign in</Link>}</nav>
    </header>
    <main className="main-wrap model-main">
      <div className="model-breadcrumb"><Link href="/user-portal"><ArrowLeft size={13} /> Dashboard</Link><span>/</span><span>Independent model</span></div>
      <div className="model-heading">
        <div><div className="eyebrow">OWNER-OPERATED RESEARCH <span>/</span> RAW STAT PREDICTIONS</div><h1>Matchup projections<span>.</span></h1><p className="subhead">A transparent estimate, with the ingredients left on the table.</p></div>
        <div className="model-heading-badge"><span className="model-live-dot" />PRIVATE MODEL SHEET</div>
      </div>
       <div className="model-identity-strip"><span className="identity-flag"><Activity size={13} /> ALLPLAY CUSTOM MODEL</span><span>Independent algorithm</span><i /> <span>Not a provider forecast</span><i /> <span>Published scoring rules where supported</span><i /> <span>Not backtested</span></div>
      <div className="model-controls panel">
        <div className="model-control-top">
          <div className="model-control-date"><label htmlFor="model-date"><CalendarDays size={14} /> LOCAL SLATE DATE</label><input id="model-date" className="date-field" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="input-model-date" /></div>
        <div className="model-control-applied"><span className="model-live-dot" /> APPLIED MODEL SETTINGS <span>·</span> RECENT {applied.recentGames} <span>·</span> FORM {applied.recentWeight}% <span>·</span> OPP {applied.matchupWeight}%</div>
         <div className="model-control-actions"><button className="btn btn-quiet" aria-expanded={settingsOpen} aria-controls="model-settings" onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={14} /> Model inputs</button><button className="btn btn-quiet" onClick={retry} disabled={query.isFetching || membership.isFetching}><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} /> Refresh</button><button className="btn btn-primary" onClick={() => usableSheet && exportSheet(usableSheet, dashboardQuery.data, salaryPlatform)} disabled={!usableSheet} title={usableSheet ? 'Download ALLPLAY model data' : 'CSV is available only when the verified sheet is ready'}><Download size={14} /> Export model CSV</button></div>
        </div>
        <div className="model-sport-scroll" role="tablist" aria-label="Model sport sheet">{MODEL_SPORTS.map((item) => <button key={item.id} role="tab" aria-selected={sport === item.id} tabIndex={sport === item.id ? 0 : -1} className={`model-sport-tab ${sport === item.id ? 'active' : ''}`} onClick={() => setSport(item.id)} onKeyDown={(event) => {
          const current = MODEL_SPORTS.findIndex((entry) => entry.id === focusSport);
          const next = event.key === 'ArrowRight' ? (current + 1) % MODEL_SPORTS.length : event.key === 'ArrowLeft' ? (current - 1 + MODEL_SPORTS.length) % MODEL_SPORTS.length : event.key === 'Home' ? 0 : event.key === 'End' ? MODEL_SPORTS.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); const nextSport = MODEL_SPORTS[next].id; setSport(nextSport); setFocusSport(nextSport); document.getElementById(`model-tab-${nextSport}`)?.focus(); }
        }} id={`model-tab-${item.id}`} data-testid={`model-tab-${item.id}`}>{item.short}</button>)}</div>
        {settingsOpen && <section className="model-settings" id="model-settings" aria-label="Model controls">
          <div className="model-settings-intro"><div><span className="model-kicker">MODEL INPUTS</span><h2>Adjust the blend.</h2><p>Settings apply together when you press Apply. No slider tick triggers a request.</p></div><SlidersHorizontal size={18} /></div>
          <div className="model-slider-grid">
            <label className="model-slider"><span><b>Recent window</b><strong>{draft.recentGames} games</strong></span><small>Last 3–10 appearances blended into current form.</small><input type="range" min="3" max="10" step="1" value={draft.recentGames} onChange={(event) => setDraft({ ...draft, recentGames: Number(event.target.value) })} /><span className="slider-ends"><i>3 games</i><i>10 games</i></span></label>
            <label className="model-slider"><span><b>Recent-form weight</b><strong>{draft.recentWeight}%</strong></span><small>Share of recent form versus the up-to-10 appearance baseline.</small><input type="range" min="0" max="100" step="1" value={draft.recentWeight} onChange={(event) => setDraft({ ...draft, recentWeight: Number(event.target.value) })} /><span className="slider-ends"><i>0% baseline</i><i>100% recent</i></span></label>
            <label className="model-slider"><span><b>Matchup influence</b><strong>{draft.matchupWeight}%</strong></span><small>How much observed opponent performance can adjust the estimate.</small><input type="range" min="0" max="50" step="1" value={draft.matchupWeight} onChange={(event) => setDraft({ ...draft, matchupWeight: Number(event.target.value) })} /><span className="slider-ends"><i>0% none</i><i>50% max</i></span></label>
          </div>
          <div className="model-settings-actions"><button className="btn btn-quiet" onClick={() => { setDraft(defaultSettings); setApplied(defaultSettings); }}>Reset defaults</button><button className="btn btn-primary" onClick={applySettings}>Apply settings</button></div>
        </section>}
      </div>
       <div className="model-disclaimer"><Info size={14} /><p><strong>{selectedSport} estimates are ALLPLAY's independent historical-stat model.</strong> Fantasy views apply published site scoring rules to the model forecasts. Partial tracked points are not full projections; unsupported inputs stay blank with an explanation. Simulation percentiles are outcome distributions, not confidence intervals. Estimates are conditional on participation, and this model is not backtested. Raw-stat rank 1 is the lowest observed metric; it is not a universal defense grade.{sport === 'nascar' && ' NASCAR uses official inspected Cup results reconciled to ESPN finals. Lap rates scale to scheduled race length. Starting positions are observed official grids where published, otherwise labeled ALLPLAY forecasts. Fastest laps remain unavailable; DraftKings full totals stay blank. Entry-pool estimates are conditional on publication.'}</p></div>
      {verified && membership.data?.isOwner && <MatchupReportManager key={userId} />}
      {!verified ? <AccessGate signedIn={signedIn} membership={membership} onRefresh={() => void retry()} />
        : <section className="model-sheet panel" aria-labelledby="model-sheet-title">
          <div className="model-sheet-bar"><div><div className="model-sheet-mark"><BarChart3 size={17} /></div><div><span className="model-kicker">ALLPLAY / MATCHUP STAT PROJECTIONS</span><h2 id="model-sheet-title">{selectedSport} research sheet</h2></div></div><span className={`model-status-tag ${sheet?.status === 'ready' ? 'status-ready' : sheet?.status === 'warming' ? 'status-warming' : ''}`}>{query.isError ? 'ERROR' : sheet?.status?.toUpperCase() ?? (query.data?.status === 'locked' ? 'LOCKED' : query.isLoading ? 'REQUESTING' : 'PENDING')}</span></div>
          <div className="model-sheet-body">{verified && query.data?.status === 'locked'
            ? <div className="model-state"><LockKeyhole size={22} /><h3>Model sheet is locked</h3><p>ALLPLAY has not released player values for this request. No cached model data is displayed.</p></div>
             : <SheetBody sheet={sheet} loading={query.isLoading && !query.data} error={query.isError} retry={() => void query.refetch()} dashboard={verified && sheet?.status === 'ready' ? dashboardQuery.data : undefined} platform={salaryPlatform} onPlatformChange={setSalaryPlatform} />}</div>
        </section>}
      <footer className="model-footer"><span>ALLPLAY · Owner-built matchup model</span><span><Link href="/user-portal">Overview</Link><Link href="/takes">Game Takes</Link><Link href="/account">Account</Link></span></footer>
    </main>
  </div>;
}
