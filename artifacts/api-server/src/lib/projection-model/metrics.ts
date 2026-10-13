import type { ModelMetric } from "@workspace/api-zod";
import type { ModelSport } from "./types";

export interface MetricDefinition extends ModelMetric {
  exposure?: string;
  matchup?: { metric: string; mode: "allowed" | "attack" };
  maximum?: number;
  minimum?: number;
}
const metric = (id: string, label: string, group: string, options: Partial<MetricDefinition> = {}): MetricDefinition => ({
  id, label, group, unit: "count", higherIsBetter: true, ...options,
});
const allowed = (id: string, label: string, group: string, options: Partial<MetricDefinition> = {}) =>
  metric(id, label, group, { matchup: { metric: id, mode: "allowed" }, ...options });
const football = [
  allowed("passingYards", "Pass yards", "Passing", { unit: "yards" }),
  allowed("passingTDs", "Pass TD", "Passing"),
  allowed("passingAttempts", "Pass attempts", "Passing"),
  allowed("passingCompletions", "Completions", "Passing"),
  allowed("interceptionsThrown", "INT thrown", "Passing", { higherIsBetter: false }),
  allowed("rushingAttempts", "Rush attempts", "Rushing"),
  allowed("rushingYards", "Rush yards", "Rushing", { unit: "yards" }),
  allowed("rushingTDs", "Rush TD", "Rushing"),
  allowed("receptions", "Receptions", "Receiving"),
  allowed("receivingYards", "Rec yards", "Receiving", { unit: "yards" }),
  allowed("receivingTDs", "Rec TD", "Receiving"),
  allowed("targets", "Targets", "Receiving"),
  metric("fumblesLost", "Fumbles lost", "Scoring", { higherIsBetter: false }),
  metric("twoPointConversions", "2PT conversions", "Scoring"),
  metric("returnTouchdowns", "Return TD", "Scoring"),
  metric("fumbleRecoveryTouchdowns", "Recovery TD", "Scoring"),
  allowed("fieldGoalsMade", "Field goals", "Kicking"),
  allowed("extraPointsMade", "Extra points", "Kicking"),
];
const basketball = [
  metric("minutes", "Minutes", "Workload", { unit: "minutes", maximum: 48 }),
  ...[
    ["points", "Points"], ["rebounds", "Rebounds"], ["assists", "Assists"],
    ["steals", "Steals"], ["blocks", "Blocks"], ["turnovers", "Turnovers"],
    ["threePointers", "3PT made"],
  ].map(([id, label]) => allowed(id, label, "Basketball", { exposure: "minutes", higherIsBetter: id !== "turnovers" })),
];
export const METRICS: Record<ModelSport, MetricDefinition[]> = {
  nfl: football,
  cfb: football,
  nba: basketball,
  wnba: basketball.map((item) => item.id === "minutes" ? { ...item, maximum: 40 } : item),
  nhl: [
    metric("timeOnIce", "TOI", "Workload", { unit: "minutes", maximum: 65 }),
    ...[["goals", "Goals"], ["assists", "Assists"], ["shots", "Shots"], ["blockedShots", "Blocks"]]
      .map(([id, label]) => allowed(id, label, "Skater", { exposure: "timeOnIce" })),
    metric("shotsAgainst", "Shots faced", "Goalie", { exposure: "timeOnIce", matchup: { metric: "shots", mode: "attack" }, higherIsBetter: false }),
    metric("goalsAgainst", "Goals allowed", "Goalie", { exposure: "timeOnIce", matchup: { metric: "goals", mode: "attack" }, higherIsBetter: false }),
    metric("saves", "Saves", "Goalie", { exposure: "timeOnIce", matchup: { metric: "shots", mode: "attack" } }),
    allowed("shotAttempts", "ShAtt", "Skater", { exposure: "timeOnIce" }),
    allowed("powerPlayPoints", "PPP", "Skater", { exposure: "timeOnIce" }),
    allowed("shortHandedPoints", "SHP", "Skater", { exposure: "timeOnIce" }),
    metric("shootoutGoals", "SO goals", "Skater", { maximum: 1 }),
    metric("plusMinus", "+/−", "Skater", { minimum: -Infinity }),
    allowed("wins", "W", "Goalie", { maximum: 1 }),
    allowed("shutouts", "SO", "Goalie", { maximum: 1 }),
    metric("overtimeLosses", "OTL", "Goalie", { maximum: 1 }),
  ],
  mlb: [
    metric("atBats", "At bats", "Hitter"),
    ...[["hits", "Hits"], ["runs", "Runs"], ["rbi", "RBI"], ["homeRuns", "HR"], ["walks", "Walks"], ["battingStrikeouts", "K batting"]]
      .map(([id, label]) => allowed(id, label, "Hitter", { exposure: "atBats", higherIsBetter: id !== "battingStrikeouts" })),
    ...[["singles", "1B"], ["doubles", "2B"], ["triples", "3B"], ["hitByPitch", "HBP"], ["stolenBases", "SB"]]
      .map(([id, label]) => allowed(id, label, "Hitter", { exposure: "atBats" })),
    metric("inningsPitched", "Innings", "Pitcher", { unit: "innings", maximum: 9 }),
    ...[
      ["pitcherStrikeouts", "K pitching", "battingStrikeouts"],
      ["hitsAllowed", "Hits allowed", "hits"], ["earnedRuns", "ER", "runs"],
      ["walksAllowed", "BB allowed", "walks"],
    ].map(([id, label, target]) => metric(id, label, "Pitcher", {
      exposure: "inningsPitched", matchup: { metric: target, mode: "attack" }, higherIsBetter: id === "pitcherStrikeouts",
    })),
    metric("hitBatters", "HBP allowed", "Pitcher", { exposure: "inningsPitched", higherIsBetter: false }),
    ...[["wins", "W"], ["qualityStarts", "QS"], ["completeGames", "CG"], ["shutouts", "SO"], ["noHitters", "No-hitter"]]
      .map(([id, label]) => metric(id, label, "Pitcher", { maximum: 1 })),
  ],
  nascar: [metric("finish", "Expected finish", "Driver", { unit: "position", higherIsBetter: false })],
};
