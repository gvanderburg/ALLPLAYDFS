type Json = Record<string, unknown>;
const obj = (v: unknown): Json => v && typeof v === "object" ? v as Json : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export function scheduleDay(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return dayFormatter.format(new Date(value));
}
function nextEventDay(payload: unknown, after: string) {
  return list(obj(payload).events).map(e => scheduleDay(obj(e).date))
    .filter((day): day is string => day !== null && day > after).sort()[0] ?? null;
}

/** Use published calendars, not guessed future games. Football needs week queries:
 * ESPN rejects date-range scoreboard queries for NFL/CFB. */
export async function findNextSlate(
  base: string, after: string, initial: unknown,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<{ date: string; scoreboard: unknown } | null> {
  async function search(payload: unknown) {
    const league = obj(list(obj(payload).leagues)[0]);
    const calendar = list(league.calendar);
    const year = Number(obj(league.season).year) || Number(after.slice(0, 4));
    const days = [...new Set(calendar.map(value =>
      typeof value === "string" ? scheduleDay(value) :
        obj(value).event ? scheduleDay(obj(value).startDate) : null)
      .filter((d): d is string => d !== null && d > after))].sort();
    // Daily calendars can contain conditional playoff dates without actual games.
    for (let i = 0; i < Math.min(days.length, 16); i += 4) {
      const results = await Promise.all(days.slice(i, Math.min(i + 4, 16)).map(async date => ({
        date, scoreboard: await fetchJson(`${base}/scoreboard?dates=${date.replaceAll("-", "")}&limit=200`),
      })));
      const match = results.find(r => nextEventDay(r.scoreboard, after) !== null);
      if (match) return match;
    }
    if (!days.length && calendar.some(v => typeof v === "object")) {
      const periods = calendar.flatMap(groupValue => {
        const group = obj(groupValue);
        return list(group.entries).map(entryValue => ({
          entry: obj(entryValue), seasonType: group.value,
        }));
      }).filter(p => (scheduleDay(p.entry.endDate) ?? "") >= after)
        .sort((a, b) => String(a.entry.startDate).localeCompare(String(b.entry.startDate)));
      for (const period of periods.slice(0, 8)) {
        const result = await fetchJson(`${base}/scoreboard?dates=${year}&seasontype=${encodeURIComponent(String(period.seasonType))}&week=${encodeURIComponent(String(period.entry.value))}&limit=200`);
        const date = nextEventDay(result, after);
        if (date) return {
          date, scoreboard: await fetchJson(`${base}/scoreboard?dates=${date.replaceAll("-", "")}&limit=200`),
        };
      }
    }
    return null;
  }
  const found = await search(initial);
  if (found) return found;
  const league = obj(list(obj(initial).leagues)[0]);
  const nextYear = (Number(obj(league.season).year) || Number(after.slice(0, 4))) + 1;
  // The next season is only usable if the provider has actually published it.
  return search(await fetchJson(`${base}/scoreboard?dates=${nextYear}&limit=200`));
}
