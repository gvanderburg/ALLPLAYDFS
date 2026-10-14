import { PreviewMatchupReportBody, type MatchupReport, type MatchupRankRow } from "@workspace/api-zod";
import { nflTeamKey } from "./nfl-teams";

/** Only normalized records are persisted, never the original CSV/JSON bytes. */
function csvRows(content: string): unknown[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      row.push(field);
      if (row.some(v => v.trim())) rows.push(row);
      row = []; field = "";
      if (c === "\r" && content[i + 1] === "\n") i++;
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  row.push(field);
  if (row.some(v => v.trim())) rows.push(row);
  const headers = rows.shift()?.map(v => v.trim().toLowerCase()) ?? [];
  if (headers.length !== 3 || new Set(headers).size !== 3 || !["team", "position", "rank"].every(v => headers.includes(v)))
    throw new Error("CSV requires exactly team,position,rank headers.");
  return rows.map(values => {
    if (values.length !== 3) throw new Error("CSV row has an incorrect column count.");
    return Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]));
  });
}

export function validateReport(input: unknown, now = new Date()): Pick<MatchupReport, "metadata" | "rows" | "coverage" | "fullCoverage"> {
  const parsed = PreviewMatchupReportBody.safeParse(input);
  if (!parsed.success) throw new Error("Provide all report metadata, a CSV/JSON file under 200 KB, and access confirmation.");
  const { metadata: m, content, format, authorized } = parsed.data;
  if (!authorized) throw new Error("Confirm permitted access and use in ALLPLAY before importing.");
  const published = new Date(m.publishedAt), asOf = new Date(m.asOf);
  const positions = [...new Set(m.positions)];
  if (m.startWeek > m.endWeek || positions.length !== m.positions.length ||
      m.season > now.getUTCFullYear() + 1 || !Number.isFinite(published.getTime()) || !Number.isFinite(asOf.getTime()) ||
      published > now || asOf > published || asOf.getUTCFullYear() < m.season - 1 ||
      asOf.getUTCFullYear() > m.season + 1)
    throw new Error("Invalid period/date: as-of must not follow publication; publication cannot be in the future. Positions must be unique.");
  if (m.publisher === "pff" ? m.rankOneMeans !== "strongest" || positions.length !== 1 || positions[0] !== "secondary"
    : m.rankOneMeans !== "most-allowed" || positions.includes("secondary"))
    throw new Error("PFF requires secondary strength (#1 strongest); FantasyPros requires positional allowance (#1 most allowed).");
  let url: URL;
  try { url = new URL(m.sourceUrl); } catch { throw new Error("Provide the publisher's HTTPS source URL."); }
  const host = m.publisher === "pff" ? "pff.com" : "fantasypros.com";
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === host || url.hostname.endsWith(`.${host}`)))
    throw new Error("Source URL must belong to the selected publisher and use HTTPS without credentials.");
  if (Buffer.byteLength(content, "utf8") > 200000) throw new Error("Report exceeds 200 KB.");
  let raw: unknown;
  try { raw = format === "json" ? JSON.parse(content.replace(/^\uFEFF/, "")) : csvRows(content.replace(/^\uFEFF/, "")); }
  catch (err) { throw new Error(err instanceof Error ? err.message : "Invalid file."); }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 32 * positions.length)
    throw new Error("Use a nonempty JSON array or CSV with no more than 32 teams per position.");
  const rows: MatchupRankRow[] = [], keys = new Set<string>(), ranks = new Set<string>();
  const coverage: Record<string, number> = Object.fromEntries(positions.map(p => [p, 0]));
  for (const value of raw) {
    if (!value || typeof value !== "object") throw new Error("Each ranking row must be an object.");
    const team = typeof value.team === "string" ? nflTeamKey(value.team) : undefined;
    const position = typeof value.position === "string" ? value.position.trim() : "";
    const rank = typeof value.rank === "number" ? value.rank
      : typeof value.rank === "string" && /^\d{1,2}$/.test(value.rank) ? Number(value.rank) : NaN;
    if (!team || !positions.includes(position as typeof positions[number]) || !Number.isInteger(rank) || rank < 1 || rank > 32)
      throw new Error("Every row needs a known NFL team, declared position, and integer rank 1–32.");
    if (keys.has(`${position}:${team}`) || ranks.has(`${position}:${rank}`))
      throw new Error("Duplicate team/position or duplicate rank within a position. Tied ranks are not supported.");
    keys.add(`${position}:${team}`); ranks.add(`${position}:${rank}`);
    rows.push({ team, position, rank }); coverage[position]++;
  }
  return { metadata: { ...m, publishedAt: published, asOf, sourceUrl: url.href },
    rows, coverage, fullCoverage: positions.every(p => coverage[p] === 32) };
}
