import { ArrowUpDown, ChevronDown } from 'lucide-react';
import './_group.css';

// Extracted from ALLPLAY's existing Model PlayerTable and MetricRank.
// This isolated baseline uses illustrative fixtures, never protected API data.
type Metric = { id: string; label: string; unit: string; higherIsBetter: boolean };
type Stat = { id: string; projected: number | null };
type Player = { id: string; name: string; position: string; team: string; opponent: string; participation: string; availability: string; historicalGames: number; stats: Stat[] };
const fmt = (value: number | null | undefined, unit = '') => value == null || !Number.isFinite(value) ? '—' : `${Number(value.toFixed(2))}${unit ? ` ${unit}` : ''}`;
const metrics: Metric[] = [
  { id: 'timeOnIce', label: 'Ice time', unit: 'min', higherIsBetter: true },
  { id: 'goals', label: 'Goals', unit: '', higherIsBetter: true },
  { id: 'assists', label: 'Assists', unit: '', higherIsBetter: true },
  { id: 'shots', label: 'Shots', unit: '', higherIsBetter: true },
];
const players: Player[] = Array.from({ length: 22 }, (_, index) => ({
  id: `illustration-${index}`, name: `Sample Skater ${String(index + 1).padStart(2, '0')}`, position: index % 3 ? 'W' : 'D',
  team: 'CBJ', opponent: 'PIT', participation: 'conditional', availability: 'injury not verified', historicalGames: 5,
  stats: metrics.map((metric, column) => ({ id: metric.id, projected: index % 8 === 7 ? null : column ? (22 - index) / (column * 7) : 22 - index / 4 })),
}));
function MetricRank({ metric, stat }: { metric: Metric; stat?: Stat }) {
  const value = stat?.projected;
  if (value == null) return <span className="model-number model-missing">—</span>;
  const valid = players.flatMap((player) => player.stats.find((item) => item.id === metric.id)?.projected ?? []);
  const sorted = [...valid].sort((a, b) => metric.higherIsBetter ? b - a : a - b);
  const rank = sorted.indexOf(value);
  const percentile = sorted.length < 2 ? .5 : rank / (sorted.length - 1);
  const tier = percentile < .25 ? 'high' : percentile < .5 ? 'mid-high' : percentile < .75 ? 'mid-low' : 'low';
  return <span className={`model-number model-tier-${tier}`} title="Relative only to this sheet; not a calibrated probability">{fmt(value, metric.unit)}</span>;
}
export function Current() {
  return <div className="projection-baseline"><p>Current table · illustrative fixtures only · extracted before restyling</p><div className="model-grid-scroll">
    <table className="model-grid">
      <thead><tr><th className="model-player-column"><button>PLAYER <ArrowUpDown size={12} /></button></th><th>ROLE</th><th>TEAM / OPP</th><th>AVAILABILITY</th>
        {metrics.map((metric) => <th className="model-stat-header" key={metric.id}><button>{metric.label}<ArrowUpDown size={11} /><small>{metric.unit}</small></button></th>)}
        <th className="model-samples-head">SAMPLE</th><th aria-label="Details" /></tr></thead>
      <tbody>{players.map((player) => <tr key={player.id} className="model-player-row">
        <td className="model-player-name"><span className="model-player-initials">{player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span><strong>{player.name}</strong><small>{player.participation === 'conditional' ? 'IF ACTIVE' : player.participation.toUpperCase()}</small></span></td>
        <td className="model-mono">{player.position || '—'}</td>
        <td><span className="model-team">{player.team || '—'}</span><small className="model-opponent">vs {player.opponent || '—'}</small></td>
        <td><span className="availability-pill">{player.availability || '—'}</span></td>
        {metrics.map((metric) => <td key={metric.id} className="model-stat-cell"><MetricRank metric={metric} stat={player.stats.find((stat) => stat.id === metric.id)} /></td>)}
        <td className="model-sample">{player.historicalGames || '—'} <small>games</small></td>
        <td className="model-expand"><details><summary aria-label={`Show ${player.name} calculation and history`}><ChevronDown size={15} /></summary><div>Illustrative fixture: no real player history is loaded in this baseline.</div></details></td>
      </tr>)}</tbody>
    </table></div></div>;
}
