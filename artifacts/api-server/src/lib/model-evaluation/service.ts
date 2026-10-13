import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, modelEvaluations, modelSnapshots, evaluationImports } from "@workspace/db";
import type { EvaluationStartInput, ModelPlayerProjection } from "@workspace/api-zod";
import { fetchSportsJson, loadCompletedEvent, loadHistory } from "../projection-model/provider";
import { obj, list, str, normalizeRace } from "../projection-model/normalize";
import { MODEL_SPORTS, HISTORY_VERSION, type HistoricalGame, type ModelSettings, type SlatePlayer } from "../projection-model/types";
import { RULES_AS_OF, scoringRule } from "../projection-model/fantasy";
import { logger } from "../logger";
import type { PoolRow, OwnershipRow } from "./csv";
import { EVALUATION_VERSION, evaluateSlate, pregameHistory, reconstructPool, calibrationGroups, researchSummaries, scoringPolicy, ownershipSummary, type EvaluationRow } from "./evaluate";

export interface EvaluationReport {
  settings: ModelSettings; modelVersion: string; historyVersion: number; rulesAsOf: string; scoringPolicy: string;
  notes: string[]; rows: EvaluationRow[]; groups: ReturnType<typeof calibrationGroups>;
  research: ReturnType<typeof researchSummaries>; ownership: Array<ReturnType<typeof ownershipSummary> & { importId: string; contestId: string; source: string; hash: string }>;
  slates: Array<{
    date: string; asOf: string; poolSource: string; poolAsOf?: string; poolImportId?: string; snapshotId?: string; contestId?: string;
    selectionBias: boolean; historyGames: number; failedGames: number; truncated: boolean; excluded: number;
    notes: string[]; source: string; historyDigest?: string; history?: HistoricalGame[]; poolProvenance?: unknown; lastVerifiedEnd?: string;
    scoringRules?: unknown;
  }>; progress: number; error?: string;
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateReplayDates(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!validDate(from) || !validDate(to) || from < "2020-01-01" || !Number.isInteger(days) || days < 0 || days > 6 ||
      to >= new Date().toISOString().slice(0, 10)) throw new Error("Choose 1–7 days from 2020 onward, strictly before today.");
}
let activeRun: string | null = null;
export async function startReplay(input: EvaluationStartInput) {
  validateReplayDates(input.fromDate, input.toDate);
  if (input.poolImportId) {
    const [pool] = await db.select().from(evaluationImports).where(eq(evaluationImports.id, input.poolImportId));
    if (!pool || pool.kind !== "pool" || pool.sport !== input.sport || pool.site !== input.site ||
        input.fromDate !== input.toDate || pool.slateDate !== input.fromDate) throw new Error("Choose a verified pool from the same sport, site and single slate day.");
  }
  if (activeRun) throw new Error("A replay is already running. Wait for it to finish.");
  const id = randomUUID();
  activeRun = id;
  const report: EvaluationReport = {
    settings: { recentGames: input.recentGames, recentWeight: input.recentWeight, matchupWeight: input.matchupWeight },
    modelVersion: EVALUATION_VERSION, historyVersion: HISTORY_VERSION, rulesAsOf: RULES_AS_OF, scoringPolicy,
    notes: [
      "Walk-forward historical holdout: settings frozen before each run; no tuning or fit to holdout outcomes. Repeated owner-selected runs are exploratory, not an untouched statistical holdout.",
      "Bias = forecast minus observed outcome. Percentile coverage = share of observed outcomes at/below that percentile; central p25–p75 interval nominal coverage is 50%.",
      "Only final results with a verified end-game wall clock before cutoff or a server-observed final result before cutoff enter history. A scheduled start before cutoff alone is insufficient. Missing completion evidence reduces samples.",
      "Retrospective box scores can include later official corrections; this is an as-of history reconstruction, not a claim that every corrected stat was known at the time. Saved pre-game snapshots preserve the source version actually captured.",
      "Pregame pools/availability come from a timestamped saved snapshot or an owner-verified historical classic-contest export. Otherwise prior-appearance pools have selection bias and omit new arrivals/returning players; current rosters and outcome participants never define a replay pool.",
      "DNP/absent appearances and incomplete/unsupported scoring are excluded, not assigned zero. Samples are conditional on recovered observations and can be biased.",
      "Research compares top-10 individual candidates, not salary-cap-valid lineups, payout, ROI or profitability. Rankings use the same outcome-blind math as the live shortlist.",
      "Ownership estimates stay uncalibrated. Only owner-verified actual contest export percentages can be ground truth; no imported provider forecast is used.",
      "Salary/ownership use the same site's verified classic-contest pool only. No cross-site salary substitution. Without historical salaries, research omits value/leverage and ownership remains unavailable.",
    ], rows: [], groups: [], research: [], ownership: [], slates: [], progress: 0,
  };
  try {
    const [run] = await db.insert(modelEvaluations).values({ id, sport: input.sport, site: input.site,
      fromDate: input.fromDate, toDate: input.toDate, status: "running", report }).returning();
    void buildReplay(id, input, report).catch(err => {
      logger.error({ err, evaluationId: id }, "Could not persist the terminal replay state");
    });
    return run;
  } catch (error) { activeRun = null; throw error; }
}
async function buildReplay(id: string, input: EvaluationStartInput, report: EvaluationReport) {
  try {
    for (let day = Date.parse(input.fromDate); day <= Date.parse(input.toDate); day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10), asOf = `${date}T00:00:00.000Z`;
      const source = `https://site.api.espn.com/apis/site/v2/sports/${MODEL_SPORTS[input.sport].path}/scoreboard?dates=${date.replaceAll("-", "")}&limit=200`;
      const slateAudit: EvaluationReport["slates"][number] = { date, asOf, source, poolSource: "none", selectionBias: true,
        historyGames: 0, failedGames: 0, truncated: false, excluded: 0, notes: [] };
      report.slates.push(slateAudit);
      const payload = obj(await fetchSportsJson(source)), rawEvents = list(payload.events).map(obj);
      if (!rawEvents.length || rawEvents.some(e => obj(obj(e.status).type).completed !== true)) {
        slateAudit.notes.push(rawEvents.length ? "Slate not fully completed; not replayed." : "No published slate on this exact day; dates never roll forward.");
      } else {
        const outcomes: HistoricalGame[] = [];
        let failed = 0;
        for (const raw of rawEvents) {
          try {
            const game = input.sport === "nascar" ? normalizeRace(raw) : await loadCompletedEvent(input.sport, str(raw.id));
            if (game && Date.parse(game.date) >= day && Date.parse(game.date) < Date.now()) outcomes.push(game);
            else failed++;
          } catch { failed++; }
        }
        slateAudit.failedGames = failed;
        if (failed) slateAudit.notes.push("Incomplete outcome coverage: failed/nonfinal records excluded.");
        if (outcomes.length) {
          const verifiedEnds = outcomes.flatMap(e => e.completedAt ? [e.completedAt] : []);
          if (verifiedEnds.length === outcomes.length) slateAudit.lastVerifiedEnd = verifiedEnds.sort().at(-1);
          const phases = [...new Set(outcomes.map(e => e.phase))].filter(p => p > 0);
          const histories = await Promise.all(phases.map(phase => loadHistory(input.sport, asOf, () => {}, {
            teams: [...new Set(outcomes.filter(e => e.phase === phase).flatMap(e => e.teams.map(t => t.id)))],
            phase, season: outcomes.find(e => e.phase === phase)!.season,
          })));
          let history = [...new Map(histories.flatMap(h => h.games).map(g => [g.id, g] as const)).values()];
          slateAudit.failedGames += histories.reduce((n, h) => n + h.failed + (h.scheduleFailures ?? 0), 0);
          slateAudit.truncated = histories.some(h => h.truncated);
          const firstStart = Math.min(...outcomes.map(e => Date.parse(e.date)));
          let pool: ReturnType<typeof reconstructPool>;
          if (input.poolImportId) {
            const [imported] = await db.select().from(evaluationImports).where(eq(evaluationImports.id, input.poolImportId));
            const data = imported.data as { records: PoolRow[] };
            pool = data.records.map(row => {
              const event = outcomes.find(e => e.id === row.eventId);
              const team = event?.teams.find(t => t.id === row.teamId);
              if (!event || !team) throw new Error("Historical pool contains an event/team not in the completed slate; use exact provider IDs.");
              const opponent = event.teams.find(t => t.id !== row.teamId);
              return { id: row.playerId, name: row.name, teamId: row.teamId, team: team.abbreviation, position: row.position,
                opponentId: opponent?.id ?? "", opponent: opponent?.abbreviation ?? event.venue,
                availability: row.availability, participation: "Owner-verified pregame pool; starting role not guaranteed",
                eventId: row.eventId, salary: row.salary };
            });
            slateAudit.poolSource = "Owner-verified historical classic-contest pool";
            slateAudit.poolImportId = imported.id; slateAudit.poolAsOf = imported.asOf;
            slateAudit.contestId = imported.contestId; slateAudit.selectionBias = false;
            slateAudit.poolProvenance = { source: imported.source, hash: imported.hash, asOf: imported.asOf, verifiedAt: imported.verifiedAt,
              rowCount: imported.rowCount, records: data.records, verification: "Owner attested; not independently provider authenticated" };
          } else {
            const [snapshot] = await db.select().from(modelSnapshots).where(and(eq(modelSnapshots.sport, input.sport),
              eq(modelSnapshots.slateDate, date), lt(modelSnapshots.asOf, new Date(firstStart)))).orderBy(desc(modelSnapshots.asOf)).limit(1);
            if (snapshot) {
              const data = snapshot.data as { players: ModelPlayerProjection[]; games: HistoricalGame[] };
              // History captured pregame is preferable to corrected/re-fetched box scores.
              history = data.games;
              pool = data.players.flatMap(p => {
                const events = outcomes.filter(e => e.teams.some(t => t.id === p.teamId));
                return events.map(e => ({ ...p, eventId: e.id, salary: null }));
              });
              slateAudit.poolSource = "Saved timestamped pre-game model roster/availability snapshot";
              slateAudit.snapshotId = snapshot.id; slateAudit.poolAsOf = snapshot.asOf.toISOString();
              // Current provider rosters at capture aren't confirmed contest eligibility.
              slateAudit.selectionBias = true;
              slateAudit.notes.push("Pregame roster recovered, but official historical contest pool/salaries/confirmed starters unavailable; eligibility selection bias remains.");
            } else {
              const eligibleHistory = phases.flatMap(phase => pregameHistory(history, asOf, phase));
              pool = reconstructPool(outcomes, eligibleHistory);
              slateAudit.poolSource = "Reconstructed prior-appearance pool (last two covered team games)";
            }
          }
          const eligibleHistory = [...new Map(phases.flatMap(phase => pregameHistory(history, asOf, phase)).map(g => [g.id, g] as const)).values()];
          slateAudit.historyGames = eligibleHistory.length;
          slateAudit.notes.push(`${history.length - eligibleHistory.length} source history records excluded for missing/late completion evidence or mismatched phase.`);
          slateAudit.history = eligibleHistory;
          slateAudit.historyDigest = createHash("sha256").update(JSON.stringify(eligibleHistory)).digest("hex");
          slateAudit.scoringRules = [...new Set(pool.map(p => p.position))].map(position => {
            const rule = scoringRule(input.sport, input.site, input.sport === "nhl" && position === "G", position);
            return { position, weights: rule?.weights ?? null, source: rule?.source ?? null,
              rulesAsOf: RULES_AS_OF, bonusPolicyVersion: EVALUATION_VERSION, thresholdBonuses: Boolean(rule?.bonus) };
          });
          const rows = evaluateSlate(input.sport, input.site, date, asOf, report.settings, outcomes, eligibleHistory, pool);
          // No verified contest pool means no same-contest ownership estimates.
          if (!slateAudit.contestId) for (const row of rows) row.estimatedOwnership = null;
          slateAudit.excluded = rows.filter(r => r.exclusion !== null).length;
          if (rows.some(r => r.forecast !== null && r.actual === null)) {
            slateAudit.selectionBias = true;
            slateAudit.notes.push("Observed-outcome selection bias: missing/DNP/incomplete outcomes excluded from error metrics.");
          }
          report.rows.push(...rows);
          report.research.push(...researchSummaries(rows, slateAudit.selectionBias));
          if (!pool.length) slateAudit.notes.push("No recoverable strictly pregame player pool; no forecast/outcome pairs invented.");
        }
      }
      report.progress++;
      report.groups = calibrationGroups(report.rows, input.sport, input.site);
      await db.update(modelEvaluations).set({ report }).where(eq(modelEvaluations.id, id));
    }
    await db.update(modelEvaluations).set({ status: "ready", report }).where(eq(modelEvaluations.id, id));
  } catch (err) {
    logger.error({ err, evaluationId: id }, "Historical evaluation failed");
    report.error = err instanceof Error ? err.message : "Historical source unavailable.";
    await db.update(modelEvaluations).set({ status: "error", report }).where(eq(modelEvaluations.id, id));
  } finally { activeRun = null; }
}
/** Called at API startup; interrupted jobs aren't silently shown as still running forever. */
export async function recoverInterruptedEvaluations() {
  const runs = await db.select().from(modelEvaluations).where(eq(modelEvaluations.status, "running"));
  for (const run of runs) await db.update(modelEvaluations).set({ status: "error",
    report: { ...run.report as EvaluationReport, error: "Replay interrupted by server restart; start a new run. Partial results retained for audit." },
  }).where(eq(modelEvaluations.id, run.id));
}
