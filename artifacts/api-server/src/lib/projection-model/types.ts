export type ModelSport = "nfl" | "nhl" | "wnba" | "nba" | "mlb" | "nascar" | "cfb";
export type StatValues = Record<string, number>;
export interface HistoricalPlayer {
  id: string;
  name: string;
  teamId: string;
  position: string;
  stats: StatValues;
}
export interface HistoricalGame {
  version: number;
  id: string;
  date: string;
  phase: number;
  season: number;
  venue: string;
  teams: Array<{ id: string; name: string; abbreviation: string }>;
  players: HistoricalPlayer[];
}
export interface SlatePlayer {
  id: string;
  name: string;
  teamId: string;
  team: string;
  opponentId: string;
  opponent: string;
  position: string;
  availability: string;
  participation: string;
}
export interface ModelSettings {
  recentGames: number;
  recentWeight: number;
  matchupWeight: number;
}
export const MODEL_SPORTS: Record<ModelSport, { path: string; historyDays: number }> = {
  nfl: { path: "football/nfl", historyDays: 84 },
  cfb: { path: "football/college-football", historyDays: 84 },
  nba: { path: "basketball/nba", historyDays: 35 },
  wnba: { path: "basketball/wnba", historyDays: 35 },
  nhl: { path: "hockey/nhl", historyDays: 35 },
  mlb: { path: "baseball/mlb", historyDays: 35 },
  nascar: { path: "racing/nascar-premier", historyDays: 730 },
};
// Bump together when parsing, eligibility or historical-data meaning changes.
export const HISTORY_VERSION = 1;
