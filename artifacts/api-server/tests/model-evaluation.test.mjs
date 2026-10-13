import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "allplay-evaluation-"));
await build({
  stdin: { contents: `export * from "./src/lib/model-evaluation/evaluate";
    export * from "./src/lib/model-evaluation/csv";
    export * from "./src/lib/projection-model/normalize";
    export * from "./src/lib/projection-model/types";
    export * from "@workspace/api-zod";`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", outfile: join(dir, "evaluation.mjs"),
});
const { HISTORY_VERSION, pregameHistory, observedFantasy, reconstructPool, evaluateSlate, calibrationGroups,
  ownershipSummary, researchSummaries, validateImportCsv, parseCsv, normalizeSummary,
  StartEvaluationBody, VerifyEvaluationImportBody } = await import(pathToFileURL(join(dir, "evaluation.mjs")));
test.after(async () => rm(dir, { recursive: true, force: true }));

const cutoff = "2026-03-24T00:00:00Z";
const settings = { recentGames: 3, recentWeight: 70, matchupWeight: 25 };
const stats = (points = 20) => ({ points, rebounds: 6, assists: 4, blocks: 1, steals: 2, turnovers: 2, minutes: 30, threePointers: 2 });
const game = (id, date, overrides = {}) => ({
  version: HISTORY_VERSION, id, date, completedAt: new Date(Date.parse(date) + 3 * 3600000).toISOString(),
  phase: 2, season: 2026, venue: "Arena",
  teams: [{ id: "a", name: "Alpha", abbreviation: "AAA" }, { id: "b", name: "Beta", abbreviation: "BBB" }],
  players: [{ id: "p1", name: "Prior Player", teamId: "a", position: "SG", stats: stats() }],
  ...overrides,
});
const history = [game("h1", "2026-03-20T18:00:00Z"), game("h2", "2026-03-22T18:00:00Z")];
const target = game("outcome", "2026-03-24T18:00:00Z", {
  players: [{ id: "p1", name: "Prior Player", teamId: "a", position: "SG", stats: stats(50), fantasyPoints: 9999, projectedPoints: -1000 }],
});
const pool = () => reconstructPool([target], history);

test("completion, phase, version and strict cutoff are all enforced; scheduled start alone cannot leak suspended/future results", () => {
  const records = [
    ...history, game("future", "2026-03-25T18:00:00Z"), game("sameDay", cutoff),
    game("ended-at-cutoff", "2026-03-23T18:00:00Z", { completedAt: cutoff }),
    game("suspended", "2026-03-19T18:00:00Z", { completedAt: "2026-03-25T12:00:00Z", recordedAt: "2026-03-23T12:00:00Z" }),
    game("no-completion", "2026-03-19T18:00:00Z", { completedAt: undefined }),
    game("late-receipt", "2026-03-19T18:00:00Z", { completedAt: undefined, recordedAt: cutoff }),
    game("safe-receipt", "2026-03-19T18:00:00Z", { completedAt: undefined, recordedAt: "2026-03-23T12:00:00Z" }),
    game("other-phase", "2026-03-19T18:00:00Z", { phase: 1 }),
    game("stale-version", "2026-03-19T18:00:00Z", { version: HISTORY_VERSION - 1 }),
  ];
  assert.deepEqual(pregameHistory(records, cutoff, 2).map(g => g.id), ["h1", "h2", "safe-receipt"]);
  assert.throws(() => pregameHistory(records, "invalid", 2));
});
test("historical pool comes from pregame appearances, not current rosters or outcome participants", () => {
  const events = [{ ...target, players: [...target.players, { id: "new-star", name: "Future Arrival", teamId: "a", position: "SG", stats: stats(99) }] }];
  assert.deepEqual(reconstructPool(events, history).map(p => p.id), ["p1"]);
  assert.match(pool()[0].availability, /unknown/);
});
test("replay forecasts/percentiles/rankings are invariant to evaluation and future outcomes", () => {
  const a = evaluateSlate("nba", "fanduel", "2026-03-24", cutoff, settings, [target], history, pool());
  const poisoned = game("poison", "2026-03-25T18:00:00Z", { players: [{ ...target.players[0], stats: stats(100000) }] });
  const changed = { ...target, players: [{ ...target.players[0], stats: stats(150), fantasyPoints: 0 }] };
  const b = evaluateSlate("nba", "fanduel", "2026-03-24", cutoff, settings, [changed], [...history, target, poisoned], pool());
  for (const k of ["forecast", "p25", "p50", "p75", "p85", "p95", "p99", "balancedRank", "tournamentRank", "estimatedOwnership", "historyEventIds"]) assert.deepEqual(a[0][k], b[0][k], k);
  assert.ok(Math.abs(b[0].actual - a[0].actual - 100) < 1e-9);
  assert.deepEqual(a[0].historyEventIds.sort(), ["h1", "h2"]);
});
test("observed score and calibration errors derive from final raw stats, never provider or own forecast fields", () => {
  const rows = evaluateSlate("nba", "fanduel", "2026-03-24", cutoff, settings, [target], history, pool());
  assert.equal(rows[0].actual, 50 + 6 * 1.2 + 4 * 1.5 + 1 * 3 + 2 * 3 - 2);
  assert.notEqual(rows[0].actual, 9999);
  const [summary] = calibrationGroups(rows, "nba", "fanduel");
  assert.equal(summary.n, 1); assert.equal(summary.position, "SG"); assert.equal(summary.site, "fanduel");
  assert.equal(summary.mae, Math.abs(rows[0].forecast - rows[0].actual));
  assert.equal(summary.bias, rows[0].forecast - rows[0].actual);
  const altered = [{ ...rows[0], actual: rows[0].actual + 10 }];
  assert.equal(calibrationGroups(altered, "nba", "fanduel")[0].bias, summary.bias - 10);
});
test("forecast and outcome use the same counterfactual site rules, including observed bonuses", () => {
  assert.equal(observedFantasy("nba", "draftkings", "SG", stats(10)).score, 10 + 2 * .5 + 6 * 1.25 + 4 * 1.5 + 1 * 2 + 2 * 2 - 2 * .5);
  const triple = { ...stats(30), rebounds: 10, assists: 10 };
  assert.equal(observedFantasy("nba", "draftkings", "SG", triple).score, 30 + 1 + 12.5 + 15 + 2 + 4 - 1 + 4.5);
  assert.notEqual(observedFantasy("nba", "draftkings", "SG", triple).score, observedFantasy("nba", "fanduel", "SG", triple).score);
});
test("unknown/DNP, unsupported site and incomplete scoring are never observed zeros", () => {
  assert.equal(observedFantasy("nba", "fanduel", "SG", undefined).score, null);
  assert.equal(observedFantasy("nba", "ownersbox", "SG", stats()).score, null);
  const { turnovers, ...partial } = stats();
  assert.equal(observedFantasy("nba", "fanduel", "SG", partial).score, null);
  assert.notEqual(observedFantasy("nba", "fanduel", "SG", stats(0)).score, null);
  const rows = evaluateSlate("nba", "fanduel", "2026-03-24", cutoff, settings, [{ ...target, players: [] }], history, pool());
  assert.equal(rows[0].actual, null); assert.equal(calibrationGroups(rows, "nba", "fanduel").length, 0);
  assert.equal(researchSummaries(rows, true)[0].n, 1);
  assert.equal(researchSummaries(rows, true)[0].observedN, 0);
  assert.equal(researchSummaries(rows, true)[0].actualMean, null);
});
test("coverage uses observed outcomes and reports denominators, sample and holdout periods", () => {
  const row = evaluateSlate("nba", "fanduel", "2026-03-24", cutoff, settings, [target], history, pool())[0];
  const [g] = calibrationGroups([{ ...row, forecast: 10, actual: 20, p25: 5, p50: 10, p75: 20, p85: 25, p95: 30, p99: 50 },
    { ...row, date: "2026-03-25", forecast: 20, actual: 10, p25: 5, p50: 10, p75: 20, p85: 25, p95: 30, p99: null },
    { ...row, exclusion: "incomplete", actual: 9999 }], "nba", "fanduel");
  assert.equal(g.n, 2); assert.equal(g.bias, 0); assert.equal(g.mae, 10);
  assert.deepEqual(g.coverage, { p25: 0, p50: .5, p75: 1, p85: 1, p95: 1, p99: 1, central50: 1 });
  assert.equal(g.coverageN.p99, 1); assert.equal(g.fromDate, "2026-03-24"); assert.equal(g.toDate, "2026-03-25");
});
test("owner ownership CSV requires actual numeric observations and rejects forecasts/duplicates/range errors", () => {
  const v = validateImportCsv("player_id,ownership_percent\np1,0\np2,42.3\n", "ownership");
  assert.equal(v.records[0].ownership, 0); assert.equal(v.rowCount, 2); assert.equal(v.hash.length, 64);
  for (const text of ["player_id,projected_ownership\np1,20", "player_id,ownership_percent\np1,", "player_id,ownership_percent\np1,101",
    "player_id,ownership_percent\np1,-1", "player_id,ownership_percent\np1,10%\n", "player_id,ownership_percent\np1,5\np1,20"])
    assert.throws(() => validateImportCsv(text, "ownership"));
});
test("ownership calibration uses imported actuals only; no actual import means no calibration", () => {
  const rows = [{ playerId: "p1", date: "2026-03-24", estimatedOwnership: 30 }, { playerId: "p2", date: "2026-03-24", estimatedOwnership: null }];
  const a = ownershipSummary(rows, [], "2026-03-24");
  assert.equal(a.n, 0); assert.equal(a.mae, null);
  const b = ownershipSummary(rows, [{ playerId: "p1", ownership: 10 }, { playerId: "p2", ownership: 80 }], "2026-03-24");
  assert.equal(b.n, 1); assert.equal(b.unmatched, 1); assert.equal(b.mae, 20); assert.equal(b.bias, 20);
  const c = ownershipSummary(rows, [{ playerId: "p1", ownership: 50 }], "2026-03-24");
  assert.equal(c.bias, -20);
  assert.equal(ownershipSummary(rows, [{ playerId: "p1", ownership: 10 }], "2026-03-25").n, 0);
});
test("CSV quoting, header order, pool provenance inputs and explicit salary gaps are validated", () => {
  const csv = 'player_id,event_id,team_id,name,position,availability,salary\r\np1,123,a,"Name, ""Junior""",SG,Available,\r\n';
  const p = validateImportCsv(csv, "pool").records[0];
  assert.equal(p.name, 'Name, "Junior"'); assert.equal(p.salary, null); assert.equal(p.eventId, "123");
  assert.throws(() => parseCsv('a,b\n"x,b')); assert.throws(() => parseCsv('a,b\n"x"not,b')); assert.throws(() => parseCsv("a,b\n1,2,3"));
  assert.throws(() => validateImportCsv(csv.replace(",Available,", ",,"), "pool"));
  assert.throws(() => validateImportCsv(csv.replace(",Available,", ",Available,-10"), "pool"));
});
test("transport validates integer model settings and verification fields", () => {
  assert.ok(StartEvaluationBody.safeParse({ sport: "nba", site: "fanduel", fromDate: "2026-03-24", toDate: "2026-03-24", ...settings }).success);
  assert.equal(StartEvaluationBody.safeParse({ sport: "nba", site: "fanduel", fromDate: "x", toDate: "x", ...settings, recentGames: 3.5 }).success, false);
  assert.equal(VerifyEvaluationImportBody.safeParse({ uploadId: "a", kind: "ownership", sport: "nba", site: "fanduel", slateDate: "2026-03-24", contestId: "123", source: "Official contest export", asOf: "bad-date", verified: true }).success, false);
});
test("final-play completion requires reconciled final score and a wallclock, not scheduled start", () => {
  const raw = { header: { id: "123", season: { year: 2026, type: 2 }, competitions: [{
    date: "2026-03-23T23:00Z", status: { type: { completed: true } }, competitors: [
      { homeAway: "home", score: "100", team: { id: "a" } }, { homeAway: "away", score: "90", team: { id: "b" } }],
  }] }, plays: [{ text: "End of Game", homeScore: 100, awayScore: 90, wallclock: "2026-03-24T01:30Z" }],
    boxscore: { players: [{ team: { id: "a" }, statistics: [{ keys: ["points"], athletes: [{ athlete: { id: "p1", displayName: "Player" }, stats: ["20"] }] }] }] } };
  assert.equal(normalizeSummary(raw, "nba").completedAt, "2026-03-24T01:30Z");
  assert.equal(pregameHistory([normalizeSummary(raw, "nba")], cutoff, 2).length, 0);
  assert.equal(normalizeSummary({ ...raw, plays: [{ ...raw.plays[0], homeScore: 99 }] }, "nba").completedAt, undefined);
  assert.equal(normalizeSummary({ ...raw, plays: [{ ...raw.plays[0], text: "End of 3rd Quarter" }] }, "nba").completedAt, undefined);
});
test("private routes enforce server owner identity and CSRF origin; all external imports are scoped to issued uploads", async () => {
  const route = await readFile("src/routes/evaluations.ts", "utf8");
  assert.match(route, /isOwnerAccount\(userId\)/);
  assert.match(route, /owner\(req, res, true\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /origin.host !== getClerkProxyHost\(req\)/);
  assert.match(route, /eq\(evaluationUploads.ownerId, userId\)/);
  assert.match(route, /run.site !== body.site/);
  assert.match(route, /s.contestId === body.contestId/);
  assert.match(route, /ifGenerationMatch: 0/);
});
