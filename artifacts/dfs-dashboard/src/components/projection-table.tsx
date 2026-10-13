import { Fragment, useMemo, useState } from 'react';
import type { DfsEvent, DfsPlayerProjection } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, TrendingUp, X } from 'lucide-react';

type SortKey = 'name' | 'position' | 'team' | 'opponent' | 'projection';
type Tier = { key: 't0' | 't1' | 't2' | 't3' | 't4'; label: string };
const TIERS: (Tier & { desc: string })[] = [
  { key: 't1', label: 'Top', desc: 'Top 25% of its group' },
  { key: 't2', label: 'High', desc: '50-75th percentile' },
  { key: 't3', label: 'Mid', desc: '25-50th percentile' },
  { key: 't4', label: 'Low', desc: 'Bottom 25%' },
];
const groupKey = (p: DfsPlayerProjection) => `${p.sport}|${p.projectionType}|${p.source}`;

export default function ProjectionTable({ players, events, loading, hasCoverage }: { players: DfsPlayerProjection[]; events: DfsEvent[]; loading: boolean; hasCoverage: boolean }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'projection', dir: 'desc' });

  const tiers = useMemo(() => {
    const groups = new Map<string, number[]>();
    players.forEach((p) => { const k = groupKey(p); groups.set(k, [...(groups.get(k) ?? []), p.projection]); });
    groups.forEach((v) => v.sort((a, b) => a - b));
    const out = new Map<string, Tier & { pct: number; size: number }>();
    players.forEach((p) => {
      const vals = groups.get(groupKey(p))!;
      const below = vals.filter((v) => v < p.projection).length;
      const equal = vals.filter((v) => v === p.projection).length;
      const pct = vals.length > 1 ? (below + (equal - 1) / 2) / (vals.length - 1) : 0.5;
      const t: Tier = equal === vals.length
        ? { key: 't0', label: vals.length === 1 ? 'Unranked' : 'Tied' }
        : pct >= 0.75 ? TIERS[0] : pct >= 0.5 ? TIERS[1] : pct >= 0.25 ? TIERS[2] : TIERS[3];
      out.set(p.id, { key: t.key, label: t.label, pct, size: vals.length });
    });
    return out;
  }, [players]);

  const teamInfo = useMemo(() => {
    const m = new Map<string, { logo?: string | null; homeAway: string; oppAbbr?: string }>();
    events.forEach((e) => e.competitors.forEach((c) => {
      const opp = e.competitors.find((o) => o.id !== c.id);
      const info = { logo: c.logo, homeAway: c.homeAway, oppAbbr: opp?.abbreviation };
      [c.abbreviation, c.name].forEach((k) => k && m.set(`${e.sport}|${k.toLowerCase()}`, info));
    }));
    return m;
  }, [events]);
  const lookup = (p: DfsPlayerProjection, k?: string | null) => (k ? teamInfo.get(`${p.sport}|${k.toLowerCase()}`) : undefined);

  const groupCount = useMemo(() => new Set(players.map(groupKey)).size, [players]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = term ? players.filter((p) => [p.name, p.team, p.opponent, p.position].some((v) => v?.toLowerCase().includes(term))) : players;
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...f].sort((a, b) => {
      const groupOrder = groupKey(a).localeCompare(groupKey(b));
      if (groupOrder !== 0) return groupOrder;
      if (sort.key === 'projection') return (a.projection - b.projection) * m;
      return String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? '')) * m;
    });
  }, [players, q, sort]);

  if (loading) return <div style={{ display: 'grid', gap: 4 }}>{Array.from({ length: 8 }, (_, n) => <div className="skeleton" key={n} style={{ height: 30 }} />)}</div>;
  if (!players.length) return <div className="state-box"><div className="state-icon"><TrendingUp size={17} /></div><strong>No projections available</strong><p>{hasCoverage ? 'No player projection rows were returned for this filter.' : 'Projection coverage is not available for the selected slate. Events and news may still be available.'}</p></div>;

  const toggle = (key: SortKey) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'projection' ? 'desc' : 'asc' });
  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => {
    const active = sort.key === k;
    return <th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={num ? 'num' : ''}>
      <button type="button" className={`pt-sort ${active ? 'on' : ''}`} onClick={() => toggle(k)} data-testid={`sort-${k}`}>
        {label}{active ? (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
      </button>
    </th>;
  };

  return <div className="pt">
    <div className="pt-tools">
      <label className="pt-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, team, position" aria-label="Search projections" data-testid="input-projection-search" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X size={12} /></button>}</label>
      <span className="pt-count">{rows.length} / {players.length}</span>
    </div>
    <div className="pt-legend" aria-label="Projection color legend">
      {TIERS.map((t) => <span key={t.key}><i className={`pt-sw ${t.key}`} />{t.label}<em>{t.desc}</em></span>)}
    </div>
    <p className="pt-note">Colors compare only the players loaded here with the same sport, forecast basis and source ({groupCount} {groupCount === 1 ? 'group' : 'groups'}). Season and scoring-period forecasts stay separate; colors are not confidence or DFS value ratings. Tied or lone-player groups remain neutral. Salaries and line assignments are not available from this feed, so no values are invented.</p>
    <div className="pt-scroll" role="region" aria-label="Player projections table" tabIndex={0}>
      <table className="pt-table">
        <thead><tr>
          <th className="num rk">#</th><Th k="name" label="Player" /><th className="num">Salary</th><Th k="position" label="Pos" /><Th k="team" label="Team" /><Th k="opponent" label="Opp" /><Th k="projection" label="Proj" num /><th>Tier</th><th>Basis</th>
        </tr></thead>
        <tbody>{rows.length ? rows.map((p, i) => {
          const t = tiers.get(p.id)!;
          const mine = lookup(p, p.team);
          const oppAbbr = p.opponent || mine?.oppAbbr;
          const prefix = mine?.homeAway === 'home' ? 'vs ' : mine?.homeAway === 'away' ? 'at ' : '';
          const newGroup = i === 0 || groupKey(rows[i - 1]) !== groupKey(p);
          const groupRow = rows.slice(0, i).filter((row) => groupKey(row) === groupKey(p)).length + 1;
          return <Fragment key={p.id}>
            {groupCount > 1 && newGroup && <tr className="pt-group-row"><td colSpan={9}>{p.projectionType} · {p.source}</td></tr>}
            <tr className={t.key} data-testid={`projection-${p.id}`}>
            <td className="num rk">{groupRow}</td>
            <td className="pname">{p.name}</td>
            <td className="num dim" title="Salary not provided by public feeds">—</td>
            <td className="mono">{p.position || '—'}</td>
            <td><span className="pt-team">{mine?.logo ? <img src={mine.logo} alt="" loading="lazy" /> : <span className="pt-logo-fb" />}<span className="mono">{p.team || '—'}</span></span></td>
            <td className="mono">{oppAbbr ? `${prefix}${oppAbbr}` : '—'}</td>
            <td className="num proj">{p.projection.toFixed(2)}</td>
            <td><span className={`pt-tier ${t.key}`} title={`Percentile ${Math.round(t.pct * 100)} of ${t.size} in group`}>{t.label}</span></td>
            <td className="basis">{p.projectionType} · {p.source}</td>
          </tr></Fragment>;
        }) : <tr><td colSpan={9} className="pt-empty">No players match "{q}".</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
