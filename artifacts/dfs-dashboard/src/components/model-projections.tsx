import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { getGetDfsDashboardQueryKey, useGetDfsDashboard } from '@workspace/api-client-react';
import type { DfsDashboard, DfsSalaryPlatform, DfsSport, GetDfsDashboardParams, GetModelProjectionsParams, ModelMetric, ModelPlayerProjection, ModelProjectionSheet, ModelStatEstimate } from '@workspace/api-client-react';
import MembershipCheckoutButton from '@/components/membership-checkout-button';
import { useModelProjections } from '@/hooks/use-model-projections';
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
const escapeCsv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function exportSheet(sheet: ModelProjectionSheet) {
  const rows = sheet.players.flatMap((player) => player.stats.map((stat) => ({
    model: 'ALLPLAY custom model',
    backtested: 'No',
    sport: sheet.sport.toUpperCase(),
    requestedDate: sheet.requestedDate,
    slateDate: sheet.slateDate,
    generatedAt: sheet.generatedAt,
    effectiveAsOf: sheet.effectiveAsOf ?? '',
    recentGames: sheet.recentGames,
    recentWeightPct: sheet.recentWeight,
    matchupWeightPct: sheet.matchupWeight,
    player: player.name,
    team: player.team,
    opponent: player.opponent,
    position: player.position,
    availability: player.availability,
    participation: player.participation,
    historicalGames: player.historicalGames,
    statusReason: player.reason ?? '',
    stat: stat.id,
    projectedRawStat: stat.projected ?? '',
    recentAverage: stat.recentAverage ?? '',
    baselineAverage: stat.baselineAverage ?? '',
    opponentRank: stat.opponentRank ?? '',
    rankedTeams: stat.rankedTeams,
    opponentMultiplier: stat.matchupMultiplier,
    opponentSampleGames: stat.defenseGames,
    opponentMean: stat.opponentMean ?? '',
    leagueMean: stat.leagueMean ?? '',
    sampleSize: stat.sampleSize,
    recentSampleSize: stat.recentSampleSize,
    history: player.history.map((appearance) => `${appearance.date} vs ${appearance.opponent}: ${Object.entries(appearance.stats).map(([key, value]) => `${key}=${value}`).join('; ')}`).join(' | '),
    source: 'ALLPLAY independent historical-performance matchup model',
    caveat: 'Conditional on participation; observed ranks are not calibrated probabilities',
  })));
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.map(escapeCsv).join(','), ...rows.map((row) => headers.map((key) => escapeCsv(row[key as keyof typeof row])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `allplay-${sheet.sport}-${sheet.slateDate}-model-stats.csv`;
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
        : 'Raw matchup stat estimates, model inputs and each player’s recent history. Not fantasy scoring.'}</p>
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

const MetricRank = memo(function MetricRank({ metric, stat, players }: { metric: ModelMetric; stat?: ModelStatEstimate; players: ModelPlayerProjection[] }) {
  const value = stat?.projected;
  if (value == null) return <span className="model-number model-missing">—</span>;
  const valid = players.flatMap((player) => player.stats.find((item) => item.id === metric.id)?.projected ?? []);
  const sorted = [...valid].sort((a, b) => metric.higherIsBetter ? b - a : a - b);
  const rank = sorted.indexOf(value);
  const percentile = sorted.length < 2 ? .5 : rank / (sorted.length - 1);
  const tier = percentile < .25 ? 'high' : percentile < .5 ? 'mid-high' : percentile < .75 ? 'mid-low' : 'low';
  return <span className={`model-number model-tier-${tier}`} title="Relative only to this sheet; not a calibrated probability">{value.toFixed(2)}</span>;
});

function PlayerDetail({ player, sheet, metrics }: { player: ModelPlayerProjection; sheet: ModelProjectionSheet; metrics: ModelMetric[] }) {
  return <div className="model-detail">
    {player.reason && <div className="model-reason"><Info size={14} />{player.reason}</div>}
    <div className="model-detail-table-wrap">
      <table className="model-detail-table"><thead><tr><th>STAT</th><th>ESTIMATE</th><th>RECENT AVG</th><th>BASELINE ≤10</th><th>OPP RANK</th><th>ADJUSTMENT</th><th>OPP AVG</th><th>LEAGUE AVG</th><th>SAMPLE</th></tr></thead>
        <tbody>{player.stats.map((stat) => {
          const metric = metrics.find((item) => item.id === stat.id);
          return <tr key={stat.id}><th>{metric?.label ?? stat.id}<small>{metric?.unit || 'raw stat'}</small></th><td className="detail-highlight">{fmt(stat.projected, metric?.unit)}</td><td>{fmt(stat.recentAverage, metric?.unit)} <small>n={stat.recentSampleSize}</small></td><td>{fmt(stat.baselineAverage, metric?.unit)}</td><td>{stat.opponentRank == null ? '—' : `${stat.opponentRank} / ${stat.rankedTeams || '—'}`}<small>{stat.rankedTeams ? 'observed teams' : 'unranked'}</small></td><td>{fmt(stat.matchupMultiplier, '×')}</td><td>{fmt(stat.opponentMean, metric?.unit)}<small>{stat.defenseGames} games</small></td><td>{fmt(stat.leagueMean, metric?.unit)}</td><td>{stat.sampleSize} <small>total</small></td></tr>;
        })}</tbody>
      </table>
    </div>
    <div className="model-history">
      <div className="model-history-head"><strong>LAST PERFORMANCES</strong><span>{player.history.length} appearances · cutoff {readableDate(sheet.effectiveAsOf)}</span></div>
      {player.history.length ? <div className="model-history-list">{player.history.map((item) => <article className="model-history-row" key={`${player.id}-${item.eventId}-${item.date}`}><time>{readableDate(item.date)}</time><span>vs {item.opponent || '—'}</span><div>{Object.entries(item.stats).map(([id, value]) => {
        const metric = metrics.find((candidate) => candidate.id === id);
        return <span className="history-stat" key={id}><b>{fmt(value)}</b><small>{metric?.label ?? id}</small></span>;
      })}</div></article>)}</div> : <p className="model-history-empty">No appearance-level history was published for this player.</p>}
    </div>
  </div>;
}

function PlayerTable({ sheet, dashboard, platform, onPlatformChange }: { sheet: ModelProjectionSheet; dashboard?: DfsDashboard; platform: DfsSalaryPlatform; onPlatformChange: (platform: DfsSalaryPlatform) => void }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [detailPlayer, setDetailPlayer] = useState<ModelPlayerProjection | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { setDetailPlayer(null); }, [sheet]);
  useEffect(() => {
    if (!detailPlayer) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailPlayer(null);
      if (event.key === 'Tab') {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [detailPlayer]);
  const salaryRows = useMemo(() => {
    const selectedSlateId = dashboard?.salaryCoverage?.platform === platform ? dashboard.salaryCoverage.selectedSlateId : null;
    const dashboardDate = dashboard?.date?.slice(0, 10);
    const dateMatches = !!sheet.slateDate && dashboardDate === sheet.slateDate;
    const rows = (dashboard?.projections ?? []).filter((row) =>
      dateMatches && !!selectedSlateId && row.sport === sheet.sport && row.salaryPlatform === platform
      && row.salary != null && row.salarySlateId === selectedSlateId,
    );
    return sheet.players.map((player) => {
      // ESPN and salary-provider numeric IDs are different namespaces.
      // Require a unique name/team match on both sides rather than equating IDs.
      const name = player.name.trim().toLocaleLowerCase();
      const team = player.team.trim().toLocaleLowerCase();
      const uniquePlayer = sheet.players.filter((item) => item.name.trim().toLocaleLowerCase() === name && item.team.trim().toLocaleLowerCase() === team).length === 1;
      const nameMatches = rows.filter((row) => row.name.trim().toLocaleLowerCase() === name && !!team && row.team?.trim().toLocaleLowerCase() === team);
      return { playerId: player.id, row: uniquePlayer && nameMatches.length === 1 ? nameMatches[0] : undefined };
    });
  }, [dashboard?.projections, dashboard?.salaryCoverage, dashboard?.date, sheet.players, sheet.sport, sheet.requestedDate, sheet.slateDate, platform]);
  const salaryFor = (playerId: string) => salaryRows.find((item) => item.playerId === playerId)?.row?.salary;
  const salaryCoverage = dashboard?.salaryCoverage;
  const matchupFor = (player: ModelPlayerProjection) => {
    if (!dashboard || dashboard.date?.slice(0, 10) !== sheet.slateDate) return undefined;
    const team = player.team.trim().toLocaleLowerCase();
    const opponent = player.opponent.trim().toLocaleLowerCase();
    if (!team || !opponent) return undefined;
    const games = dashboard.events.filter((event) => event.sport === sheet.sport && event.competitors.some((item) => item.abbreviation.trim().toLocaleLowerCase() === team) && event.competitors.some((item) => item.abbreviation.trim().toLocaleLowerCase() === opponent));
    if (games.length !== 1) return undefined;
    return games[0].competitors.find((item) => item.abbreviation.trim().toLocaleLowerCase() === team);
  };
  const roles = useMemo(() => [...new Set(sheet.players.map((player) => player.position).filter(Boolean))].sort(), [sheet.players]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sheet.players.filter((player) =>
      (!term || [player.name, player.team, player.opponent, player.position].some((value) => value.toLowerCase().includes(term)))
      && (role === 'all' || player.position === role),
    ).sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name) * (direction === 'asc' ? 1 : -1);
      const av = a.stats.find((stat) => stat.id === sortBy)?.projected;
      const bv = b.stats.find((stat) => stat.id === sortBy)?.projected;
      if (av == null) return bv == null ? a.name.localeCompare(b.name) : 1;
      if (bv == null) return -1;
      return (av - bv) * (direction === 'asc' ? 1 : -1);
    });
  }, [sheet.players, search, role, sortBy, direction]);
  const toggleSort = (id: string) => {
    if (sortBy === id) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(id); setDirection(id === 'name' ? 'asc' : 'desc'); }
  };
  return <div className="model-table-area">
    <div className="model-table-tools">
      <label className="model-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a player, team, opponent…" aria-label="Search model players" /><kbd>/</kbd></label>
      <label className="model-role-filter"><UserRound size={14} /><span className="sr-only">Filter by role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="model-salary-filter"><span>Salary metadata</span><select value={platform} onChange={(event) => onPlatformChange(event.target.value as DfsSalaryPlatform)} aria-label="Salary platform"><option value="draftkings">DraftKings</option><option value="fanduel">FanDuel</option></select></label>
      <span className="model-result-count">{visible.length} <i>/</i> {sheet.players.length}</span>
    </div>
    <div className="model-salary-coverage" role="status">{salaryCoverage?.platform === platform && salaryCoverage.available ? `${platform === 'draftkings' ? 'DraftKings' : 'FanDuel'} salaries for the selected slate · only unique player/team matches are shown · unmatched salaries shown as —` : 'Salary coverage unavailable for this platform and slate · salary shown as —'}</div>
    {sheet.players.length === 0 ? <div className="model-state model-empty"><TrendingUp size={22} /><h3>No player estimates published</h3><p>There are no model rows for this date. Missing samples stay blank; they are never filled with zero.</p></div>
      : visible.length === 0 ? <div className="model-state model-empty"><Search size={20} /><h3>No matching players</h3><p>Try another name or role.</p><button className="btn btn-quiet" onClick={() => { setSearch(''); setRole('all'); }}>Clear filters</button></div>
        : <div className="model-grid-scroll" role="region" aria-label="ALLPLAY raw stat projection sheet" tabIndex={0}>
          <table className="model-grid">
            <thead><tr><th className="model-player-column"><button onClick={() => toggleSort('name')}>PLAYER {sortBy === 'name' ? direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} />}</button></th>
              <th>ROLE</th><th>TEAM / OPP</th><th className="model-salary-cell">SALARY</th><th>AVAILABILITY</th>
              {sheet.metrics.map((metric) => <th className="model-stat-header" key={metric.id}><button onClick={() => toggleSort(metric.id)} title={`Sort by ${metric.label}`}>{metric.label}{sortBy === metric.id ? direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : <ArrowUpDown size={11} />}<small>{metric.unit || metric.group}</small></button></th>)}
              <th className="model-samples-head">SAMPLE</th><th aria-label="Details" /></tr></thead>
            <tbody>{visible.map((player) => <tr key={player.id} className="model-player-row">
              <td className="model-player-name"><span><strong>{player.name}</strong><small>{player.participation === 'conditional' ? 'IF ACTIVE' : player.participation.toUpperCase()}</small></span></td>
              <td className="model-mono">{player.position || '—'}</td>
              <td><span className="model-team">{matchupFor(player)?.logo && <img className="model-team-logo" src={matchupFor(player)?.logo ?? undefined} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}{player.team || '—'}</span><small className="model-opponent">{matchupFor(player)?.homeAway === 'away' ? 'at' : 'vs'} {player.opponent || '—'}</small></td>
              <td className="model-salary-cell">{salaryFor(player.id) == null ? '—' : `$${salaryFor(player.id)?.toLocaleString('en-US')}`}</td>
              <td><span className={`availability-pill ${/out|inactive|doubtful/i.test(player.availability) ? 'availability-alert' : ''}`}>{player.availability || '—'}</span></td>
              {sheet.metrics.map((metric) => <td key={metric.id} className="model-stat-cell"><MetricRank metric={metric} stat={player.stats.find((stat) => stat.id === metric.id)} players={sheet.players} /></td>)}
              <td className="model-sample">{player.historicalGames || '—'} <small>games</small></td>
              <td className="model-expand"><button type="button" aria-label={`Show ${player.name} calculation and history`} title="Calculation & history" onClick={(event) => { returnFocusRef.current = event.currentTarget; setDetailPlayer(player); }}><Info size={14} /></button></td>
            </tr>)}</tbody>
          </table>
        </div>}
    <div className="model-legend"><span><i className="legend-dot legend-mint" /> Higher within this sheet</span><span><i className="legend-dot legend-amber" /> Mid-range</span><span><i className="legend-dot legend-coral" /> Lower within this sheet</span><span className="legend-disclaimer">Color is relative to this slate only.</span></div>
    {detailPlayer && <div className="model-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailPlayer(null); }}><section className="model-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="player-detail-title"><div className="model-detail-dialog-head"><div><span className="model-kicker">PLAYER DETAIL · PRIVATE MODEL</span><h2 id="player-detail-title">{detailPlayer.name}</h2></div><button ref={closeButtonRef} className="btn btn-quiet" type="button" onClick={() => setDetailPlayer(null)}>Close</button></div><PlayerDetail player={detailPlayer} sheet={sheet} metrics={sheet.metrics} /></section></div>}
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
        <p>{sheet.modelFormula || 'Recent player performance is blended with up to ten appearances, then adjusted by observed opponent matchup history.'}</p>
        <ul>{sheet.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
        <div className="model-caveats"><span>Conditional on participation</span><span>Observed ranks are not calibrated probabilities</span><span>Rank 1 = lowest observed metric</span><span>Raw stats only · no fantasy-point conversion</span>{sheet.sport === 'nascar' && <span>Same-venue history only where supported; entry pool is conditional if published</span>}</div>
      </div>
      <div className="model-sheet-footer"><span>Generated {readableDate(sheet.generatedAt)}</span><span>Source: ALLPLAY independent historical-performance matchup model</span></div>
    </div>}
  </>;
}

export function ModelPreview({ sport, date }: { sport: DfsSport; date: string }) {
  const params = useMemo(() => ({ sport, date, ...defaultSettings }), [sport, date]);
  const { sheet, query, membership, verified, signedIn } = useModelProjections(params);
  const canRead = verified && query.data?.status !== 'locked';
  const previewMetrics = sheet?.metrics.slice(0, 3) ?? [];
  const supportedColumns = (player: ModelPlayerProjection) => previewMetrics.filter(metric =>
    player.stats.some(stat => stat.id === metric.id && stat.projected !== null)).length;
  const previewPlayers = (sheet?.players ?? []).filter(player => supportedColumns(player) > 0)
    .sort((a, b) => supportedColumns(b) - supportedColumns(a)).slice(0, 5);
  return <div className="model-preview">
    <div className="model-preview-head"><div><span className="model-kicker">ALLPLAY CUSTOM MODEL</span><h3>Raw stat matchup sheet</h3><p>Historical performance, adjusted by observed opponent data. Not fantasy scoring.</p></div><Link to="/projections" className="btn btn-quiet">Open full sheet <ChevronRight size={14} /></Link></div>
    {!canRead ? <div className="model-preview-lock"><LockKeyhole size={16} />{membership.isLoading && signedIn ? 'Verifying member access…' : 'Member access required to inspect model estimates.'}</div>
      : <><div className="model-preview-meta">{sheet?.status === 'warming' ? `Processing ${sheet.processedGames} / ${sheet.totalGames} games` : sheet?.status === 'ready' ? `${sheet.players.length} players · ${sheet.gameCount} games · cutoff ${readableDate(sheet.effectiveAsOf)}` : sheet?.status === 'unavailable' ? 'No published model sheet for this date' : query.isError ? 'Model sheet unavailable' : 'Preparing requested sport sheet'}</div>
        {sheet?.status === 'ready' ? <div className="model-preview-scroll"><table><thead><tr><th>PLAYER</th><th>TEAM / OPP</th>{previewMetrics.map((metric) => <th key={metric.id}>{metric.label}</th>)}</tr></thead><tbody>{previewPlayers.map((player) => <tr key={player.id}><td>{player.name}<small>{player.position || player.availability}</small></td><td>{player.team}<small>vs {player.opponent}</small></td>{previewMetrics.map((metric) => <td className="model-preview-value" key={metric.id}>{fmt(player.stats.find((stat) => stat.id === metric.id)?.projected, metric.unit)}</td>)}</tr>)}</tbody></table></div>
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
      <div className="topbar-right"><span className="today-label">Independent model desk</span><Link href="/takes" className="btn btn-quiet account-header-link"><Film size={14} /> Takes</Link>{signedIn ? <Link href="/account" className="btn btn-quiet account-header-link">Account</Link> : <Link href="/sign-in" className="btn btn-quiet account-header-link">Sign in</Link>}</div>
    </header>
    <aside className="side-rail" aria-label="Dashboard navigation"><div className="rail-caption">YOUR WORKSPACE</div><Link className="rail-link" href="/user-portal"><Activity size={15} />Overview</Link><Link className="rail-link selected" href="/projections" aria-current="page"><TrendingUp size={15} />Model sheet</Link><Link className="rail-link" href="/user-portal#slate-section"><CalendarDays size={15} />Live slate</Link><Link className="rail-link" href="/takes"><Film size={15} />Game takes</Link><Link className="rail-link" href="/user-portal#news-section"><Newspaper size={15} />News desk</Link><Link className="rail-link" href="/account">Account</Link><div className="rail-note"><span className="rail-live-dot" />ALLPLAY custom model<br />Raw stats · observed inputs</div><div className="rail-bottom"><span className="rail-caption">LEAGUE SHEETS</span><div className="rail-sports">NFL · NHL · WNBA<br />NBA · MLB · NASCAR · CFB</div></div></aside>
    <main className="main-wrap model-main">
      <div className="model-breadcrumb"><Link href="/user-portal"><ArrowLeft size={13} /> Dashboard</Link><span>/</span><span>Independent model</span></div>
      <div className="model-heading">
        <div><div className="eyebrow">OWNER-OPERATED RESEARCH <span>/</span> RAW STAT PREDICTIONS</div><h1>Matchup projections<span>.</span></h1><p className="subhead">A transparent estimate, with the ingredients left on the table.</p></div>
        <div className="model-heading-badge"><span className="model-live-dot" />PRIVATE MODEL SHEET</div>
      </div>
      <div className="model-identity-strip"><span className="identity-flag"><Activity size={13} /> ALLPLAY CUSTOM MODEL</span><span>Independent algorithm</span><i /> <span>Not a provider forecast</span><i /> <span>Not fantasy scoring</span><i /> <span>Not backtested</span></div>
      <div className="model-controls panel">
        <div className="model-control-top">
          <div className="model-control-date"><label htmlFor="model-date"><CalendarDays size={14} /> LOCAL SLATE DATE</label><input id="model-date" className="date-field" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="input-model-date" /></div>
        <div className="model-control-applied"><span className="model-live-dot" /> APPLIED MODEL SETTINGS <span>·</span> RECENT {applied.recentGames} <span>·</span> FORM {applied.recentWeight}% <span>·</span> OPP {applied.matchupWeight}%</div>
          <div className="model-control-actions"><button className="btn btn-quiet" aria-expanded={settingsOpen} aria-controls="model-settings" onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={14} /> Model inputs</button><button className="btn btn-quiet" onClick={retry} disabled={query.isFetching || membership.isFetching}><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} /> Refresh</button><button className="btn btn-primary" onClick={() => usableSheet && exportSheet(usableSheet)} disabled={!usableSheet} title={usableSheet ? 'Download ALLPLAY model data' : 'CSV is available only when the verified sheet is ready'}><Download size={14} /> Export model CSV</button></div>
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
      <div className="model-disclaimer"><Info size={14} /><p><strong>{selectedSport} sheet, in raw statistics.</strong> Estimates are conditional on participation. Rank 1 is the lowest observed metric—not the universally strongest defense. For goalies and pitchers, ranks describe opponent attack versus that stat, not points allowed. A missing estimate means there is not enough published evidence; it is not zero.{sport === 'nascar' && ' NASCAR estimates use historical finish; same-named venue history is used only where supported. Entry-pool estimates are conditional on publication.'}</p></div>
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
