import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "allplay-stat-model-"));
await build({
  stdin: { contents: 'export * from "./src/lib/projection-model/calculate"; export * from "./src/lib/projection-model/normalize"; export * from "./src/lib/projection-model/metrics"; export * from "./src/lib/projection-model/date-ranges";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", outfile: join(dir, "model.mjs"),
});
const { calculatePlayers, recencyMean, normalizeSummary, normalizeRace, innings, duration, METRICS, annualHistoryRanges } = await import(pathToFileURL(join(dir, "model.mjs")));
const settings = { recentGames: 3, recentWeight: 70, matchupWeight: 25 };
const candidate = (overrides = {}) => ({
  id: "p1", name: "Recorded Player", team: "AAA", teamId: "a", opponent: "BBB", opponentId: "b",
  position: "SG", availability: "Unverified", participation: "Conditional", ...overrides,
});
const game = (i, stats, opponents = {}, overrides = {}) => ({
  version: 1, id: `g${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}T20:00:00Z`,
  phase: 2, season: 2026, venue: "Arena", teams: [{ id: "a", name: "A", abbreviation: "AAA" }, { id: "b", name: "B", abbreviation: "BBB" }],
  players: [{ id: "p1", name: "Recorded Player", teamId: "a", position: "SG", stats },
    { id: "p2", name: "Opponent", teamId: "b", position: "SG", stats: opponents }],
  ...overrides,
});
const calc = (sport, games, options = {}) => calculatePlayers(sport, [candidate(options.player)], games,
  { ...settings, ...options.settings }, "2026-10-01T00:00:00Z", 2, options.venue ?? "");
const stat = (result, id) => result.players[0].stats.find(s => s.id === id);

test("recency weighting is explicit and favors newer performances", () => {
  assert.ok(recencyMean([30, 20, 10]) > 20);
  assert.ok(recencyMean([10, 20, 30]) < 20);
});
test("blend controls alter only the independent model, not provider forecasts", () => {
  const games = Array.from({ length: 6 }, (_, i) => game(i, { minutes: 30, points: 10 + i * 4 }, { minutes: 30, points: 5 }));
  const recent = stat(calc("nba", games, { settings: { matchupWeight: 0, recentWeight: 100 } }), "points");
  const baseline = stat(calc("nba", games, { settings: { matchupWeight: 0, recentWeight: 0 } }), "points");
  assert.ok(recent.projected > baseline.projected);
  assert.equal(baseline.projected, 20);
  assert.equal(baseline.opponentRank, 2);
});
test("lower opponent allowance reduces the stat and adjustment stays bounded", () => {
  const games = Array.from({ length: 6 }, (_, i) => game(i, { minutes: 30, points: 15 }, { minutes: 30, points: 60 }));
  const result = calc("nba", games, { settings: { matchupWeight: 50 } });
  const points = stat(result, "points");
  assert.equal(points.opponentRank, 1);
  assert.ok(points.projected < 15);
  assert.ok(points.matchupMultiplier >= 0.8);
  assert.ok(points.matchupMultiplier <= 1.2);
});
test("no opponent sample means no invented ranking and neutral adjustment", () => {
  const games = Array.from({ length: 3 }, (_, i) => game(i, { passingYards: 200 }));
  const result = calculatePlayers("nfl", [candidate({ opponentId: "never-seen" })], games, settings, "2026-10-01T00:00:00Z", 2);
  assert.equal(stat(result, "passingYards").opponentRank, null);
  assert.equal(stat(result, "passingYards").matchupMultiplier, 1);
});
test("missing history is not zero; observed zero remains a real estimate", () => {
  assert.equal(calc("nfl", []).players[0].stats.length, 0);
  assert.match(calc("nfl", []).players[0].reason, /two published/);
  assert.equal(stat(calc("nfl", [game(0, { passingTDs: 0 })]), "passingTDs").projected, null);
  assert.equal(stat(calc("nfl", [game(0, { passingTDs: 0 }), game(1, { passingTDs: 0 })]), "passingTDs").projected, 0);
});
test("same-day/future results and other season phases do not enter the model", () => {
  const games = [game(0, { points: 10, minutes: 30 }), game(1, { points: 10, minutes: 30 }),
    game(2, { points: 999, minutes: 30 }, {}, { date: "2026-10-01T00:00:00Z" }),
    game(3, { points: 888, minutes: 30 }, {}, { phase: 1 }),
    game(4, { points: 777, minutes: 30 }, {}, { phase: 0 })];
  const result = calc("nba", games, { settings: { matchupWeight: 0 } });
  assert.equal(result.players[0].history.length, 2);
  assert.equal(stat(result, "points").projected, 10);
});
test("innings parse baseball outs rather than treating 2.2 as a decimal", () => {
  assert.equal(innings("2.2"), 2 + 2 / 3);
  assert.equal(innings("8.0"), 8);
  assert.equal(innings("2.3"), null);
  assert.equal(duration("20:30"), 20.5);
  assert.equal(duration("20:61"), null);
});
test("saves, catches and hits obey opportunity constraints", () => {
  const nhl = calc("nhl", [game(0, { timeOnIce: 60, shotsAgainst: 30, saves: 29, goalsAgainst: 4 }),
    game(1, { timeOnIce: 60, shotsAgainst: 32, saves: 30, goalsAgainst: 3 })]);
  assert.equal(stat(nhl, "saves").projected, Math.round((stat(nhl, "shotsAgainst").projected - stat(nhl, "goalsAgainst").projected) * 100) / 100);
  const nfl = calc("nfl", [game(0, { receptions: 7, targets: 5 }), game(1, { receptions: 8, targets: 6 })]);
  assert.ok(stat(nfl, "receptions").projected <= stat(nfl, "targets").projected);
  const mlb = calc("mlb", [game(0, { atBats: 4, hits: 5, homeRuns: 6 }), game(1, { atBats: 4, hits: 5, homeRuns: 6 })]);
  assert.ok(stat(mlb, "hits").projected <= stat(mlb, "atBats").projected);
  assert.ok(stat(mlb, "homeRuns").projected <= stat(mlb, "hits").projected);
});
test("all seven sports have independent tracked raw-stat models", () => {
  const keys = ["nfl", "nhl", "wnba", "nba", "mlb", "nascar", "cfb"];
  assert.deepEqual(Object.keys(METRICS).sort(), keys.sort());
  for (const sport of keys) {
    const id = METRICS[sport][0].id;
    const result = calc(sport, [game(0, { [id]: 5 }), game(1, { [id]: 6 })]);
    assert.equal(typeof stat(result, id).projected, "number");
  }
});
test("NASCAR uses recorded finishes and safe venue history, not a fictional defense", () => {
  const games = Array.from({ length: 6 }, (_, i) => game(i, {}, {}, {
    venue: i < 2 ? "NASCAR Cup Series at Phoenix" : "Other venue", teams: [],
    players: Array.from({ length: 40 }, (_, d) => ({
      id: d ? `driver${d}` : "p1", name: "Driver", teamId: "field", position: "Driver", stats: { finish: d ? d + 1 : i < 2 ? 5 : 20 },
    })),
  }));
  const withoutTrack = stat(calc("nascar", games, { venue: "Unknown track" }), "finish");
  const withTrack = stat(calc("nascar", games, { venue: "NASCAR Cup Series at Phoenix" }), "finish");
  assert.ok(withTrack.projected < withoutTrack.projected);
  assert.equal(withTrack.opponentRank, null);
  assert.equal(withTrack.defenseGames, 2);
  assert.equal(stat(calc("nascar", games, { venue: "NASCAR Cup Series at Charlotte" }), "finish").matchupMultiplier, 1);
});
test("box-score keys normalize correctly and duplicate NHL skater groups do not double-count", () => {
  const record = { id: "9", displayName: "Actual Name", position: { abbreviation: "C" } };
  const group = { name: "forwards", keys: ["timeOnIce", "goals", "assists", "shotsTotal", "blockedShots"],
    athletes: [{ athlete: record, stats: ["20:30", "1", "2", "4", "0"] }] };
  const data = {
    header: { id: "88", season: { year: 2026, type: 2 }, competitions: [{ date: "2026-09-25T21:00Z",
      status: { type: { completed: true } }, competitors: [{ id: "a", team: { id: "a" } }, { id: "b", team: { id: "b" } }] }] },
    boxscore: { players: [{ team: { id: "a" }, statistics: [group, { ...group, name: "skaters" }] }] },
  };
  const normalized = normalizeSummary(data, "nhl");
  assert.equal(normalized.players.length, 1);
  assert.equal(normalized.players[0].stats.goals, 1);
  assert.equal(normalized.players[0].stats.timeOnIce, 20.5);
  data.header.competitions[0].status.type.completed = false;
  assert.equal(normalizeSummary(data, "nhl"), null);
});
test("completed racing order is required; qualifying/scheduled order is not a result", () => {
  const event = { id: "r1", date: "2026-09-01T19:00Z", name: "Phoenix", status: { type: { completed: false } },
    competitions: [{ competitors: [{ id: "p1", order: 1, athlete: { displayName: "Driver" } }] }] };
  assert.equal(normalizeRace(event), null);
  event.status.type.completed = true;
  assert.equal(normalizeRace(event).players[0].stats.finish, 1);
});
test("racing history uses bounded annual queries without gaps or a future day", () => {
  assert.deepEqual(annualHistoryRanges(new Date("2024-10-13T00:00Z"), new Date("2026-10-13T00:00Z")),
    ["20241013-20241231", "20250101-20251231", "20260101-20261012"]);
  assert.deepEqual(annualHistoryRanges(new Date("2024-02-28T00:00Z"), new Date("2024-03-01T00:00Z")),
    ["20240228-20240229"]);
});
test.after(async () => { await rm(dir, { recursive: true, force: true }); });
