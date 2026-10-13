import { Fragment, useMemo, useState } from 'react';
import type { DfsEvent, DfsPlayerProjection } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, TrendingUp, X } from 'lucide-react';

type SortKey = 'name' | 'position' | 'team' | 'opponent' | 'projection' | 'salary';
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
    players.forEach((p) => {
      if (p.projection === null) return;
      const k = groupKey(p), values = groups.get(k) ?? [];
      values.push(p.projection); groups.set(k, values);
    });
    groups.forEach((v) => v.sort((a, b) => a - b));
    const out = new Map<string, Tier & { pct: number; size: number }>();
    players.forEach((p) => {
      const value = p.projection;
      if (value === null) { out.set(p.id, { key: 't0', label: '—', pct: 0, size: 0 }); return; }
      const vals = groups.get(groupKey(p))!;
      const below = vals.filter((v) => v < value).length;
      const equal = vals.filter((v) => v === value).length;
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

  const groupCount = useMemo(() => new Set(players.filter((p) => p.projection !== null).map(groupKey)).size, [players]);
  const hasMultipleGroups = useMemo(() => new Set(players.map(groupKey)).size > 1, [players]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = term ? players.filter((p) => [p.name, p.team, p.opponent, p.position, p.rosterPositions].some((v) => v?.toLowerCase().includes(term))) : players;
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...f].sort((a, b) => {
      const missingOrder = Number(a.projection === null) - Number(b.projection === null);
      if (missingOrder) return missingOrder;
      const groupOrder = groupKey(a).localeCompare(groupKey(b));
      if (groupOrder !== 0) return groupOrder;
      if (sort.key === 'projection' || sort.key === 'salary') {
        const av = a[sort.key], bv = b[sort.key];
        if (av == null) return bv == null ? 0 : 1;
        if (bv == null) return -1;
        return (av - bv) * m;
      }
      const av = sort.key === 'position' ? a.rosterPositions ?? a.position : a[sort.key];
      const bv = sort.key === 'position' ? b.rosterPositions ?? b.position : b[sort.key];
      return String(av ?? '').localeCompare(String(bv ?? '')) * m;
    });
  }, [players, q, sort]);

  if (loading) return <div style={{ display: 'grid', gap: 4 }}>{Array.from({ length: 8 }, (_, n) => <div className="skeleton" key={n} style={{ height: 30 }} />)}</div>;
  if (!players.length) return <div className="state-box"><div className="state-icon"><TrendingUp size={17} /></div><strong>No projections available</strong><p>{hasCoverage ? 'No player projection rows were returned for this filter.' : 'Projection coverage is not available for the selected slate. Events and news may still be available.'}</p></div>;

  const toggle = (key: SortKey) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'projection' || key === 'salary' ? 'desc' : 'asc' });
  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => {
    const active = sort.key === k;
    return <th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={num ? 'num' : ''}>
      <button type="button" className={`pt-sort ${active ? 'on' : ''}`} onClick={() => toggle(k)} data-testid={`sort-${k}`}>
        {label}{active ? (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
      </button>
    </th>;
  };

  let rowInGroup = 0;
  return <div className="pt">
    <div className="pt-tools">
      <label className="pt-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, team, position" aria-label="Search projections" data-testid="input-projection-search" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X size={12} /></button>}</label>
      <span className="pt-count">{rows.length} / {players.length}</span>
    </div>
    <div className="pt-legend" aria-label="Projection color legend">
      {TIERS.map((t) => <span key={t.key}><i className={`pt-sw ${t.key}`} />{t.label}<em>{t.desc}</em></span>)}
    </div>
    <p className="pt-note">Colors compare sourced forecasts with the same sport, basis and source ({groupCount} {groupCount === 1 ? 'group' : 'groups'}), not confidence or DFS value. Forecast groups stay separate when sorting. Salary-only players appear below forecasts and remain neutral; “—” means unavailable, not zero. ESPN forecasts are not DraftKings or FanDuel scoring, and historical averages are not used as projections.</p>
    <div className="pt-scroll" role="region" aria-label="Player projections table" tabIndex={0}>
      <table className="pt-table">
        <thead><tr>
          <th className="num rk">#</th><Th k="name" label="Player" /><Th k="salary" label="Salary" num /><Th k="position" label="Pos" /><Th k="team" label="Team" /><Th k="opponent" label="Opp" /><Th k="projection" label="Proj" num /><th>Tier</th><th>Basis</th>
        </tr></thead>
        <tbody>{rows.length ? rows.map((p, i) => {
          const t = tiers.get(p.id)!;
          const mine = lookup(p, p.team);
          const oppAbbr = p.opponent || mine?.oppAbbr;
          const homeAway = p.homeAway ?? mine?.homeAway;
          const prefix = homeAway === 'home' ? 'vs ' : homeAway === 'away' ? 'at ' : '';
          const logo = p.teamLogo ?? mine?.logo;
          const newGroup = i === 0 || groupKey(rows[i - 1]) !== groupKey(p);
          if (newGroup) rowInGroup = 0;
          const groupRow = ++rowInGroup;
          return <Fragment key={p.id}>
            {hasMultipleGroups && newGroup && <tr className="pt-group-row"><td colSpan={9}>{p.projectionType} · {p.source}</td></tr>}
            <tr className={t.key} data-testid={`projection-${p.id}`}>
            <td className="num rk">{p.projection === null ? '—' : groupRow}</td>
            <td className="pname">{p.name}</td>
            <td className={`num ${p.salary == null ? 'dim' : ''}`} title={p.salarySource ?? 'No salary source connected'}>{p.salary == null ? '—' : `$${p.salary.toLocaleString('en-US')}`}</td>
            <td className="mono">{p.rosterPositions || p.position || '—'}</td>
            <td><span className="pt-team">{logo ? <img src={logo} alt="" loading="lazy" /> : <span className="pt-logo-fb" />}<span className="mono">{p.team || '—'}</span></span></td>
            <td className="mono" title={p.gameInfo ?? undefined}>{oppAbbr ? `${prefix}${oppAbbr}` : '—'}</td>
            <td className="num proj">{p.projection == null ? '—' : p.projection.toFixed(2)}</td>
            <td><span className={`pt-tier ${t.key}`} title={t.size ? `Percentile ${Math.round(t.pct * 100)} of ${t.size} in group` : 'No sourced forecast'}>{t.label}</span></td>
            <td className="basis">{p.projectionType} · {p.source}</td>
          </tr></Fragment>;
        }) : <tr><td colSpan={9} className="pt-empty">No players match "{q}".</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
