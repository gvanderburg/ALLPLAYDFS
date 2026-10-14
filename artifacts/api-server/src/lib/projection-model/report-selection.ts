import type { MatchupReport, PublishedMatchupRanking } from "@workspace/api-zod";
import { nflTeamKey } from "./nfl-teams";

export function selectReportRanking(
  reports: MatchupReport[], source: "pff" | "fantasypros", opponent: string, role: string,
  season: number, phase: number, week: number | null, cutoff: Date,
): PublishedMatchupRanking | null {
  const position = source === "pff" ? "secondary" : role;
  const candidates = reports.filter(r => r.status === "approved" && r.metadata.publisher === source && r.metadata.positions.some(p => p === position))
    .sort((a, b) => new Date(b.metadata.publishedAt).getTime() - new Date(a.metadata.publishedAt).getTime()
      || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
  if (!candidates.length) return null;
  const phaseName = phase === 1 ? "preseason" : phase === 2 ? "regular" : phase === 3 ? "postseason" : null;
  const matches = (r: MatchupReport) => r.metadata.season === season && r.metadata.phase === phaseName &&
    week !== null && week >= r.metadata.startWeek && week <= r.metadata.endWeek &&
    new Date(r.metadata.publishedAt) <= cutoff && new Date(r.metadata.asOf) <= cutoff;
  const matched = candidates.find(matches), report = matched ?? candidates[0], m = report.metadata;
  const rank = matched?.rows.find(row => row.team === nflTeamKey(opponent) && row.position === position)?.rank ?? null;
  const coverage = report.coverage[position] ?? 0;
  return {
    source, unit: source === "pff" ? "secondary" : `vs ${role}`, rank, rankedTeams: 32,
    rankOneMeans: m.rankOneMeans, sourceUrl: m.sourceUrl, asOf: new Date(m.asOf),
    period: `${m.season} ${m.phase} weeks ${m.startWeek}–${m.endWeek} · published ${new Date(m.publishedAt).toISOString().slice(0, 10)}`,
    status: !matched ? "stale" : rank === null ? "unavailable" : "available",
    note: `Owner-approved ${source === "pff" ? "PFF strength" : "FantasyPros positional allowance"} report. As-of ${new Date(m.asOf).toISOString()}. ${coverage}/32 teams for ${position}; ${report.fullCoverage ? "full declared scope" : "incomplete report"}. Permission is owner-attested, not independently verified. ` +
      (!matched ? "Stored coverage does not match this season/phase/week and pre-cutoff publication; ranks excluded."
        : rank === null ? "This opponent/position is absent; no ranks inferred."
          : source === "pff" ? "#1 is strongest/hardest. Passing-game context, not individual assignments."
            : "#1 allows the most fantasy points/easiest under FantasyPros scoring, not DK/FD scoring."),
  };
}
