import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "allplay-stat-model-"));
await build({
  stdin: { contents: 'export * from "./src/lib/projection-model/calculate"; export * from "./src/lib/projection-model/normalize"; export * from "./src/lib/projection-model/metrics"; export * from "./src/lib/projection-model/date-ranges"; export * from "./src/lib/projection-model/fantasy";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", outfile: join(dir, "model.mjs"),
});
const { calculatePlayers, recencyMean, normalizeSummary, normalizeRace, innings, duration, METRICS, annualHistoryRanges, scoringRule, scoreOutcome } = await import(pathToFileURL(join(dir, "model.mjs")));
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

test("NHL standard scoring includes each site's bonuses, goalie decisions and penalties", () => {
  const dk = scoringRule("nhl", "draftkings", false);
  const v = { goals: 3, assists: 0, shots: 5, blockedShots: 3, shortHandedPoints: 1, shootoutGoals: 1 };
  assert.equal(scoreOutcome(dk, v), 8.5 * 3 + 1.5 * 5 + 1.3 * 3 + 2 + 1.5 + 12);
  assert.equal(scoreOutcome(scoringRule("nhl", "fanduel", false), { goals: 1, assists: 2, shots: 4, blockedShots: 3, powerPlayPoints: 2, shortHandedPoints: 1 }), 42.2);
  assert.equal(scoreOutcome(scoringRule("nhl", "draftkings", true), { wins: 0, saves: 35, goalsAgainst: 3, shutouts: 0, overtimeLosses: 1 }), 24.5 - 10.5 + 2 + 3);
  assert.equal(scoreOutcome(scoringRule("nhl", "fanduel", true), { wins: 1, saves: 30, goalsAgainst: 0, shutouts: 1 }), 44);
  assert.equal(scoreOutcome(scoringRule("nhl", "yahoo", false), { goals: 1, assists: 1, plusMinus: -2, shots: 2, blockedShots: 1, powerPlayPoints: 1 }), 10.8);
});
test("current FanDuel NFL bonus rules differ from CFB and MLB pitcher/hitter rules differ", () => {
  const football = { passingYards: 300, passingTDs: 2, interceptionsThrown: 1, rushingYards: 100, rushingTDs: 1, receivingYards: 0, receivingTDs: 0, receptions: 0, fumblesLost: 1, twoPointConversions: 0, returnTouchdowns: 0, fumbleRecoveryTouchdowns: 0 };
  assert.equal(scoreOutcome(scoringRule("nfl", "fanduel", false, "QB"), football), 39);
  assert.equal(scoreOutcome(scoringRule("cfb", "fanduel", false, "QB"), football), 33);
  assert.ok(scoringRule("mlb", "fanduel", false, "SP").weights.qualityStarts);
  assert.ok(scoringRule("mlb", "fanduel", false, "OF").weights.singles);
});
test("own NHL forecasts provide deterministic ordered site distributions; no external forecasts", () => {
  const values = { timeOnIce: 20, goals: .5, assists: .7, shots: 3, blockedShots: 1.4, powerPlayPoints: .3, shortHandedPoints: .02, shootoutGoals: 0, plusMinus: -1, shotAttempts: 6 };
  const games = Array.from({ length: 5 }, (_, i) => game(i, { ...values, goals: i % 2, assists: i % 3, shots: i + 1 }));
  const first = calc("nhl", games, { player: { position: "C" } }).players[0];
  const second = calc("nhl", games, { player: { position: "C" } }).players[0];
  assert.deepEqual(first.fantasy, second.fantasy);
  for (const site of ["draftkings", "fanduel", "yahoo"]) {
    const f = first.fantasy.find(v => v.site === site);
    assert.equal(f.status, "ready"); assert.equal(f.simulations, 2048);
    assert.ok(Number.isFinite(f.mean)); assert.ok(f.std >= 0);
    const quantiles = [f.p25, f.p50, f.p75, f.p85, f.p95, f.p99];
    assert.deepEqual(quantiles, [...quantiles].sort((a, b) => a - b));
  }
  const unsupported = first.fantasy.find(v => v.site === "ownersbox");
  assert.equal(unsupported.status, "unavailable"); assert.equal(unsupported.mean, null);
  assert.equal(stat({ players: [first] }, "plusMinus").projected, -1);
  const fdExpected = Object.entries(scoringRule("nhl", "fanduel", false).weights).reduce((n, [key, weight]) => n + stat({ players: [first] }, key).projected * weight, 0);
  assert.equal(first.fantasy.find(v => v.site === "fanduel").mean, Math.round(fdExpected * 100) / 100);
});
test("missing scoring fields are not zero, and known subtotals are never full scores", () => {
  const g = [game(0, { timeOnIce: 20, goals: 1, assists: 1, shots: 3, blockedShots: 0 }),
    game(1, { timeOnIce: 20, goals: 0, assists: 2, shots: 4, blockedShots: 1 })];
  const f = calc("nhl", g).players[0].fantasy.find(v => v.site === "fanduel");
  assert.equal(f.status, "partial"); assert.equal(f.mean, null); assert.equal(f.p99, null);
  assert.ok(f.trackedMean > 0); assert.ok(f.missingStats.includes("powerPlayPoints"));
  const football = calc("nfl", [game(0, { passingYards: 250, passingTDs: 2 }), game(1, { passingYards: 220, passingTDs: 1 })]).players[0];
  assert.equal(football.fantasy.find(v => v.site === "fanduel").mean, null);
});
test("mean-zero observed scoring inputs remain valid while insufficient appearances stay blank", () => {
  const v = { timeOnIce: 20, goals: 0, assists: 0, shots: 0, blockedShots: 0, powerPlayPoints: 0, shortHandedPoints: 0, shootoutGoals: 0, plusMinus: 0 };
  const f = calc("nhl", [game(0, v), game(1, v)]).players[0].fantasy.find(v => v.site === "fanduel");
  assert.equal(f.status, "ready"); assert.equal(f.mean, 0); assert.equal(f.std, 0);
  assert.equal(calc("nhl", [game(0, v)]).players[0].fantasy.find(v => v.site === "fanduel").mean, null);
});
test("independent team/game projections exclude future and unmatched phases", () => {
  const games = [game(0, { goals: 2 }, { goals: 1 }), game(1, { goals: 4 }, { goals: 3 }),
    game(2, { goals: 900 }, { goals: 900 }, { date: "2026-10-10T00:00Z" }),
    game(3, { goals: 900 }, { goals: 900 }, { phase: 1 })];
  const p = calc("nhl", games, { settings: { recentWeight: 0, matchupWeight: 0 } }).players[0];
  assert.equal(p.modelTeamTotal, 3); assert.equal(p.modelGameTotal, 5);
  assert.equal(calc("nhl", [games[0]]).players[0].modelTeamTotal, null);
});
test("new fantasy-point totals change when ALLPLAY's own form settings change", () => {
  const v = { minutes: 30, rebounds: 5, assists: 3, blocks: 1, steals: 1, turnovers: 1, threePointers: 2 };
  const games = [game(0, { ...v, points: 8 }), game(1, { ...v, points: 12 }), game(2, { ...v, points: 35 })];
  const oldForm = calc("nba", games, { settings: { recentGames: 3, recentWeight: 0, matchupWeight: 0 } }).players[0];
  const newForm = calc("nba", games, { settings: { recentGames: 3, recentWeight: 100, matchupWeight: 0 } }).players[0];
  assert.ok(newForm.fantasy.find(v => v.site === "fanduel").mean > oldForm.fantasy.find(v => v.site === "fanduel").mean);
});
const hockeyBox = () => {
  const keys = ["timeOnIce", "goals", "assists", "shotsTotal", "blockedShots", "plusMinus", "shootoutGoals", "shotsMissed"];
  const athlete = (id, stats, position = "C") => ({ athlete: { id, displayName: id, position: { abbreviation: position } }, stats });
  const play = (kind, id, extra = {}) => ({ type: { text: kind }, period: { number: 3 }, participants: [{ type: kind === "Goal" ? "scorer" : "shooter", athlete: { id } }], ...extra });
  return {
    header: { id: "enriched", season: { year: 2026, type: 2 }, competitions: [{ date: "2026-09-25T21:00Z",
      status: { type: { completed: true } }, competitors: [
        { id: "a", team: { id: "a", abbreviation: "AAA" }, winner: true },
        { id: "b", team: { id: "b", abbreviation: "BBB" }, winner: false },
      ] }] },
    boxscore: { players: [
      { team: { id: "a" }, statistics: [
        { name: "forwards", keys, athletes: [athlete("p1", ["20:00", "1", "0", "2", "1", "-1", "0", "1"])] },
        { name: "goalies", keys: ["timeOnIce", "goalsAgainst", "shotsAgainst", "saves"], athletes: [athlete("ga", ["60:00", "0", "1", "1"], "G")] },
      ] },
      { team: { id: "b" }, statistics: [
        { name: "forwards", keys, athletes: [athlete("p2", ["20:00", "0", "0", "1", "1", "0", "0", "0"])] },
        { name: "goalies", keys: ["timeOnIce", "goalsAgainst", "shotsAgainst", "saves"], athletes: [athlete("gb", ["60:00", "1", "2", "1"], "G")] },
      ] },
    ], teams: [
      { team: { id: "a" }, statistics: [{ name: "powerPlayGoals", displayValue: "1" }, { name: "shortHandedGoals", displayValue: "0" }] },
      { team: { id: "b" }, statistics: [{ name: "powerPlayGoals", displayValue: "0" }, { name: "shortHandedGoals", displayValue: "0" }] },
    ] },
    plays: [play("Goal", "p1", { strength: { abbreviation: "power-play" } }), play("Shot", "p1"), play("Missed", "p1"),
      play("Blocked", "p1", { participants: [{ type: "shooter", athlete: { id: "p1" } }, { type: "defender", athlete: { id: "p2" } }] }),
      play("Blocked", "p2", { participants: [{ type: "shooter", athlete: { id: "p2" } }, { type: "defender", athlete: { id: "p1" } }] }),
      play("Shot", "p2"), play("End of Game", "p1")],
  };
};
test("verified hockey play logs supply shot attempts/PP/SH without inventing absent logs", () => {
  const full = normalizeSummary(hockeyBox(), "nhl");
  const p = full.players.find(p => p.id === "p1");
  assert.equal(p.stats.shotAttempts, 4); assert.equal(p.stats.powerPlayPoints, 1); assert.equal(p.stats.shortHandedPoints, 0);
  assert.equal(full.players.find(p => p.id === "ga").stats.wins, 1);
  assert.equal(full.players.find(p => p.id === "gb").stats.overtimeLosses, 0);
  const missing = hockeyBox(); delete missing.plays;
  const unverified = normalizeSummary(missing, "nhl").players.find(p => p.id === "p1");
  assert.equal(unverified.stats.shotAttempts, undefined); assert.equal(unverified.stats.powerPlayPoints, undefined);
  const incomplete = hockeyBox(); incomplete.plays.shift();
  assert.equal(normalizeSummary(incomplete, "nhl").players.find(p => p.id === "p1").stats.powerPlayPoints, undefined);
  const missingAttempt = hockeyBox(); missingAttempt.plays = missingAttempt.plays.filter(p => p.type.text !== "Missed");
  assert.equal(normalizeSummary(missingAttempt, "nhl").players.find(p => p.id === "p1").stats.shotAttempts, undefined);
});
test("empty-net manpower must reconcile to PP/SH team totals rather than silently count as even strength", () => {
  const unknown = hockeyBox(); unknown.plays[0].strength.abbreviation = "empty-net";
  assert.equal(normalizeSummary(unknown, "nhl").players.find(p => p.id === "p1").stats.powerPlayPoints, undefined);
  unknown.boxscore.teams[0].statistics[0].displayValue = "0";
  assert.equal(normalizeSummary(unknown, "nhl").players.find(p => p.id === "p1").stats.powerPlayPoints, 0);
});
test("overtime goalie decisions use published end periods; split goalie wins remain unknown without decision data", () => {
  const overtime = hockeyBox(); overtime.plays.at(-1).period.number = 4;
  assert.equal(normalizeSummary(overtime, "nhl").players.find(p => p.id === "gb").stats.overtimeLosses, 1);
  const split = hockeyBox();
  split.boxscore.players[0].statistics[1].athletes.push({ athlete: { id: "ga2", displayName: "ga2", position: { abbreviation: "G" } }, stats: ["10:00", "0", "1", "1"] });
  assert.equal(normalizeSummary(split, "nhl").players.find(p => p.id === "ga").stats.wins, undefined);
  split.header.competitions[0].status.featuredAthletes = [{ name: "winningGoalie", playerId: "ga2" }];
  const known = normalizeSummary(split, "nhl");
  assert.equal(known.players.find(p => p.id === "ga").stats.wins, 0);
  assert.equal(known.players.find(p => p.id === "ga2").stats.wins, 1);
});

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
