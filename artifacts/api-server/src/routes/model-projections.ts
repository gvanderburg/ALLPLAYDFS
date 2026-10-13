import { Router } from "express";
import { getAuth } from "@clerk/express";
import { GetModelProjectionsResponse } from "@workspace/api-zod";
import { hasProjectionAccess } from "../lib/membership";
import { MODEL_SPORTS, type ModelSettings, type ModelSport } from "../lib/projection-model/types";
import { emptyModelSheet, getOrStartModel } from "../lib/projection-model/service";

const router = Router();
const validDate = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function integer(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
router.get("/dfs/model-projections", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie"); res.vary("Authorization");
  const sport = req.query.sport;
  const date = req.query.date ?? new Date().toISOString().slice(0, 10);
  const recentGames = integer(req.query.recentGames, 5, 3, 10);
  const recentWeight = integer(req.query.recentWeight, 70, 0, 100);
  const matchupWeight = integer(req.query.matchupWeight, 25, 0, 50);
  if (typeof sport !== "string" || !Object.hasOwn(MODEL_SPORTS, sport) || !validDate(date) ||
      recentGames === null || recentWeight === null || matchupWeight === null ||
      Number(date.slice(0, 4)) < 2020 || Number(date.slice(0, 4)) > new Date().getUTCFullYear() + 1) {
    res.status(400).json({ error: "Select a supported sport, valid calendar day, 3–10 recent games, 0–100% recent weight and 0–50% matchup influence." });
    return;
  }
  const settings: ModelSettings = { recentGames, recentWeight, matchupWeight };
  try {
    const hasAccess = await hasProjectionAccess(getAuth(req).userId);
    const data = hasAccess ? getOrStartModel(sport as ModelSport, date, settings) :
      emptyModelSheet(sport as ModelSport, date, settings, "locked");
    const response = GetModelProjectionsResponse.parse(data);
    res.json({
      ...response,
      requestedDate: response.requestedDate.toISOString().slice(0, 10),
      slateDate: response.slateDate.toISOString().slice(0, 10),
    });
  } catch (error) {
    req.log.error({ err: error }, "Model sheet request failed");
    res.status(503).json({ error: "Model sheet is temporarily unavailable." });
  }
});
export default router;
