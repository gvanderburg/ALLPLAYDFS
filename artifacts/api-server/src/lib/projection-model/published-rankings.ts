import type { ModelPlayerProjection, PublishedMatchupRanking } from "@workspace/api-zod";
import type { ModelSport } from "./types";

const teams: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
const aliases: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR", HST: "HOU", BLT: "BAL", NWE: "NE", SFO: "SF", TBB: "TB" };
const clean = (text: string) => text.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").trim();
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export function nflTeamKey(value: string) {
  const abbreviation = value.trim().toUpperCase();
  return aliases[abbreviation] ?? (teams[abbreviation] ? abbreviation
    : Object.keys(teams).find(key => nameKey(teams[key]) === nameKey(value)));
}
interface PublishedData {
  ranks: Record<string, Record<string, number>>;
  period: string;
  asOf: Date | null;
  coverage: number;
  note: string;
}
const unavailable = (note: string): PublishedData => ({ ranks: {}, period: "Unavailable", asOf: null, coverage: 0, note });

export function parsePffSecondary(html: string, season: number): PublishedData {
  const headline = clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const published = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  const asOf = published ? new Date(published) : null;
  if (!headline.includes(`${season} NFL secondary rankings`) || !asOf || !Number.isFinite(asOf.getTime()) || asOf.getUTCFullYear() !== season)
    return unavailable("PFF's published season/date could not be verified.");
  const ranks: PublishedData["ranks"] = {};
  for (const heading of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const match = clean(heading[1]).match(/^(\d{1,2})[.]\s*(.+)$/);
    if (!match) continue;
    const rank = Number(match[1]), team = nflTeamKey(match[2]);
    if (!team || rank < 1 || rank > 32 || ranks[team]) return unavailable("Ambiguous PFF team/rank; ratings were not substituted.");
    ranks[team] = { secondary: rank };
  }
  if (Object.keys(ranks).length !== 32 || new Set(Object.values(ranks).map(row => row.secondary)).size !== 32)
    return unavailable("PFF's complete 32-team secondary list could not be verified.");
  return { ranks, asOf, coverage: 32, period: `Preseason ${season} · ${asOf.toISOString().slice(0, 10)}`,
    note: "PFF's dated editorial secondary-strength ranking. #1 is strongest (hardest), not the easiest fantasy matchup. Not a weekly or individual cornerback assignment." };
}

export function parseFantasyProsPreview(html: string, season: number, retrievedAt = new Date()): PublishedData {
  // Parse only the public preview supplied to the logged-out page. Never request
  // gated rows, inject cookies, or substitute the publisher's forecasts.
  const match = html.match(/window\.FP\.reportConfig\s*=\s*(\{[\s\S]*?\});\s*window\.FP\.isLoggedIn/);
  if (!match) return unavailable("FantasyPros' public preview format was not recognized.");
  try {
    const config = JSON.parse(match[1]);
    const period = String(config.subtitle ?? "");
    const weeks = period.match(/Weeks\s+(\d+)\s*-\s*(\d+)\s+in\s+(\d{4})/i);
    if (config.type !== "points-allowed" || config.sport !== "NFL" || !weeks || Number(weeks[3]) !== season ||
      Number(weeks[1]) < 1 || Number(weeks[2]) < Number(weeks[1]) || Number(weeks[2]) > 22)
      return unavailable("FantasyPros' NFL season/report period could not be verified.");
    const rows = config.table?.rows;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 32) return unavailable("No valid public FantasyPros rows.");
    const ranks: PublishedData["ranks"] = {};
    for (const row of rows) {
      const team = nflTeamKey(String(row.team?.id ?? ""));
      if (!team || ranks[team]) return unavailable("Ambiguous FantasyPros team; preview rejected.");
      const record: Record<string, number> = {};
      for (const role of ["qb", "rb", "wr", "te", "k", "dst"]) {
        const rank = row[`${role}_rk`];
        if (typeof rank === "number" && Number.isInteger(rank) && rank >= 1 && rank <= 32) record[role.toUpperCase()] = rank;
      }
      ranks[team] = record;
    }
    for (const role of ["QB", "RB", "WR", "TE", "K", "DST"]) {
      const values = Object.values(ranks).flatMap(row => row[role] === undefined ? [] : [row[role]]);
      if (new Set(values).size !== values.length) return unavailable("Duplicate FantasyPros positional ranks; preview rejected.");
    }
    return { ranks, asOf: retrievedAt, coverage: rows.length, period,
      note: `Public preview: ${rows.length}/32 teams. #1 allows the most fantasy points (easiest), under FantasyPros' scoring—not DK/FD scoring. The complete report requires authorized access. Retrieved ${retrievedAt.toISOString()}; this is not an archived pre-game report.` };
  } catch { return unavailable("FantasyPros' preview could not be parsed safely."); }
}

const cache = new Map<string, { expires: number; promise: Promise<PublishedData> }>();
async function publishedPage(url: string, parser: (html: string) => PublishedData, cacheKey = url) {
  const found = cache.get(cacheKey);
  if (found && found.expires > Date.now()) return found.promise;
  const entry = { expires: Date.now() + 60_000, promise: Promise.resolve(unavailable("Loading published ranks.")) };
  cache.set(cacheKey, entry);
  entry.promise = (async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "text/html" } });
      if (!response.ok) return unavailable(`Published source returned HTTP ${response.status}.`);
      const html = await response.text();
      if (html.length > 1_000_000) return unavailable("Published page exceeded the parser's safe size limit.");
      const result = parser(html);
      if (result.coverage) entry.expires = Date.now() + 60 * 60_000;
      return result;
    } catch { return unavailable("Published source could not be reached. No estimated ranks were substituted."); }
  })();
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return entry.promise;
}

export function attachPublishedMatchups(
  players: ModelPlayerProjection[], sport: ModelSport, pff: PublishedData, fp: PublishedData,
  pffUrl: string, fpUrl: string, cutoff: Date,
) {
  return players.map(player => {
    const opponent = nflTeamKey(player.opponent);
    const role = player.position.trim().toUpperCase();
    const make = (source: "pff" | "fantasypros", data: PublishedData): PublishedMatchupRanking => {
      const unit = source === "pff" ? "secondary" : `vs ${role || "unknown position"}`;
      const applicable = sport === "nfl" && (source === "pff" ? ["QB", "WR", "TE"].includes(role) : ["QB", "RB", "WR", "TE", "K", "DST"].includes(role));
      const tooLate = source === "pff" && data.asOf && data.asOf >= cutoff;
      const rank = applicable && !tooLate && opponent ? data.ranks[opponent]?.[source === "pff" ? "secondary" : role] ?? null : null;
      return { source, unit, rank, rankedTeams: 32, rankOneMeans: source === "pff" ? "strongest" : "most-allowed",
        sourceUrl: source === "pff" ? pffUrl : fpUrl, period: data.period, asOf: data.asOf,
        status: !applicable ? "unsupported" : rank === null ? "unavailable" : "available",
        note: !applicable ? sport !== "nfl" ? "These published sources cover NFL only; no cross-sport ranks are invented."
          : "Secondary ratings are passing-game context, not a rushing-defense rating."
          : tooLate ? "This rating was published after the model cutoff; excluded from this preview."
          : `${data.note}${rank === null && data.coverage ? " This opponent/position is not present in the accessible report." : ""}` };
    };
    return { ...player, publishedMatchups: [make("pff", pff), make("fantasypros", fp)] };
  });
}

export async function publishedMatchups(
  players: ModelPlayerProjection[], sport: ModelSport, season: number, slateDate: string, cutoff: Date,
) {
  const pffUrl = `https://www.pff.com/news/nfl-secondary-rankings-${season}`;
  const fpUrl = "https://www.fantasypros.com/nfl/points-allowed.php";
  const today = new Date().toISOString().slice(0, 10);
  const [pff, fp] = sport === "nfl" ? await Promise.all([
    publishedPage(pffUrl, html => parsePffSecondary(html, season)),
    slateDate < today ? Promise.resolve(unavailable("Current FantasyPros reports are not historical snapshots; excluded for past slates."))
      : publishedPage(fpUrl, html => parseFantasyProsPreview(html, season), `${fpUrl}:${season}`),
  ]) : [unavailable("Published NFL secondary ranks do not cover this sport."), unavailable("Published NFL positional ranks do not cover this sport.")];
  return {
    players: attachPublishedMatchups(players, sport, pff, fp, pffUrl, fpUrl, cutoff),
    notes: sport === "nfl" ? [
      `PFF secondary source: ${pff.period}. ${pff.note}`,
      `FantasyPros positional source: ${fp.period}. ${fp.note}`,
      "Published ratings are separately attributed matchup context. They do not replace ALLPLAY's own forecasts, change their numerical means, or supply individual coverage assignments.",
    ] : ["NFL published matchup sources are not applied to this sport. Appropriate sport-specific sources remain unconfigured."],
  };
}
