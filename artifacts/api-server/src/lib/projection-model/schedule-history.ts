import { list, obj, str, numeric } from "./normalize";

/** Only verified completed appearances in the requested season phase before cutoff. */
export function completedScheduleIds(payload: unknown, cutoff: string, phase: number, limit = 10): string[] {
  return list(obj(payload).events).map(obj).filter(event => {
    const competition = obj(list(event.competitions)[0]);
    const completed = obj(obj(competition.status ?? event.status).type).completed === true;
    const eventPhase = numeric(obj(event.seasonType).type ?? obj(event.season).type);
    return completed && eventPhase === phase && /^\d+$/.test(str(event.id)) &&
      Number.isFinite(Date.parse(str(event.date))) && Date.parse(str(event.date)) < Date.parse(cutoff);
  }).sort((a, b) => Date.parse(str(b.date)) - Date.parse(str(a.date)))
    .slice(0, limit).map(event => str(event.id));
}
