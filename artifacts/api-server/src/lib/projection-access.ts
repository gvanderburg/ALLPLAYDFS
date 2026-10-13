import { GetDfsDashboardResponse } from "@workspace/api-zod";

type DashboardData = ReturnType<typeof GetDfsDashboardResponse.parse>;

export function gateDashboardProjections(data: DashboardData, hasAccess: boolean): DashboardData {
  if (hasAccess) return { ...data, projectionsLocked: false };
  // Explicit allowlist prevents newly introduced premium fields leaking into
  // the visitor response. Public sorting must not reveal forecast rankings.
  const projections = data.projections.map((player) => ({
    id: player.id, name: player.name, sport: player.sport,
    team: player.team, opponent: player.opponent, position: player.position,
    projection: null, projectionType: "members_only",
    source: player.salarySource ?? "Public player list",
    salary: player.salary, salaryPlatform: player.salaryPlatform,
    salarySource: player.salarySource, salaryPlayerId: player.salaryPlayerId,
    salarySlateId: player.salarySlateId, rosterPositions: player.rosterPositions,
    gameInfo: player.gameInfo, teamLogo: player.teamLogo,
  })).sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0) || a.name.localeCompare(b.name));
  return { ...data, projectionsLocked: true, projections };
}
