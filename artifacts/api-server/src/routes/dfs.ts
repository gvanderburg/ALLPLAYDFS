import { Router, type IRouter } from "express";
import { GetDfsDashboardQueryParams, GetDfsDashboardResponse } from "@workspace/api-zod";
import { getSalaryData, InvalidSalarySlate } from "../lib/draftkings-salaries";
import { getAuth } from "@clerk/express";
import { hasProjectionAccess } from "../lib/membership";
import { gateDashboardProjections } from "../lib/projection-access";

const router: IRouter = Router();

const sports = {
  nfl: {
    label: "NFL",
    sport: "football",
    league: "nfl",
    fantasyGame: "ffl",
  },
  nhl: {
    label: "NHL",
    sport: "hockey",
    league: "nhl",
    fantasyGame: "fhl",
  },
  wnba: {
    label: "WNBA",
    sport: "basketball",
    league: "wnba",
    fantasyGame: null,
  },
  nba: {
    label: "NBA",
    sport: "basketball",
    league: "nba",
    fantasyGame: "fba",
  },
  mlb: {
    label: "MLB",
    sport: "baseball",
    league: "mlb",
    fantasyGame: "flb",
  },
  nascar: {
    label: "NASCAR",
    sport: "racing",
    league: "nascar-premier",
    fantasyGame: null,
  },
  cfb: {
    label: "College Football",
    sport: "football",
    league: "college-football",
    fantasyGame: null,
  },
} as const;

type Sport = keyof typeof sports;
type JsonObject = Record<string, unknown>;

const cache = new Map<
  string,
  { expiresAt: number; data: ReturnType<typeof GetDfsDashboardResponse.parse> }
>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_FANTASY =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games";

function object(value: unknown): JsonObject {
  return value && typeof value === "object"
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function identifier(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

const positions: Partial<Record<Sport, Record<number, string>>> = {
  nfl: { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" },
  nhl: { 1: "C", 2: "LW", 3: "RW", 4: "D", 5: "G" },
  nba: { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" },
  mlb: { 1: "C", 2: "1B", 3: "2B", 4: "3B", 5: "SS", 6: "LF", 7: "CF", 8: "RF", 9: "DH", 10: "SP", 11: "RP" },
};

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Sports data source returned ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function normalizeEvent(eventValue: unknown, sport: Sport) {
  const event = object(eventValue);
  const competition = object(array(event.competitions)[0]);
  const status = object(object(event.status).type);
  const venue = object(competition.venue);
  const competitors = array(competition.competitors).map((item) => {
    const competitor = object(item);
    const team = object(competitor.team);
    return {
      id: text(team.id),
      name: text(team.displayName, text(team.name, "Team")),
      abbreviation: text(team.abbreviation, text(team.shortDisplayName)),
      homeAway: text(competitor.homeAway),
      logo:
        text(team.logo) ||
        text(array(team.logos).length ? object(array(team.logos)[0]).href : "") ||
        null,
      score:
        competitor.score === undefined ? null : String(competitor.score),
    };
  });

  const odds = object(array(competition.odds)[0]);
  const oddsDetails = object(odds.details);
  const totalPoints =
    number(odds.overUnder) ??
    number(odds.total) ??
    number(oddsDetails.overUnder);
  const spread = number(odds.spread) ?? number(oddsDetails.spread);
  const date = text(event.date);

  return {
    id: text(event.id),
    sport,
    league: sports[sport].label,
    name: text(event.name),
    shortName: text(event.shortName, text(event.name)),
    startTime: date || new Date().toISOString(),
    status:
      text(status.shortDetail) ||
      text(status.detail) ||
      text(status.name, "Scheduled"),
    venue: text(venue.fullName) || null,
    totalPoints,
    spread,
    oddsSource: text(odds.provider ? object(odds.provider).name : ""),
    competitors,
  };
}

function normalizeNews(itemValue: unknown, sport: Sport) {
  const item = object(itemValue);
  const link = object(object(item.links).web);
  const images = array(item.images);
  const image = object(images[0]);
  const publishedValue =
    text(item.published) || text(item.publishedAt) || null;
  const published =
    publishedValue && !Number.isNaN(Date.parse(publishedValue))
      ? new Date(publishedValue).toISOString()
      : null;
  const url = text(link.href, text(item.link));
  const imageUrl = text(image.url);
  return {
    id: text(item.id, `${sport}-${text(item.headline, text(item.title))}`),
    sport,
    title: text(item.headline, text(item.title)),
    description:
      text(item.description) || text(item.summary) || null,
    source: "ESPN",
    url: /^https?:\/\//.test(url) ? url : null,
    publishedAt: published,
    image: /^https?:\/\//.test(imageUrl) ? imageUrl : null,
  };
}

function readFantasyProjections(
  payload: unknown,
  sport: Sport,
  teamIds: Set<string>,
  teamLabels: Map<string, string>,
  opponents: Map<string, string>,
  requestedPeriod: number | null,
) {
  const players = array(object(payload).players);
  const projections: Array<{
    id: string;
    name: string;
    sport: Sport;
    team: string | null;
    opponent: string | null;
    position: string | null;
    projection: number;
    projectionType: string;
    source: string;
    updatedAt: string;
  }> = [];

  for (const playerValue of players) {
    const entry = object(playerValue);
    const player = object(entry.player);
    const teamId = identifier(player.proTeamId);
    if (!teamId || (teamIds.size > 0 && !teamIds.has(teamId))) continue;

    const statRecords = array(entry.stats).length
      ? array(entry.stats)
      : array(player.stats);
    const projectedRecords = statRecords
      .map(object)
      .filter(
        (record) =>
          number(record.statSourceId) === 1 &&
          number(record.appliedTotal) !== null,
      );
    const period = requestedPeriod ?? number(object(payload).scoringPeriodId);
    const gameProjection = projectedRecords.find(
      (record) =>
        number(record.statSplitTypeId) === 1 &&
        number(record.scoringPeriodId) === period,
    );
    const seasonProjection = projectedRecords.find(
      (record) =>
        number(record.statSplitTypeId) === 0 &&
        number(record.scoringPeriodId) === 0,
    );
    const projectedRecord = gameProjection ?? seasonProjection;
    if (!projectedRecord) continue;

    const projection = number(projectedRecord.appliedTotal);
    if (projection === null || projection < 0) continue;

    projections.push({
      id: `${sport}-${identifier(player.id)}`,
      name: text(player.fullName),
      sport,
      team: teamLabels.get(teamId) ?? null,
      opponent: opponents.get(teamId) ?? null,
      position: positions[sport]?.[number(player.defaultPositionId) ?? 0] ?? null,
      projection: Math.round(projection * 10) / 10,
      projectionType: gameProjection
        ? `Scoring period ${period} points`
        : "Season forecast points",
      source: "ESPN Fantasy default scoring",
      updatedAt: new Date().toISOString(),
    });
  }

  return projections.sort((a, b) => b.projection - a.projection).slice(0, 60);
}

function readFantasyNews(payload: unknown, sport: Sport, teamIds: Set<string>, requestedPeriod: number | null) {
  const period = requestedPeriod ?? number(object(payload).scoringPeriodId);
  if (period === null) return [];
  return array(object(payload).players).flatMap((entryValue) => {
    const player = object(object(entryValue).player);
    if (!teamIds.has(identifier(player.proTeamId))) return [];
    const outlooks = object(object(player.outlooks).outlooksByWeek);
    const outlook = text(outlooks[String(period)]).replace(/<[^>]*>/g, "");
    if (!outlook) return [];
    const timestamp = number(player.lastNewsDate);
    return [{
      id: `fantasy-${sport}-${identifier(player.id)}-${period}`,
      sport,
      title: `Fantasy outlook: ${text(player.fullName)}`,
      description: outlook.slice(0, 280) + (outlook.length > 280 ? "…" : ""),
      source: "ESPN Fantasy",
      url: `https://fantasy.espn.com/${sport === "nfl" ? "football" : sport === "nba" ? "basketball" : sport === "nhl" ? "hockey" : "baseball"}/players/projections`,
      publishedAt: timestamp ? new Date(timestamp).toISOString() : null,
      image: null,
    }];
  }).slice(0, 12);
}

function todayInUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getDashboard(date: string, selectedSport?: Sport) {
  const selectedSports = selectedSport
    ? [selectedSport]
    : (Object.keys(sports) as Sport[]);
  const scoreboardResults = await Promise.all(
    selectedSports.map(async (sport) => {
      const config = sports[sport];
      const dateParam = date.replaceAll("-", "");
      const base = `${ESPN_SITE}/${config.sport}/${config.league}`;
      const [scoreboard, news] = await Promise.allSettled([
        fetchJson(`${base}/scoreboard?dates=${dateParam}&limit=200`),
        fetchJson(`${base}/news`),
      ]);
      const scoreboardData =
        scoreboard.status === "fulfilled" ? object(scoreboard.value) : {};
      const events =
        scoreboard.status === "fulfilled"
          ? array(scoreboardData.events).map((event) => normalizeEvent(event, sport))
          : [];
      const articles =
        news.status === "fulfilled"
          ? array(object(news.value).articles)
              .map((item) => normalizeNews(item, sport))
              .filter((item) => item.title)
              .slice(0, 8)
          : [];
      const teamIds = new Set(
        events.flatMap((event) =>
          event.competitors.map((competitor) => competitor.id),
        ),
      );
      const teamLabels = new Map(
        events.flatMap((event) =>
          event.competitors.map((competitor) => [
            competitor.id,
            competitor.abbreviation || competitor.name,
          ] as const),
        ),
      );
      const opponents = new Map(
        events.flatMap((event) =>
          event.competitors.map((competitor) => [
            competitor.id,
            event.competitors
              .filter((other) => other.id !== competitor.id)
              .map((other) => other.abbreviation || other.name)
              .join(", "),
          ] as const),
        ),
      );
      const firstEvent = object(array(scoreboardData.events)[0]);
      const league = object(array(scoreboardData.leagues)[0]);
      return {
        sport,
        events,
        news: articles,
        teamIds,
        teamLabels,
        opponents,
        scoringPeriodId:
          number(object(scoreboardData.week).number) ??
          number(object(firstEvent.week).number),
        seasonYear:
          number(object(firstEvent.season).year) ??
          number(object(league.season).year) ??
          Number(date.slice(0, 4)),
        scheduleError: scoreboard.status === "rejected",
        newsError: news.status === "rejected",
      };
    }),
  );

  const leagueResults = scoreboardResults;
  const projectionResults = await Promise.all(
    leagueResults.map(async (result) => {
      const config = sports[result.sport];
      if (!config.fantasyGame || result.teamIds.size === 0) {
        return { sport: result.sport, projections: [], fantasyNews: [], failed: false };
      }
      try {
        const query = new URLSearchParams({ view: "kona_player_info" });
        query.append("view", "mSettings");
        if (result.scoringPeriodId !== null) {
          query.set("scoringPeriodId", String(result.scoringPeriodId));
        }
        const payload = await fetchJson(
          `${ESPN_FANTASY}/${config.fantasyGame}/seasons/${result.seasonYear}/segments/0/leaguedefaults/3?${query}`,
          // ESPN's public default league exposes its published fantasy-point
          // totals in appliedTotal, unlike the raw player-stat feed.
          {
            "x-fantasy-filter": JSON.stringify({
              players: {
                limit: 400,
                sortPercOwned: {
                  sortPriority: 1,
                  sortAsc: false,
                },
              },
            }),
          },
        );
        return {
          sport: result.sport,
          projections: readFantasyProjections(
            payload,
            result.sport,
            result.teamIds,
            result.teamLabels,
            result.opponents,
            result.scoringPeriodId,
          ),
          fantasyNews: readFantasyNews(
            payload,
            result.sport,
            result.teamIds,
            result.scoringPeriodId,
          ),
          failed: false,
        };
      } catch {
        return { sport: result.sport, projections: [], fantasyNews: [], failed: true };
      }
    }),
  );

  const projectionMap = new Map(
    projectionResults.map((result) => [result.sport, result]),
  );
  const events = leagueResults.flatMap((result) => result.events);
  const news = [
    ...leagueResults.flatMap((result) => result.news),
    ...projectionResults.flatMap((result) => result.fantasyNews),
  ]
    .sort(
      (left, right) =>
        new Date(right.publishedAt || 0).getTime() -
        new Date(left.publishedAt || 0).getTime(),
    )
    .slice(0, 40);
  const projections = projectionResults.flatMap(
    (result) => result.projections,
  );
  const sportCoverage = selectedSports.map((sport) => {
    const eventResult = leagueResults.find((item) => item.sport === sport);
    const projectionResult = projectionMap.get(sport);
    const hasFantasySource = Boolean(sports[sport].fantasyGame);
    const projectionsAvailable =
      (projectionResult?.projections.length ?? 0) > 0;
    let message = "Live schedule and recent ESPN news are available.";
    if (!hasFantasySource) {
      message =
        "ESPN does not expose a public fantasy-points projection feed for this sport. No projection values are shown.";
    } else if (projectionResult?.failed) {
      message =
        "The ESPN Fantasy projection feed is temporarily unavailable.";
    } else if (!projectionsAvailable && eventResult?.events.length) {
      message =
        "No current ESPN Fantasy projections were returned for today's teams.";
    } else if (!eventResult?.events.length) {
      message =
        "No event is scheduled for this date; player projections are only shown for teams on the slate.";
    }
    return {
      sport,
      label: sports[sport].label,
      eventsAvailable: !eventResult?.scheduleError,
      projectionsAvailable,
      newsAvailable: !eventResult?.newsError,
      message,
    };
  });

  return {
    date,
    updatedAt: new Date().toISOString(),
    events,
    news,
    projections,
    sportCoverage,
    sourceNotes: [
      "Schedules and available game totals are from ESPN's public scoreboard feeds; totals are shown only when a line is included in the feed.",
      "Player projections use ESPN's default fantasy scoring, not DraftKings or FanDuel rules. Scoring-period forecasts are shown where available; season forecasts are labeled separately. Missing projections are not estimated or filled with sample values.",
      "Recent news is from ESPN. NASCAR event totals are not applicable; use race odds rather than an over/under.",
      "Sports data is cached for up to 5 minutes.",
    ],
  };
}

router.get("/dfs/dashboard", async (req, res): Promise<void> => {
  if (req.query.date !== undefined && typeof req.query.date !== "string") {
    res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
    return;
  }
  const date = typeof req.query.date === "string" ? req.query.date : todayInUtc();
  const sportValue =
    typeof req.query.sport === "string" ? req.query.sport : undefined;

  if (!isDate(date)) {
    res.status(400).json({ error: "date must be a valid YYYY-MM-DD date" });
    return;
  }
  if (
    sportValue !== undefined &&
    !Object.prototype.hasOwnProperty.call(sports, sportValue)
  ) {
    res.status(400).json({ error: "Unsupported sport" });
    return;
  }

  // Query dates arrive as strings; the generated query validator expects Date.
  // Validate the calendar day first so Date's rollover cannot accept February 30.
  const parsed = GetDfsDashboardQueryParams.safeParse({
    ...req.query, date: new Date(`${date}T00:00:00.000Z`),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid dashboard filters" });
    return;
  }
  const sport = sportValue as Sport | undefined;
  const platform = parsed.data.salaryPlatform ?? "draftkings";
  const slateId = parsed.data.slateId;
  const cacheKey = `${date}:${sport ?? "all"}:${platform}:${slateId ?? "default"}`;
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie");
  res.vary("Authorization");
  const hasAccess = await hasProjectionAccess(getAuth(req).userId);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(gateDashboardProjections(cached.data, hasAccess));
    return;
  }

  try {
    const dashboard = await getDashboard(date, sport);
    const salaryData = await getSalaryData(
      sport, date, platform, slateId, dashboard.projections, dashboard.events,
      (error) => req.log.warn({ err: error, sport }, "Salary source unavailable"),
    );
    const data = GetDfsDashboardResponse.parse({
      projectionsLocked: false,
      ...dashboard, projections: salaryData.players, salaryCoverage: salaryData.coverage,
      sourceNotes: [
        ...dashboard.sourceNotes,
        "DraftKings prices are pulled automatically from its published slate CSV exports, cached for 15 minutes. Public export access is best-effort and can change. FanDuel is not connected.",
        "A salary row without a sourced forecast shows a dash, not zero. Historical average fantasy points in salary exports are never presented as projections.",
      ],
    });
    cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    res.json(gateDashboardProjections(data, hasAccess));
  } catch (error) {
    if (error instanceof InvalidSalarySlate) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to build DFS dashboard");
    res.status(502).json({ error: "Sports feeds are temporarily unavailable" });
  }
});

export default router;
