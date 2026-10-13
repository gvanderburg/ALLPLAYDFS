import type {
  DfsEvent, DfsPlayerProjection, DfsSalaryCoverage, DfsSalaryPlatform,
  DfsSalarySlate, DfsSport,
} from "@workspace/api-zod";
import { parseSalaryCsv } from "./salary-csv";

const ORIGIN = "https://www.draftkings.com";
const SOURCE = "DraftKings salary CSV export";
const TTL = 15 * 60 * 1000;
const requests = new Map<string, { expires: number; promise: Promise<unknown> }>();
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" ? v as ObjectValue : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown) => typeof v === "string" ? v : "";

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const found = requests.get(key);
  if (found && found.expires > Date.now()) return found.promise as Promise<T>;
  if (requests.size >= 128) requests.delete(requests.keys().next().value!);
  const entry = { expires: Date.now() + TTL, promise: load() };
  requests.set(key, entry);
  try { return await entry.promise; }
  catch (error) {
    // Briefly cache failures as well, so repeated refreshes do not flood the source.
    entry.expires = Date.now() + 60_000;
    throw error;
  }
}

async function request(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`DraftKings export returned ${response.status}`);
  return response;
}

async function slatesFor(sport: DfsSport, date: string): Promise<DfsSalarySlate[]> {
  const code = sport === "nascar" ? "NAS" : sport.toUpperCase();
  const payload = await cached(`lobby:${code}`, async () => {
    const response = await request(`${ORIGIN}/lobby/getcontests?sport=${code}`);
    return object(await response.json());
  });
  const formats = new Map(array(payload.GameTypes).map((value) => {
    const item = object(value);
    return [String(item.GameTypeId), item] as const;
  }));
  return array(payload.DraftGroups).flatMap((value) => {
    const group = object(value);
    const format = formats.get(String(group.GameTypeId));
    // An out-of-season sport can return the ALL-sports lobby. Never mix those rows.
    if (text(group.Sport).toUpperCase() !== code ||
        text(group.StartDateEst).slice(0, 10) !== date ||
        text(format?.DraftType) !== "SalaryCap") return [];
    const id = String(group.DraftGroupId ?? "");
    const time = new Date(text(group.StartDate));
    if (!/^\d{1,12}$/.test(id) || Number.isNaN(time.getTime())) return [];
    const formatName = text(format?.Name) || "Salary cap";
    // The NFL/NBA lobby also contains video-game simulations. They must not
    // inherit real-world ESPN schedules or player forecasts.
    if (/madden|2k|simulat/i.test(`${formatName} ${text(object(format?.GameStyle).Name)}`)) return [];
    const clock = time.toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
    });
    const count = typeof group.GameCount === "number" && Number.isInteger(group.GameCount) ? group.GameCount : null;
    const featured = text(group.DraftGroupTag) === "Featured";
    const suffix = text(group.ContestStartTimeSuffix).trim();
    return [{
      id, sport, startTime: time, gameCount: count, format: formatName,
      name: `${formatName} · ${clock} ET${count ? ` · ${count} ${sport === "nascar" ? (count === 1 ? "race" : "races") : (count === 1 ? "game" : "games")}` : ""}${featured ? " · Featured" : suffix ? ` · ${suffix}` : ""}`,
      priority: formatName === "Classic" ? (featured ? 0 : 1) : 2,
    }];
  }).sort((a, b) => a.priority - b.priority || a.startTime.getTime() - b.startTime.getTime())
    .map(({ priority: _priority, ...slate }) => slate);
}

function canonicalTeam(sport: DfsSport, team?: string | null) {
  const value = (team ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const aliases: Partial<Record<DfsSport, Record<string, string>>> = {
    nhl: { LA: "LAK", SJ: "SJS", NJ: "NJD", TB: "TBL", WSH: "WAS" },
    nfl: { LA: "LAR", WSH: "WAS", JAC: "JAX" },
    mlb: { CHW: "CWS", WSH: "WAS", KCR: "KC", SFG: "SF", SDP: "SD", TBR: "TB" },
    nba: { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA" },
  };
  return aliases[sport]?.[value] ?? value;
}

function playerKey(sport: DfsSport, name: string, team?: string | null) {
  const clean = name.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/\b(jr|sr|ii|iii|iv)\.?\s*$/i, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${canonicalTeam(sport, team)}:${clean}`;
}

export class InvalidSalarySlate extends Error {}
type ForecastInput = Omit<DfsPlayerProjection, "updatedAt"> & { updatedAt?: string | Date | null };

export async function getSalaryData(
  sport: DfsSport | undefined, date: string, platform: DfsSalaryPlatform,
  slateId: string | undefined, rawForecasts: ForecastInput[], events: Pick<DfsEvent, "sport" | "competitors">[],
  reportError: (error: unknown) => void,
): Promise<{ coverage: DfsSalaryCoverage; players: DfsPlayerProjection[] }> {
  // Server-generated models use Date; feed assemblers supply ISO strings.
  const forecasts: DfsPlayerProjection[] = rawForecasts.map((player) => ({
    ...player, updatedAt: player.updatedAt ? new Date(player.updatedAt) : null,
  }));
  const coverage: DfsSalaryCoverage = {
    platform, available: false, status: "unavailable",
    source: platform === "draftkings" ? SOURCE : "No FanDuel salary source connected",
    message: "", slates: [], selectedSlateId: null, fetchedAt: null,
  };
  if (!sport) return { coverage: { ...coverage, status: "select_sport", message: "Select a sport to load salary slates." }, players: forecasts };
  if (platform === "fanduel") return {
    coverage: { ...coverage, message: "Automatic FanDuel salaries are not connected. A permitted live salary source is still needed; DraftKings prices are never used as a substitute." },
    players: forecasts,
  };
  try {
    coverage.slates = await slatesFor(sport, date);
    if (slateId && !coverage.slates.some((slate) => slate.id === slateId)) {
      throw new InvalidSalarySlate("Salary slate does not belong to this sport and date");
    }
    const slate = coverage.slates.find((item) => item.id === slateId) ?? coverage.slates[0];
    if (!slate) return {
      coverage: { ...coverage, status: "no_slates", message: `No published DraftKings salary-cap slate starts on ${date} (Eastern time). Past or unpublished slates are not substituted.` },
      players: forecasts,
    };
    coverage.selectedSlateId = slate.id;
    const exportData = await cached(`csv:${slate.id}`, async () => {
      const response = await request(`${ORIGIN}/lineup/getavailableplayerscsv?draftGroupId=${slate.id}`);
      const csv = await response.text();
      if (Buffer.byteLength(csv) > 2_000_000) throw new Error("Salary export is too large");
      return { rows: parseSalaryCsv(csv), fetchedAt: new Date() };
    });
    if (!exportData.rows.length) return {
      coverage: {
        ...coverage, status: "unavailable", fetchedAt: exportData.fetchedAt,
        message: "DraftKings has published this slate, but its player salary export is still empty. Prices will load automatically when published; none are guessed.",
      },
      players: forecasts,
    };
    const byPlayer = new Map<string, DfsPlayerProjection[]>();
    forecasts.forEach((player) => {
      const key = playerKey(sport, player.name, player.team);
      byPlayer.set(key, [...(byPlayer.get(key) ?? []), player]);
    });
    const competitors = events.filter((event) => event.sport === sport)
      .flatMap((event) => event.competitors);
    const players = exportData.rows.flatMap((row): DfsPlayerProjection[] => {
      const salary = Number(row.Salary);
      if (!row.Name || !/^\d+$/.test(row.ID) || !Number.isInteger(salary) ||
          salary <= 0 || salary > 100_000) return [];
      const key = playerKey(sport, row.Name, row.TeamAbbrev);
      const matches = byPlayer.get(key) ?? [];
      const defense = row.Position === "DST" ? forecasts.find((p) =>
        p.position === "D/ST" && canonicalTeam(sport, p.team) === canonicalTeam(sport, row.TeamAbbrev)) : undefined;
      const forecast = matches.length === 1 ? matches[0] : defense;
      const matchup = row["Game Info"].match(/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)/);
      const ownTeam = canonicalTeam(sport, row.TeamAbbrev);
      const isAway = matchup && canonicalTeam(sport, matchup[1]) === ownTeam;
      const isHome = matchup && canonicalTeam(sport, matchup[2]) === ownTeam;
      const team = competitors.find((c) => canonicalTeam(sport, c.abbreviation) === ownTeam);
      return [{
        id: `${sport}-dk-${slate.id}-${row.ID}-${row["Roster Position"]}`,
        name: row.Name, sport, team: row.TeamAbbrev || null,
        position: row.Position || null, rosterPositions: row["Roster Position"],
        opponent: isAway ? matchup[2] : isHome ? matchup[1] : null,
        homeAway: isAway ? "away" : isHome ? "home" : null,
        teamLogo: team?.logo ?? null, gameInfo: row["Game Info"],
        salary, salaryPlatform: platform, salarySource: SOURCE,
        salaryPlayerId: row.ID, salarySlateId: slate.id,
        projection: forecast?.projection ?? null,
        projectionType: forecast?.projectionType ?? "No forecast available",
        source: forecast?.source ?? "No projection feed",
        updatedAt: forecast?.updatedAt ?? null,
        // CSV AvgPointsPerGame is historical, NOT a player projection.
      }];
    });
    if (!players.length) throw new Error("Salary export contained no valid player prices");
    return {
      coverage: {
        ...coverage, available: true, status: "available", fetchedAt: exportData.fetchedAt,
        message: `Automatic DraftKings prices for this exact slate. Exports are cached for 15 minutes. Slates start on the selected Eastern date and may include games on later days. Forecasts remain ESPN scoring, not DraftKings scoring.`,
      },
      players,
    };
  } catch (error) {
    if (error instanceof InvalidSalarySlate) throw error;
    reportError(error);
    return {
      coverage: { ...coverage, status: "error", message: "The DraftKings salary export is temporarily unavailable. No prices are invented or substituted. Try again later." },
      players: forecasts,
    };
  }
}
