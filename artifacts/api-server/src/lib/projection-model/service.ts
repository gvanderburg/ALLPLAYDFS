import type { ModelProjectionSheet } from "@workspace/api-zod";
import { METRICS } from "./metrics";
import { calculatePlayers } from "./calculate";
import { loadHistory, resolveModelSlate, slateCandidates } from "./provider";
import type { ModelSettings, ModelSport } from "./types";
import { list, obj, str } from "./normalize";

interface Job { expiresAt: number; sheet: ModelProjectionSheet; }
const jobs = new Map<string, Job>();
const historyLoads = new Map<string, {
  expiresAt: number;
  promise: ReturnType<typeof loadHistory>;
  listeners: Set<(done: number, total: number, failed: number) => void>;
  progress: [number, number, number];
}>();
let activeJobs = 0;
const pendingJobs: Array<() => void> = [];
const jobKey = (sport: ModelSport, date: string, s: ModelSettings) =>
  `${sport}:${date}:${s.recentGames}:${s.recentWeight}:${s.matchupWeight}`;

export function emptyModelSheet(
  sport: ModelSport, date: string, settings: ModelSettings, status: ModelProjectionSheet["status"],
): ModelProjectionSheet {
  return {
    status, sport, requestedDate: new Date(`${date}T00:00:00Z`), slateDate: new Date(`${date}T00:00:00Z`), generatedAt: new Date(), effectiveAsOf: null,
    ...settings, gameCount: 0, processedGames: 0, totalGames: 0, failedGames: 0, observedTeams: 0,
    players: [], metrics: METRICS[sport].map(({ id, label, unit, group, higherIsBetter }) => ({ id, label, unit, group, higherIsBetter })),
    modelFormula: sport === "nascar" ?
      "Blend recency-weighted finishes with up to 10 prior-race finishes, then shrink an exact published-venue adjustment toward neutral. No team-defense or fantasy-point scoring is used." :
      "Blend recency-weighted form with up to 10 prior appearances. Where available, predict workload × per-opportunity rate, then apply a sample-shrunk opponent stat adjustment capped at ±20%.",
    notes: status === "locked" ? ["Player stats, histories and model estimates require verified membership or owner access."] :
      ["ALLPLAY's independent statistical baseline—not a provider forecast and not an accuracy-tested machine-learning model."],
  };
}

function sharedHistory(
  sport: ModelSport, cutoff: string, progress: (done: number, total: number, failed: number) => void,
  context: { teams: string[]; phase: number; season: number },
) {
  const key = `${sport}:${cutoff}:${context.phase}:${context.season}:${[...context.teams].sort().join(",")}`;
  let entry = historyLoads.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    const listeners = new Set<typeof progress>();
    const created = {
      expiresAt: Date.now() + 30 * 60_000, listeners, progress: [0, 0, 0] as [number, number, number],
      promise: Promise.resolve({ games: [], failed: 0, truncated: false }) as ReturnType<typeof loadHistory>,
    };
    historyLoads.set(key, created);
    created.promise = loadHistory(sport, cutoff, (done, total, failed) => {
      created.progress = [done, total, failed];
      for (const callback of listeners) callback(done, total, failed);
    }, context).catch(error => { historyLoads.delete(key); throw error; });
    entry = created;
  }
  entry.listeners.add(progress);
  progress(...entry.progress);
  return entry.promise.finally(() => entry?.listeners.delete(progress));
}

async function build(job: Job, sport: ModelSport, date: string, settings: ModelSettings) {
  if (activeJobs >= 2) await new Promise<void>(resolve => pendingJobs.push(resolve));
  else activeJobs++;
  try {
    const slate = await resolveModelSlate(sport, date);
    job.sheet.slateDate = new Date(`${slate.date}T00:00:00Z`);
    job.sheet.gameCount = slate.events.length;
    if (!slate.events.length) {
      job.sheet.status = "unavailable";
      job.sheet.notes.push("No published slate was found for this date or the provider's next available calendar. No matchups are invented.");
      job.expiresAt = Date.now() + 5 * 60_000;
      return;
    }
    if (!slate.phase) {
      job.sheet.status = "unavailable";
      job.sheet.notes.push("The slate's season phase is unpublished. Historical samples cannot be safely separated from preseason/playoff data, so no estimates are substituted.");
      job.expiresAt = Date.now() + 5 * 60_000;
      return;
    }
    const day = Math.min(Date.parse(`${slate.date}T00:00:00Z`), Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`));
    const cutoff = new Date(day).toISOString();
    job.sheet.effectiveAsOf = new Date(cutoff);
    const history = await sharedHistory(sport, cutoff, (done, total, failed) => {
      job.sheet.processedGames = done;
      job.sheet.totalGames = total;
      job.sheet.failedGames = failed;
    }, {
      teams: [...new Set(slate.events.flatMap(event => list(obj(list(event.competitions)[0]).competitors)
        .map(c => str(obj(c).id || obj(obj(c).team).id)).filter(Boolean)))],
      phase: slate.phase, season: Number(obj(slate.events[0]?.season).year),
    });
    const eligible = history.games.filter(game => game.phase === slate.phase);
    const candidates = await slateCandidates(sport, slate, eligible);
    const calculated = calculatePlayers(sport, candidates.players, eligible, settings, cutoff, slate.phase, slate.venue);
    job.sheet.players = calculated.players;
    job.sheet.observedTeams = calculated.observedTeams;
    job.sheet.status = calculated.players.some(player => player.stats.some(stat => stat.projected !== null)) ? "ready" : "unavailable";
    job.sheet.generatedAt = new Date();
    job.sheet.notes.push(
      ...candidates.notes,
      `Recent form uses the last ${settings.recentGames} published appearances with weights 0.8^age; its blend weight is ${settings.recentWeight}%. Baseline is up to 10 earlier appearances, not a full-season average.`,
      `Matchup influence is ${settings.matchupWeight}%, shrunk by opponent games/5 and observed teams/8 (each capped at 1). Adjustment never exceeds ±20%.`,
      "Only completed games before the displayed UTC cutoff are used. Requested-day games, live games and future results are excluded; preseason and regular-season data are not mixed.",
      "Historical samples count published box-score appearances, not scheduled games. DNPs and unpublished categories are not filled with zero; observed zero stats remain valid zeros.",
      "Opponent ranks are calculated from observed stat totals per game, lowest to highest, among covered teams with at least two games. They are not official overall or position-specific league power rankings.",
      "Goalie and pitcher matchups use opponent attacking production. NBA/WNBA minutes, NHL ice time and MLB innings/at-bats determine opportunity where available. Saves are reconciled to shots faced minus goals allowed; catches/completions/hits cannot exceed their opportunity estimates.",
      "These are conditional-on-playing estimates. Injuries, trades, confirmed lineups, starting roles, pace and coaching changes are not learned automatically. Check availability before using any estimate.",
      "ALLPLAY forecasts raw stats from ESPN completed box scores. Published site scoring rules convert those own forecasts to fantasy points; provider fantasy forecasts and ownership predictions are never copied.",
      "Upcoming teams' latest ten completed same-phase appearances are prioritized, including the preceding season if needed. Older records can reflect changed roles; recent-form weights use appearance order, not calendar age.",
      "Fantasy outcome ranges use 2,048 deterministic count simulations from ALLPLAY means and sample-shrunk historical variance. Supported scoring is available where all required inputs have at least two appearances. Missing scoring inputs leave full totals/ranges blank; known-stat subtotals are not full projections.",
      "Model team/game totals use covered teams' historical scoring production and a sample-shrunk opponent allowance adjustment. They are independent model estimates, not market lines. Totals are unavailable outside NHL/NBA/WNBA or with fewer than two team appearances.",
      "Hockey PP/SH points and shot attempts require play logs that reconcile to box scores. Football zero category counts require reconciled team category totals; rare scores require a complete play log and matched final score. Missing input is not zero.",
      "Supplemental baseball scoring inputs use official MLB final-game box scores only after game date, full team names, final scores and unique normalized player names match the ESPN history. Failed/ambiguous matches remain missing.",
      "Actual contest ownership and EV/PP assignments are not provided. Research shortlists can calculate explicitly uncalibrated classic-slate ownership heuristics when supported same-slate salary coverage permits; they do not optimize a valid lineup.",
      "Fractional stat counts are expected values, not guaranteed game lines or calibrated probabilities. Projected minutes, ice time and innings use decimal units; historical baseball innings are converted from outs notation.",
    );
    if (sport === "nascar") job.sheet.notes.push(
      "Venue history uses the exact published race label, not an inferred track type. Adjustment is disabled for ambiguous Charlotte, Indianapolis and Bristol configurations. Venue average/sample counts occupy the matchup-input fields; there is no opposing-team rank.",
    );
    if (slate.phase === 1) job.sheet.notes.push("This is a preseason slate: only preseason appearances are used. Small samples and changing rotations reduce usefulness.");
    if (slate.date < new Date().toISOString().slice(0, 10)) job.sheet.notes.push("Past-date previews use historical results before the cutoff but current roster membership. They are not historical-roster backtests and must not be used to claim predictive accuracy.");
    if (history.failed) job.sheet.notes.push(`${history.failed} historical events could not supply a usable completed box score; coverage and ranks are partial.`);
    if (history.scheduleFailures) job.sheet.notes.push(`${history.scheduleFailures} supplemental team-schedule lookups failed. Available recent-window records were retained; prior-season coverage may be incomplete.`);
    if (history.truncated) job.sheet.notes.push("The history provider exceeded the bounded event limit; the observed sample is incomplete.");
    if (Date.parse(slate.date) > Date.now() + 14 * 86400000) job.sheet.notes.push("This slate is more than two weeks ahead. Current rosters and roles may change; refresh near the event.");
    if (job.sheet.status === "unavailable") job.sheet.notes.push("No player has two usable recorded appearances for the matched season phase. The sheet remains unfilled rather than copying a provider forecast.");
    job.expiresAt = Date.now() + 30 * 60_000;
  } catch {
    job.sheet.status = "error";
    job.sheet.players = [];
    job.sheet.notes.push("Could not build the historical model from its data source or cache. No fallback predictions were substituted. Retry after one minute.");
    job.expiresAt = Date.now() + 60_000;
  } finally {
    const waiting = pendingJobs.shift();
    if (waiting) waiting();
    else activeJobs--;
  }
}

export function getOrStartModel(sport: ModelSport, date: string, settings: ModelSettings): ModelProjectionSheet {
  for (const [key, job] of jobs) if (job.expiresAt < Date.now() && job.sheet.status !== "warming") jobs.delete(key);
  for (const [key, entry] of historyLoads) if (entry.expiresAt < Date.now()) historyLoads.delete(key);
  const key = jobKey(sport, date, settings);
  let job = jobs.get(key);
  if (!job) {
    if ([...jobs.values()].filter(item => item.sheet.status === "warming").length >= 8) {
      const busy = emptyModelSheet(sport, date, settings, "error");
      busy.notes.push("The bounded model queue is busy. Wait for an existing sheet to finish, then refresh.");
      return busy;
    }
    if (jobs.size >= 64) {
      const old = [...jobs].find(([, item]) => item.sheet.status !== "warming");
      if (old) jobs.delete(old[0]);
    }
    job = { expiresAt: Date.now() + 10 * 60_000, sheet: emptyModelSheet(sport, date, settings, "warming") };
    jobs.set(key, job);
    void build(job, sport, date, settings);
  }
  return job.sheet;
}
