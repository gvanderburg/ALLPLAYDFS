import { eq } from "drizzle-orm";
import { db, nascarQualifyingGrids } from "@workspace/db";
import { logger } from "../logger";
import { cupGrid, nascarName, weekendRace } from "./nascar-sources";
import { cupSchedule, fetchSportsJson } from "./provider";
import { list, obj, str } from "./normalize";

const NASCAR_FEED = "https://cf.nascar.com/cacher";
const QUIET_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RACE_WEEK_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 15 * 60 * 1000;
const LOOKAHEAD_DAYS = 8;
let scheduledCheck: ReturnType<typeof setTimeout> | undefined;
let checking = false;

function dayDistance(from: string, to: string) {
  return (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
}

function makeOrder(race: Record<string, unknown>, positions: Map<string, number>) {
  return list(race["results"]).flatMap(value => {
    const row = obj(value);
    const driverName = str(row["driver_fullname"]);
    const driverId = str(row["driver_id"]);
    const position = positions.get(nascarName(driverName));
    return driverName && driverId && position !== undefined ? [{ driverId, driverName, position }] : [];
  }).sort((a, b) => a.position - b.position);
}

async function inspectUpcomingRace(): Promise<number> {
  const now = new Date();
  const season = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);
  const schedule = await cupSchedule(season);
  const upcoming = list(obj(schedule)["series_1"]).map(obj)
    .filter(race => {
      const raceDay = str(race["race_date"]).slice(0, 10);
      const qualifyingDay = (str(race["qualifying_date"]) || raceDay).slice(0, 10);
      return race["series_id"] === 1 && race["race_season"] === season
        && /^\d{4}-\d{2}-\d{2}$/.test(raceDay)
        && /^\d{4}-\d{2}-\d{2}$/.test(qualifyingDay)
        && dayDistance(today, raceDay) >= 0
        && dayDistance(today, raceDay) <= LOOKAHEAD_DAYS;
    })
    .sort((a, b) => {
      const sortDay = (race: Record<string, unknown>) => {
        const raceDay = str(race["race_date"]).slice(0, 10);
        const qualifyingDay = str(race["qualifying_date"]).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(qualifyingDay)
          && qualifyingDay >= today
          && qualifyingDay <= raceDay
          && !qualifyingDay.startsWith("1900")
          ? qualifyingDay : raceDay;
      };
      return sortDay(a).localeCompare(sortDay(b));
    });

  const race = upcoming[0];
  if (!race) return QUIET_INTERVAL_MS;
  const raceDate = str(race["race_date"]).slice(0, 10);
  if (upcoming.filter(item => str(item["race_date"]).slice(0, 10) === raceDate).length !== 1) {
    logger.warn({ season, raceDate }, "NASCAR qualifying poll skipped: Cup schedule date is ambiguous");
    return RACE_WEEK_INTERVAL_MS;
  }
  const raceId = Number(race["race_id"]);
  if (!Number.isInteger(raceId) || raceId <= 0) {
    logger.warn({ season, raceDate }, "NASCAR qualifying poll skipped: official race identifiers are incomplete");
    return RACE_WEEK_INTERVAL_MS;
  }

  const sourceUrl = `${NASCAR_FEED}/${season}/1/${raceId}/weekend-feed.json`;
  const payload = await fetchSportsJson(sourceUrl);
  const weekend = weekendRace(race, payload);
  if (!weekend) {
    logger.debug({ season, raceId }, "Official NASCAR weekend feed is not available yet");
    return RACE_WEEK_INTERVAL_MS;
  }

  const qualifying = cupGrid(weekend, "qualifying_position");
  const fieldSize = Number(weekend["number_of_cars_in_field"]);
  const id = `${season}:${raceId}`;
  if (!qualifying.size || qualifying.size !== fieldSize) {
    const [existing] = await db.select({ id: nascarQualifyingGrids.id }).from(nascarQualifyingGrids)
      .where(eq(nascarQualifyingGrids.id, id)).limit(1);
    if (existing) await db.update(nascarQualifyingGrids).set({ checkedAt: now })
      .where(eq(nascarQualifyingGrids.id, existing.id));
    logger.debug({ season, raceId }, "NASCAR qualifying feed has no complete validated grid yet");
    return RACE_WEEK_INTERVAL_MS;
  }

  const starting = cupGrid(weekend, "starting_position");
  const qualifyingOrder = makeOrder(weekend, qualifying);
  const startingOrder = makeOrder(weekend, starting);
  const [previous] = await db.select().from(nascarQualifyingGrids)
    .where(eq(nascarQualifyingGrids.id, id)).limit(1);
  const orderChanged = !previous
    || JSON.stringify(previous.qualifyingOrder) !== JSON.stringify(qualifyingOrder)
    || JSON.stringify(previous.startingOrder) !== JSON.stringify(startingOrder);

  await db.insert(nascarQualifyingGrids).values({
    id, season, raceId, raceDate, fieldSize,
    qualifyingOrder, startingOrder, sourceUrl,
    capturedAt: orderChanged ? now : previous.capturedAt, checkedAt: now,
  }).onConflictDoUpdate({
    target: nascarQualifyingGrids.id,
    set: {
      raceDate, fieldSize, qualifyingOrder, startingOrder, sourceUrl,
      capturedAt: orderChanged ? now : previous!.capturedAt, checkedAt: now,
    },
  });

  if (orderChanged) {
    logger.info({ season, raceId, raceDate, drivers: qualifying.size, hasOfficialStartingOrder: starting.size > 0, sourceUrl },
      previous ? "NASCAR official grid changed and was saved" : "NASCAR official qualifying grid captured");
  }
  return RACE_WEEK_INTERVAL_MS;
}

async function runCheck() {
  if (checking) return;
  checking = true;
  let nextDelay = RETRY_INTERVAL_MS;
  try {
    nextDelay = await inspectUpcomingRace();
  } catch (err) {
    logger.warn({ err }, "NASCAR qualifying background check failed; it will retry");
  } finally {
    checking = false;
    scheduledCheck = setTimeout(() => void runCheck(), nextDelay);
    scheduledCheck.unref?.();
  }
}

export function startNascarQualifyingMonitor() {
  if (scheduledCheck || checking) return;
  logger.info("NASCAR Cup qualifying monitor starting");
  void runCheck();
}
