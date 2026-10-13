import { useMemo, useState } from 'react';
import type { DfsDashboard, DfsSalaryPlatform, ModelProjectionSheet } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, ChartNoAxesCombined, ShieldAlert } from 'lucide-react';
import { deriveLineupInsights, type LineupStyle } from '@/lib/lineup-insights';
import { InjuryBadge } from '@/components/injury-badge';

const num = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

export function ResearchShortlist({
  sheet, dashboard, platform, site, onOpenPlayer,
}: {
  sheet: ModelProjectionSheet;
  dashboard?: DfsDashboard;
  platform: DfsSalaryPlatform;
  site: DfsSalaryPlatform | 'yahoo' | 'ownersbox';
  onOpenPlayer: (playerId: string) => void;
}) {
  const [style, setStyle] = useState<LineupStyle>('balanced');
  const insights = useMemo(() => deriveLineupInsights(sheet, dashboard, platform, site, style), [sheet, dashboard, platform, site, style]);
  const playerById = useMemo(() => new Map(sheet.players.map((player) => [player.id, player])), [sheet.players]);
  const readyForecasts = sheet.players.filter((player) => player.fantasy?.some((forecast) => forecast.site === site && forecast.status === 'ready')).length;
  const partialForecasts = sheet.players.filter((player) => player.fantasy?.some((forecast) => forecast.site === site && forecast.status === 'partial')).length;
  const siteLabel = site === 'draftkings' ? 'DraftKings' : site === 'fanduel' ? 'FanDuel' : site === 'yahoo' ? 'Yahoo' : 'OwnersBox';
  const dateMatches = dashboard?.date?.slice(0, 10) === sheet.slateDate.slice(0, 10);

  return <section className="research-shortlist" aria-labelledby="research-shortlist-title" data-testid="section-research-shortlist">
    <div className="research-shortlist-head">
      <div className="research-title-block">
        <span className="model-kicker"><ChartNoAxesCombined size={13} /> OWN-SCORED RESEARCH</span>
        <h2 id="research-shortlist-title">Who merits a closer look?</h2>
        <p>Ranked from ALLPLAY’s matchup projections and observed history. A research queue, not a lineup.</p>
      </div>
      <div className="research-style-switch" role="group" aria-label="Research ranking style">
        <button type="button" className={style === 'balanced' ? 'selected' : ''} aria-pressed={style === 'balanced'} onClick={() => setStyle('balanced')}>Balanced</button>
        <button type="button" className={style === 'tournament' ? 'selected' : ''} aria-pressed={style === 'tournament'} onClick={() => setStyle('tournament')}>Tournament</button>
      </div>
    </div>
    <div className="research-context">
      <span>{siteLabel} scoring · {sheet.slateDate.slice(0, 10)}</span>
      <span>{insights.forecastCoverage} scored picks · {insights.salaryCoverage} matched salaries</span>
    </div>
    {!dateMatches && <p className="research-alert"><AlertCircle size={14} /> Salary and slate context do not match this model date; salary-based value and ownership remain unavailable.</p>}
    {insights.rows.length > 0 ? <div className="research-pick-list">
      {insights.rows.slice(0, 8).map((pick) => {
        const player = playerById.get(pick.playerId);
        return <article className="research-pick" key={pick.playerId}>
          <span className="research-rank">{String(pick.rank).padStart(2, '0')}</span>
          <div className="research-player">
            <button type="button" className="research-player-link" onClick={() => onOpenPlayer(pick.playerId)} aria-label={`Open ALLPLAY calculation and history for ${pick.name}`}>
              {pick.name}<ArrowUpRight size={13} />
            </button>
            <InjuryBadge status={player?.availability} />
            <span>{pick.position || '—'} · {pick.team || '—'} vs {pick.opponent || '—'}</span>
            <div className="research-tags">{pick.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>
          <div className="research-stat"><small>POINTS</small><strong>{num(pick.points)}</strong></div>
          <div className="research-stat research-range"><small>P25 / P85</small><strong>{num(pick.floor)} <i>/</i> {num(pick.ceiling)}</strong></div>
          <div className="research-stat research-value"><small>PTS / $1K</small><strong>{num(pick.value, 2)}</strong></div>
          <div className="research-stat research-ownership" title={pick.ownershipMethod ?? 'No supported estimate for this slate format and covered player pool.'}><small>EST. OWNERSHIP</small><strong>{pick.estimatedOwnership == null ? '—' : `${num(pick.estimatedOwnership)}%`}</strong></div>
          {(pick.reasons.length > 0 || pick.cautions.length > 0) && <details className="research-detail">
            <summary>Why / watch</summary>
            {pick.reasons.length > 0 && <ul>{pick.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            {pick.cautions.length > 0 && <ul className="research-cautions">{pick.cautions.map((caution) => <li key={caution}><ShieldAlert size={12} />{caution}</li>)}</ul>}
          </details>}
          {!player && <span className="sr-only">Player details unavailable in this sheet.</span>}
        </article>;
      })}
    </div> : readyForecasts === 0 ? <div className="research-empty" role="status">
      <AlertCircle size={18} /><div><strong>{partialForecasts > 0 ? 'Fantasy inputs are not complete' : 'No complete fantasy forecasts yet'}</strong>
        <p>{partialForecasts > 0 ? `${partialForecasts} ${siteLabel} rows contain tracked subtotals only. Partial points are not treated as full projections.` : `No ready ${siteLabel} forecast is available for this slate. Research picks appear when complete own-scored inputs are published.`}</p></div>
    </div> : <div className="research-empty" role="status"><AlertCircle size={18} /><div><strong>No eligible picks in this pool</strong><p>Ready forecasts exist, but no rows meet the shortlist’s positive-point and availability checks.</p></div></div>}
    <div className="research-shortlist-foot">
      <p>{insights.notes[0]}</p>
      <p><strong>Ownership is not contest data.</strong> Where available, this is an uncalibrated selection-share heuristic conditional on a covered player pool; it is not actual ownership and does not optimize a valid lineup. Unsupported formats stay blank.</p>
    </div>
  </section>;
}
