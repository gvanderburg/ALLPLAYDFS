import type { HistoricalGame } from "./types";
import { obj, str, type Json } from "./normalize";

export function unstartedModelEvents(events: Json[], now = Date.now()): Json[] {
  return events.filter(event => {
    const type = obj(obj(event.status).type);
    return type.state === "pre" && type.completed !== true && Date.parse(str(event.date)) > now;
  });
}

/** Upcoming forecasts use today's available finals, not an artificial midnight freeze. */
export function forecastHistoryCutoff(slateDate: string, now = new Date()): string {
  return slateDate < now.toISOString().slice(0, 10) ? `${slateDate}T00:00:00.000Z` : now.toISOString();
}

/** A final must actually have been observed by this forward forecast's data snapshot. */
export function verifiedFinalsAsOf(games: HistoricalGame[], asOf: string): HistoricalGame[] {
  const cutoff = Date.parse(asOf);
  return games.filter(game => {
    const start = Date.parse(game.date), observed = Date.parse(game.finalObservedAt ?? "");
    return Number.isFinite(start) && Number.isFinite(observed) && start <= observed && start < cutoff && observed <= cutoff;
  });
}
