import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, matchupReports } from "@workspace/db";
import { ApproveMatchupReportBody, type MatchupReport } from "@workspace/api-zod";
import { isOwnerAccount } from "../lib/owner-access";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { validateReport } from "../lib/projection-model/report-validation";
import { invalidatePublishedReports } from "../lib/projection-model/service";

export function createMatchupReportRouter(deps: {
  userId?: (req: Request) => string | null;
  owner?: (id: string | null) => boolean;
} = {}) {
const router = Router();
function reportOwner(req: Request, res: Response, write = false) {
  res.set("Cache-Control", "private, no-store"); res.vary("Cookie"); res.vary("Authorization");
  const userId = deps.userId ? deps.userId(req) : getAuth(req).userId;
  if (!(deps.owner ?? isOwnerAccount)(userId)) {
    res.status(userId ? 403 : 401).json({ error: "Report management is restricted to the owner." }); return null;
  }
  if (write) {
    try {
      const origin = new URL(req.get("origin") ?? "");
      if (origin.host !== getClerkProxyHost(req) || !["http:", "https:"].includes(origin.protocol) ||
          origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error();
    } catch { res.status(403).json({ error: "Open ALLPLAY to manage reports." }); return null; }
  }
  return userId!;
}
const guarded = (handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await handler(req, res); }
  catch (err) {
    req.log.error({ err }, "Matchup report storage failed");
    res.status(503).json({ error: "Report storage is unavailable. Please retry." });
  }
};
const reportView = (row: typeof matchupReports.$inferSelect): MatchupReport => ({
  ...(row.data as Pick<MatchupReport, "metadata" | "rows" | "coverage" | "fullCoverage">),
  id: row.id, status: row.status as MatchupReport["status"], createdAt: row.createdAt,
});
router.get("/matchup-reports", guarded(async (req, res) => {
  if (!reportOwner(req, res)) return;
  const rows = await db.select().from(matchupReports).where(eq(matchupReports.status, "approved")).orderBy(desc(matchupReports.createdAt));
  res.json(rows.map(reportView));
}));
router.post("/matchup-reports/preview", guarded(async (req, res) => {
  const ownerId = reportOwner(req, res, true); if (!ownerId) return;
  let data: ReturnType<typeof validateReport>;
  try { data = validateReport(req.body); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Invalid report." }); return; }
  await db.delete(matchupReports).where(and(eq(matchupReports.status, "preview"), lt(matchupReports.createdAt, new Date(Date.now() - 3600000))));
  const [row] = await db.insert(matchupReports).values({ id: randomUUID(), ownerId, status: "preview", data }).returning();
  res.json(reportView(row));
}));
router.post("/matchup-reports/:id/approve", guarded(async (req, res) => {
  const ownerId = reportOwner(req, res, true); if (!ownerId) return;
  const parsed = ApproveMatchupReportBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.confirmed) { res.status(400).json({ error: "Review and confirm the preview first." }); return; }
  const result = await db.transaction(async tx => {
    const [draft] = await tx.select().from(matchupReports).where(and(eq(matchupReports.id, String(req.params.id)), eq(matchupReports.ownerId, ownerId))).for("update");
    if (!draft || draft.status !== "preview" || draft.createdAt.getTime() < Date.now() - 3600000) return null;
    if (parsed.data.replaceId) {
      const [old] = await tx.select().from(matchupReports).where(and(eq(matchupReports.id, parsed.data.replaceId), eq(matchupReports.status, "approved"))).for("update");
      if (!old) return null;
      // Replacement cannot accidentally delete an unrelated publisher.
      if ((old.data as MatchupReport).metadata.publisher !== (draft.data as MatchupReport).metadata.publisher) return null;
      await tx.delete(matchupReports).where(eq(matchupReports.id, old.id));
    }
    const [saved] = await tx.update(matchupReports).set({ status: "approved" }).where(eq(matchupReports.id, draft.id)).returning();
    return saved;
  });
  if (!result) { res.status(409).json({ error: "Preview expired, already approved, or replacement no longer matches. Preview again." }); return; }
  invalidatePublishedReports();
  res.json(reportView(result));
}));
router.delete("/matchup-reports/:id", guarded(async (req, res) => {
  if (!reportOwner(req, res, true)) return;
  const rows = await db.delete(matchupReports).where(eq(matchupReports.id, String(req.params.id))).returning();
  if (!rows.length) { res.status(404).json({ error: "Report not found." }); return; }
  invalidatePublishedReports();
  res.sendStatus(204);
}));
return router;
}
export default createMatchupReportRouter();
