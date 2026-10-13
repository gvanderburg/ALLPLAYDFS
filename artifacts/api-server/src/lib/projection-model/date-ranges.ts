/** ESPN racing date ranges work within calendar years, not across multiple years. */
export function annualHistoryRanges(start: Date, exclusiveEnd: Date): string[] {
  const last = new Date(exclusiveEnd.getTime() - 86_400_000);
  const result: string[] = [];
  const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
  for (let year = start.getUTCFullYear(); year <= last.getUTCFullYear(); year++) {
    const from = new Date(Math.max(start.getTime(), Date.UTC(year, 0, 1)));
    const to = new Date(Math.min(last.getTime(), Date.UTC(year, 11, 31)));
    if (from <= to) result.push(`${format(from)}-${format(to)}`);
  }
  return result;
}
