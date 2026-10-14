import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "allplay-cup-"));
await build({ stdin: { contents: `
  export * from "./src/lib/projection-model/nascar-sources";
  export * from "./src/lib/projection-model/nascar-scoring";
  export * from "./src/lib/projection-model/calculate";
  export * from "./src/lib/projection-model/fantasy";`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", outfile: join(dir, "cup.mjs") });
const { matchCupRace, reconcileCupHistory, cupGrid, scheduledCupLaps, calculatePlayers,
  scoringRule, scoreOutcome, DK_CUP_FINISH, FD_CUP_FINISH, DK_CUP_RULE_SOURCE } = await import(pathToFileURL(join(dir, "cup.mjs")));
const settings = { recentGames: 3, recentWeight: 70, matchupWeight: 25 };
function fixture() {
  const event = { id: "202509010001", uid: "s:2000~l:2021~e:202509010001", date: "2025-09-01T18:00:00Z", name: "Cup test",
    season: { year: 2025, type: 2 }, status: { type: { completed: true } },
    competitions: [{ competitors: [
      { id: "es1", order: 1, athlete: { displayName: "John Hunter Nemechek" } },
      { id: "es2", order: 2, athlete: { displayName: "Daniel Suarez" } },
    ] }] };
  const race = { race_id: 123, race_season: 2025, series_id: 1, race_date: "2025-09-01T14:00:00",
    scheduled_laps: 100, actual_laps: 110, number_of_cars_in_field: 2, inspection_complete: true, winner_driver_id: 11 };
  const results = [
    { race_id: 123, race_season: 2025, series_id: 1, driver_id: 11, driver_fullname: "John H. Nemechek",
      finishing_position: 1, starting_position: 2, qualifying_position: 1, laps_completed: 110, laps_led: 90 },
    { race_id: 123, race_season: 2025, series_id: 1, driver_id: 12, driver_fullname: "Daniel Suárez",
      finishing_position: 2, starting_position: 1, qualifying_position: 2, laps_completed: 100, laps_led: 20 },
  ];
  const payload = { weekend_race: [{ ...race, results }], weekend_runs: [
    { run_type: 1, results: [{ best_lap_number: 5, best_lap_time: 22.1 }] },
  ] };
  return { event, race, results, payload };
}
test("Cup completion, exact final order and unique identities are mandatory; DNQs excluded", () => {
  const f = fixture();
  f.results.push({ finishing_position: 0, starting_position: 0, driver_id: 99, driver_fullname: "DNQ" });
  const game = reconcileCupHistory(f.event, f.race, f.payload);
  assert.equal(game.players.length, 2);
  assert.deepEqual(game.players[0].stats, { finish: 1, raceLaps: 110, start: 2, qualifyingStart: 1, lapsCompleted: 110, lapsLed: 90 });
  assert.equal(game.players[1].stats.lapsLed, 20);
  assert.ok(game.finalObservedAt && game.recordedAt);
});
test("prefilled laps, stale/live/qualifying results and mismatched date/series/order cannot train", () => {
  for (const mutate of [
    f => { f.event.status.type.completed = false; },
    f => { f.event.competitions[0].status = { type: { completed: false } }; },
    f => { f.payload.weekend_race[0].winner_driver_id = 0; },
    f => { f.payload.weekend_race[0].inspection_complete = false; },
    f => { f.payload.weekend_race[0].race_date = "2025-09-02T14:00:00"; },
    f => { f.payload.weekend_race[0].series_id = 2; },
    f => { f.event.uid = "s:2000~l:2022~e:123"; },
    f => { f.results[0].finishing_position = 2; f.results[1].finishing_position = 1; },
    f => { f.results[1].driver_fullname = f.results[0].driver_fullname; },
    f => { f.results[1].driver_id = f.results[0].driver_id; },
    f => { f.results[0].race_id = 124; },
    f => { f.payload.weekend_race[0].number_of_cars_in_field = 3; },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(reconcileCupHistory(f.event, f.race, f.payload), null);
  }
});
test("zero led counts require full lap reconciliation; absent fastest laps never become zero", () => {
  const f = fixture();
  f.results[0].laps_led = 110; f.results[1].laps_led = 0;
  assert.equal(reconcileCupHistory(f.event, f.race, f.payload).players[1].stats.lapsLed, 0);
  delete f.results[0].laps_led;
  f.results[1].fastest_laps = 30; // Uninspected fields and practice timing are not supported race inputs.
  const p = reconcileCupHistory(f.event, f.race, f.payload).players[1];
  assert.equal(p.stats.lapsLed, undefined); assert.equal(p.stats.fastestLaps, undefined);
  f.results[1].laps_completed = 120;
  assert.equal(reconcileCupHistory(f.event, f.race, f.payload).players[1].stats.lapsCompleted, undefined);
});
test("schedule matches unique Cup day/season; scheduled length never uses actual_laps", () => {
  const f = fixture();
  assert.equal(matchCupRace(f.event, { series_1: [f.race] }), f.race);
  assert.equal(matchCupRace(f.event, { series_1: [f.race, { ...f.race, race_id: 124 }] }), null);
  assert.equal(matchCupRace(f.event, { series_1: [{ ...f.race, series_id: 2 }] }), null);
  assert.equal(scheduledCupLaps(f.race), 100);
  assert.equal(scheduledCupLaps({ actual_laps: 300 }), null);
});
test("published grid uses race starting positions, not practice or qualifying finish order", () => {
  const f = fixture(), r = f.payload.weekend_race[0];
  assert.equal(cupGrid(r).get("johnhunternemechek"), 2);
  assert.equal(cupGrid(r, "qualifying_position").get("johnhunternemechek"), 1);
  f.results[0].starting_position = 0;
  assert.equal(cupGrid(r).size, 0);
});
const candidate = context => ({ id: "es1", name: "John Hunter Nemechek", position: "Driver", team: "Driver pool", teamId: "field",
  opponent: "Cup test", opponentId: "", availability: "Unverified", participation: "Entrant", raceContext: context,
  roleContext: { status: "entrant", eligible: true, note: "Published entrant" } });
const context = overrides => ({ scheduledLaps: 220, observedStart: null, observedQualifyingStart: null, fieldSize: 2, sourceUrl: null, ...overrides });
function forecast(overrides = {}, mutate = () => {}) {
  const games = [1, 2].map(n => {
    const f = fixture(); f.event.date = `2025-09-0${n}T18:00:00Z`; f.race.race_date = f.event.date;
    f.payload.weekend_race[0].race_date = f.event.date;
    const g = reconcileCupHistory(f.event, f.race, f.payload); g.id = `g${n}`; mutate(g);
    return g;
  });
  return calculatePlayers("nascar", [candidate(context(overrides))], games, settings, "2025-10-01T00:00:00Z", 2, "Unknown").players[0];
}
test("own lap rates scale to scheduled race length; grid forecasts are labeled, missing fastest stays partial", () => {
  const p = forecast();
  assert.equal(p.stats.find(s => s.id === "lapsCompleted").projected, 220);
  assert.equal(p.stats.find(s => s.id === "lapsLed").projected, 180);
  assert.match(p.stats.find(s => s.id === "start").matchupBasis, /forecast; not observed/);
  const fd = p.fantasy.find(f => f.site === "fanduel"), dk = p.fantasy.find(f => f.site === "draftkings");
  assert.equal(fd.status, "ready"); assert.equal(fd.mean, 83);
  assert.equal(fd.simulations, 2048);
  assert.equal(dk.status, "partial"); assert.equal(dk.mean, null); assert.equal(dk.p95, null);
  assert.deepEqual(dk.missingStats, ["fastestLaps"]);
  assert.ok(dk.trackedMean > 0);
  assert.deepEqual(forecast().fantasy, p.fantasy);
});
test("observed grids override sparse history and preserve FanDuel original qualifying versus adjusted start", () => {
  const p = forecast({ observedStart: 1, observedQualifyingStart: 2 });
  assert.equal(p.stats.find(s => s.id === "start").projected, 1);
  assert.equal(p.stats.find(s => s.id === "qualifyingStart").projected, 2);
  assert.match(p.stats.find(s => s.id === "start").matchupBasis, /Observed/);
  assert.equal(p.fantasy.find(f => f.site === "fanduel").mean, 83.5);
});
test("missing upcoming length or fewer than two lap exposures cannot publish full totals", () => {
  const p = forecast({ scheduledLaps: null });
  assert.equal(p.stats.find(s => s.id === "lapsCompleted").projected, null);
  assert.equal(p.fantasy.find(f => f.site === "fanduel").status, "partial");
  const sparse = forecast({}, g => { if (g.id === "g1") delete g.players[0].stats.raceLaps; });
  assert.equal(sparse.stats.find(s => s.id === "lapsLed").projected, null);
});
test("verified classic coefficients and nonlinear finish tables; unsupported sites remain unavailable", () => {
  const fd = scoringRule("nascar", "fanduel", false), dk = scoringRule("nascar", "draftkings", false);
  assert.equal(scoreOutcome(fd, { finish: 1, qualifyingStart: 30, lapsCompleted: 200, lapsLed: 20 }), 79.5);
  assert.equal(scoreOutcome(dk, { finish: 1, start: 30, fastestLaps: 10, lapsLed: 20 }), 85);
  for (let i = 1; i <= 40; i++) {
    assert.equal(scoreOutcome(fd, { finish: i, qualifyingStart: i, lapsCompleted: 0, lapsLed: 0 }), FD_CUP_FINISH[i - 1]);
    assert.equal(scoreOutcome(dk, { finish: i, start: i, fastestLaps: 0, lapsLed: 0 }), DK_CUP_FINISH[i - 1]);
  }
  assert.ok(Number.isNaN(scoreOutcome(fd, { finish: 41, qualifyingStart: 41, lapsCompleted: 0, lapsLed: 0 })));
  assert.equal(scoringRule("nascar", "yahoo", false), null);
});
test("live Daytona 500: real completed ESPN/official field matches and current Classic coefficients match source", { skip: process.env.NASCAR_LIVE !== "1" }, async () => {
  const fetchJson = async url => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    assert.ok(res.ok, `${url}: HTTP ${res.status}`); return res.json();
  };
  const [espn, schedule, weekend, rules] = await Promise.all([
    fetchJson("https://site.api.espn.com/apis/site/v2/sports/racing/nascar-premier/scoreboard?dates=20250216&limit=200"),
    fetchJson("https://cf.nascar.com/cacher/2025/race_list_basic.json"),
    fetchJson("https://cf.nascar.com/cacher/2025/1/5546/weekend-feed.json"),
    fetchJson(DK_CUP_RULE_SOURCE),
  ]);
  const event = espn.events.find(e => e.id === "202502160001");
  const race = matchCupRace(event, schedule), game = reconcileCupHistory(event, race, weekend);
  assert.ok(game); assert.equal(game.players.length, 41);
  const byron = game.players.find(p => p.name === "William Byron");
  assert.equal(byron.stats.finish, 1); assert.equal(byron.stats.start, 5);
  assert.equal(byron.stats.lapsCompleted, 201); assert.equal(byron.stats.fastestLaps, undefined);
  // The real feed reports 202 driver-led laps for a 201-lap race. Never "repair" those labels.
  assert.equal(weekend.weekend_race[0].results.filter(r => r.finishing_position > 0).reduce((sum, r) => sum + r.laps_led, 0), 202);
  assert.ok(game.players.every(p => p.stats.lapsLed === undefined));
  const [phoenixEspn, phoenixWeekend] = await Promise.all([
    fetchJson("https://site.api.espn.com/apis/site/v2/sports/racing/nascar-premier/scoreboard?dates=20250309&limit=200"),
    fetchJson("https://cf.nascar.com/cacher/2025/1/5549/weekend-feed.json"),
  ]);
  const phoenixEvent = phoenixEspn.events.find(e => e.id === "202503090023");
  const phoenix = reconcileCupHistory(phoenixEvent, matchCupRace(phoenixEvent, schedule), phoenixWeekend);
  assert.ok(phoenix);
  assert.equal(phoenix.players.length, 37);
  assert.equal(phoenix.players.reduce((sum, p) => sum + p.stats.lapsLed, 0), 312);
  assert.ok(phoenix.players.some(p => p.stats.lapsLed === 0));
  const classic = rules["10"].rules.find(r => r.name === "NASCAR Classic");
  const text = classic.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Fastest Laps \+0\.5 Pts/);
  assert.match(text, /Laps Led \+0\.25 Pts/);
  assert.match(text, /1 st \+46 Pts/);
  process.stdout.write(`Verified live Cup races: Daytona (${game.players.length} drivers, inconsistent led counts withheld) and Phoenix (${phoenix.players.length} drivers, 312 reconciled led laps); fastest laps absent; Classic rules checked.\n`);
});
test.after(() => rm(dir, { recursive: true, force: true }));
