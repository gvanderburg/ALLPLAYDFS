import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, modelEvaluations, evaluationUploads, evaluationImports } from "@workspace/db";
import {
  ListEvaluationsResponse, StartEvaluationBody, StartEvaluationResponse,
  RequestEvaluationUploadBody, RequestEvaluationUploadResponse,
  VerifyEvaluationImportBody, VerifyEvaluationImportResponse,
} from "@workspace/api-zod";
import { isOwnerAccount } from "../lib/owner-access";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { validateImportCsv, type OwnershipRow } from "../lib/model-evaluation/csv";
import { startReplay, validDate, type EvaluationReport } from "../lib/model-evaluation/service";
import { ownershipSummary } from "../lib/model-evaluation/evaluate";

const router = Router(), storage = new ObjectStorageService();
function owner(req: Request, res: Response, write = false) {
  res.set("Cache-Control", "private, no-store"); res.vary("Cookie"); res.vary("Authorization");
  const userId = getAuth(req).userId;
  if (!isOwnerAccount(userId)) {
    res.status(userId ? 403 : 401).json({ error: "Historical evaluation and contest imports are private owner tools." }); return null;
  }
  if (write) {
    try {
      const origin = new URL(req.get("origin") ?? "");
      if (origin.host !== getClerkProxyHost(req) || !["http:", "https:"].includes(origin.protocol) ||
          origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error();
    } catch {
      res.status(403).json({ error: "Open ALLPLAY to perform this action." }); return null;
    }
  }
  return userId!;
}
const guarded = (handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try { await handler(req, res); }
  catch (err) {
    req.log.error({ err }, "Private evaluation request failed");
    res.status(503).json({ error: "Evaluation storage or source is unavailable. Please retry." });
  }
};
const publicImport = (row: typeof evaluationImports.$inferSelect) => ({
  id: row.id, kind: row.kind, sport: row.sport, site: row.site, slateDate: row.slateDate, contestId: row.contestId,
  source: row.source, asOf: row.asOf, hash: row.hash, rowCount: row.rowCount, verifiedAt: row.verifiedAt,
});
router.get("/evaluations", guarded(async (req, res) => {
  if (!owner(req, res)) return;
  const [runs, imports] = await Promise.all([
    db.select().from(modelEvaluations).orderBy(desc(modelEvaluations.createdAt)).limit(50),
    db.select().from(evaluationImports).orderBy(desc(evaluationImports.verifiedAt)).limit(100),
  ]);
  res.json(ListEvaluationsResponse.parse({ runs, imports: imports.map(publicImport) }));
}));
router.post("/evaluations", guarded(async (req, res) => {
  if (!owner(req, res, true)) return;
  const parsed = StartEvaluationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid replay sport, site, settings or dates." }); return; }
  try { res.status(202).json(StartEvaluationResponse.parse(await startReplay(parsed.data))); }
  catch (err) {
    const message = err instanceof Error ? err.message : "Replay could not start.";
    // Known input/queue errors only; DB errors remain private.
    if (/Choose |already running/.test(message)) res.status(/already running/.test(message) ? 409 : 400).json({ error: message });
    else throw err;
  }
}));
router.post("/evaluations/uploads", guarded(async (req, res) => {
  const userId = owner(req, res, true); if (!userId) return;
  const parsed = RequestEvaluationUploadBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.fileName.toLowerCase().endsWith(".csv")) { res.status(400).json({ error: "Use a CSV file up to 1 MB." }); return; }
  const uploadURL = await storage.getObjectEntityUploadURL(), id = randomUUID();
  await db.insert(evaluationUploads).values({ id, ownerId: userId, objectPath: storage.normalizeObjectEntityPath(uploadURL), ...parsed.data });
  res.json(RequestEvaluationUploadResponse.parse({ id, uploadURL }));
}));
router.post("/evaluations/imports", guarded(async (req, res) => {
  const userId = owner(req, res, true); if (!userId) return;
  const parsed = VerifyEvaluationImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide valid contest, source and as-of provenance." }); return; }
  const body = parsed.data, midnight = Date.parse(`${body.slateDate}T00:00:00Z`), asOf = new Date(body.asOf).getTime();
  if (!body.verified || body.source.trim().length < 10 || !body.contestId.trim() ||
      !validDate(body.slateDate) || body.slateDate < "2020-01-01" || !Number.isFinite(asOf) ||
      asOf > Date.now() || body.kind === "pool" && asOf >= midnight ||
      body.kind === "ownership" && (asOf < midnight || body.slateDate >= new Date().toISOString().slice(0, 10)) ||
      /showdown|captain|single.?game|tiers/i.test(body.contestId)) {
    res.status(400).json({ error: "Attest a verified classic-contest export with valid dates. Pool as-of must precede slate UTC midnight; actual ownership must be a post-slate export, not a forecast." }); return;
  }
  const [upload] = await db.select().from(evaluationUploads).where(and(eq(evaluationUploads.id, body.uploadId), eq(evaluationUploads.ownerId, userId)));
  const [existing] = await db.select().from(evaluationImports).where(eq(evaluationImports.uploadId, body.uploadId));
  if (!upload || existing || upload.createdAt.getTime() < Date.now() - 3600000) { res.status(400).json({ error: "Choose a fresh, unused upload issued to your owner account." }); return; }
  let run: typeof modelEvaluations.$inferSelect | undefined;
  let report: EvaluationReport | undefined;
  if (body.kind === "ownership") {
    if (!body.runId) { res.status(400).json({ error: "Choose the completed replay to compare this actual contest export." }); return; }
    [run] = await db.select().from(modelEvaluations).where(eq(modelEvaluations.id, body.runId));
    report = run?.report as EvaluationReport | undefined;
    const slate = report?.slates?.find(s => s.date === body.slateDate && s.contestId === body.contestId && s.poolImportId);
    if (!run || run.status !== "ready" || run.sport !== body.sport || run.site !== body.site || !slate) {
      res.status(400).json({ error: "Ownership must match the completed run's sport, scoring site, slate day and verified contest pool." }); return;
    }
    if (slate.lastVerifiedEnd && asOf < Date.parse(slate.lastVerifiedEnd)) {
      res.status(400).json({ error: "Actual ownership export as-of precedes the verified end of this slate." }); return;
    }
  }
  const file = await storage.getObjectEntityFile(upload.objectPath), [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== upload.size || Number(metadata.size) > 1048576 ||
      !/^(text\/csv|application\/csv|application\/octet-stream)(;|$)/.test(metadata.contentType ?? "")) {
    res.status(400).json({ error: "CSV byte count/content type differs from the issued upload." }); return;
  }
  const [bytes] = await file.bucket.file(file.name, { generation: Number(metadata.generation) })
    .download({ start: 0, end: 1048576 });
  if (bytes.length !== upload.size) { res.status(400).json({ error: "CSV upload changed or exceeded the issued byte limit." }); return; }
  let validation: ReturnType<typeof validateImportCsv>;
  try { validation = validateImportCsv(bytes.toString("utf8"), body.kind); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "CSV is invalid." }); return; }
  const id = randomUUID(), auditObjectPath = `${upload.objectPath}.verified-${id}`;
  // Freeze the verified bytes in a separate private object never exposed via a PUT URL.
  const immutableFile = file.bucket.file(`${file.name}.verified-${id}`);
  await immutableFile.save(bytes, { resumable: false, contentType: "text/csv", preconditionOpts: { ifGenerationMatch: 0 } });
  await setObjectAclPolicy(immutableFile, { owner: userId, visibility: "private" });
  const imported = await db.transaction(async tx => {
    const [row] = await tx.insert(evaluationImports).values({
      id, uploadId: upload.id, kind: body.kind, sport: body.sport, site: body.site, slateDate: body.slateDate,
      contestId: body.contestId.trim(), source: body.source.trim(), asOf: new Date(asOf).toISOString(),
      verifiedBy: userId, hash: validation.hash, rowCount: validation.rowCount,
      data: { records: validation.records, auditObjectPath, runId: body.runId ?? null,
        verification: "Owner-attested official contest export; structural/range/identity validation, not independent provider authentication." },
    }).returning();
    if (run && report) {
      const summary = ownershipSummary(report.rows, validation.records as OwnershipRow[], body.slateDate);
      // Lock then re-read so simultaneous imports never overwrite one another.
      const [current] = await tx.select().from(modelEvaluations).where(eq(modelEvaluations.id, run.id)).for("update");
      const currentReport = current.report as EvaluationReport;
      currentReport.ownership.push({ ...summary, importId: id, contestId: body.contestId, source: body.source, hash: validation.hash });
      await tx.update(modelEvaluations).set({ report: currentReport }).where(eq(modelEvaluations.id, run.id));
    }
    return row;
  });
  res.status(201).json(VerifyEvaluationImportResponse.parse(publicImport(imported)));
}));
export default router;
