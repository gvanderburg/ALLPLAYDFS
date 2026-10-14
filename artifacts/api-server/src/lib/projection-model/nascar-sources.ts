import { list, numeric, obj, str, normalizeRace, type Json } from "./normalize";
import type { HistoricalGame } from "./types";

export const nascarName = (value: unknown) => {
  const key = str(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Explicit public full-name variant, not a fuzzy surname/initial join.
  return key === "johnhnemechek" ? "johnhunternemechek" : key;
};
const integer = (value: unknown, min = 0, max = Infinity): number | null => {
  const n = numeric(value);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const unique = (values: unknown[]) => values.every(Boolean) && new Set(values).size === values.length;
const permutation = (values: number[]) => unique(values) && values.every(v => Number.isInteger(v) && v >= 1 && v <= values.length);

/** Official race dates are local, without a zone; compare calendar days, not invented UTC instants. */
export function matchCupRace(event: Json, schedule: unknown): Json | null {
  const season = numeric(obj(event.season).year);
  const day = str(event.date).slice(0, 10);
  const matches = list(obj(schedule).series_1).map(obj).filter(r =>
    r.series_id === 1 && r.race_season === season && str(r.race_date).slice(0, 10) === day &&
    integer(r.race_id, 1) !== null);
  // Includes duels and other same-day sessions: ambiguous dates never join.
  return matches.length === 1 ? matches[0] : null;
}

export function weekendRace(schedule: Json, payload: unknown): Json | null {
  const matches = list(obj(payload).weekend_race).map(obj).filter(r =>
    r.race_id === schedule.race_id && r.series_id === 1 && r.race_season === schedule.race_season &&
    str(r.race_date).slice(0, 10) === str(schedule.race_date).slice(0, 10));
  return matches.length === 1 ? matches[0] : null;
}

/** A schedule's actual_laps is NOT completion evidence. Require ESPN final + inspected official results. */
export function reconcileCupHistory(event: unknown, schedule: Json, payload: unknown): HistoricalGame | null {
  const game = normalizeRace(event), race = weekendRace(schedule, payload);
  const uid = str(obj(event).uid);
  if (uid && !/^s:2000~l:2021~/.test(uid)) return null;
  if (!game || !race || race.inspection_complete !== true ||
    str(race.race_date).slice(0, 10) !== game.date.slice(0, 10) || race.race_season !== game.season) return null;
  // winner_driver_id exists on race_list_basic, not on the inspected weekend_race schema.
  const laps = integer(race.actual_laps, 1), winner = integer(schedule.winner_driver_id, 1);
  if (race.winner_driver_id !== undefined && integer(race.winner_driver_id, 1) !== winner) return null;
  const rows = list(race.results).map(obj).filter(r => (numeric(r.finishing_position) ?? 0) > 0);
  if (laps === null || winner === null || rows.length !== game.players.length ||
    integer(race.number_of_cars_in_field, 1) !== rows.length ||
    !permutation(rows.map(r => numeric(r.finishing_position) ?? 0)) ||
    !permutation(game.players.map(p => p.stats.finish)) ||
    rows.some(r => integer(r.driver_id, 1) === null) ||
    !unique(rows.map(r => str(r.driver_id))) || !unique(rows.map(r => nascarName(r.driver_fullname))) ||
    !unique(game.players.map(p => p.id)) || !unique(game.players.map(p => nascarName(p.name)))) return null;
  const first = rows.find(r => r.finishing_position === 1);
  if (first?.driver_id !== winner) return null;
  const matched = game.players.map(p => rows.find(r => nascarName(r.driver_fullname) === nascarName(p.name)));
  if (matched.some((r, i) => !r || r.finishing_position !== game.players[i].stats.finish ||
    r.series_id !== 1 || r.race_id !== race.race_id || r.race_season !== game.season)) return null;
  const starts = matched.map(r => integer(r!.starting_position, 1, rows.length));
  const validStarts = starts.every(n => n !== null) && permutation(starts as number[]);
  const qualifying = matched.map(r => integer(r!.qualifying_position, 1, rows.length));
  const validQualifying = qualifying.every(n => n !== null) && permutation(qualifying as number[]);
  const led = matched.map(r => integer(r!.laps_led, 0, laps));
  // All led counts must reconcile to the race length before an observed zero is accepted.
  const validLed = led.every(n => n !== null) && led.reduce<number>((sum, n) => sum + (n ?? 0), 0) === laps;
  for (let i = 0; i < game.players.length; i++) {
    const stats = game.players[i].stats, row = matched[i]!;
    stats.raceLaps = laps;
    if (validStarts) stats.start = starts[i]!;
    if (validQualifying) stats.qualifyingStart = qualifying[i]!;
    const completed = integer(row.laps_completed, 0, laps);
    if (completed !== null) stats.lapsCompleted = completed;
    if (validLed && completed !== null && led[i]! <= completed) stats.lapsLed = led[i]!;
    // No fastest_laps count exists in the inspected weekend schema.
    // best_lap_time / best_lap_number from practice are NOT fastest laps run in a race.
  }
  game.recordedAt = new Date().toISOString();
  return game;
}

export interface RaceContext {
  scheduledLaps: number | null;
  fieldSize: number;
  observedStart: number | null;
  observedQualifyingStart: number | null;
  sourceUrl: string | null;
}
export function cupGrid(race: Json, key: "starting_position" | "qualifying_position" = "starting_position"): Map<string, number> {
  const rows = list(race.results).map(obj).filter(r => (numeric(r.starting_position) ?? 0) > 0);
  if (!rows.length || integer(race.number_of_cars_in_field, 1) !== rows.length ||
    !permutation(rows.map(r => numeric(r[key]) ?? 0)) ||
    !unique(rows.map(r => nascarName(r.driver_fullname))) || !unique(rows.map(r => str(r.driver_id))) ||
    rows.some(r => r.race_id !== race.race_id || r.series_id !== 1 || r.race_season !== race.race_season)) return new Map();
  return new Map(rows.map(r => [nascarName(r.driver_fullname), Number(r[key])]));
}

export function scheduledCupLaps(race: Json): number | null {
  return integer(race.scheduled_laps, 1);
}
