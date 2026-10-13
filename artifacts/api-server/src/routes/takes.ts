import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, gameTakes, takeUploads } from "@workspace/db";
import {
  RequestTakeUploadBody, CreateGameTakeBody, CreateGameTakeResponse,
  UpdateGameTakeBody, UpdateGameTakeParams, DeleteGameTakeParams,
  GetGameTakeFileParams, ListGameTakesResponse,
} from "@workspace/api-zod";
import { isOwnerAccount } from "../lib/owner-access";
import { hasProjectionAccess } from "../lib/membership";
import { ObjectStorageService } from "../lib/objectStorage";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { validTakeFile, validTakeSignature, parseTakeRange } from "../lib/take-files";

const router = Router();
const storage = new ObjectStorageService();
const guarded = (handler: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    res.vary("Cookie");
    res.vary("Authorization");
    try { await handler(req, res); }
    catch (err) {
      req.log.error({ err }, "Game Takes request failed");
      if (!res.headersSent) res.status(503).json({ error: "Game Takes is temporarily unavailable. Please retry." });
      else res.destroy();
    }
  };
function ownerWrite(req: Request, res: Response): string | null {
  const userId = getAuth(req).userId;
  if (!isOwnerAccount(userId)) {
    res.status(userId ? 403 : 401).json({ error: "Only the ALLPLAY owner can upload or manage Game Takes." });
    return null;
  }
  try {
    const origin = new URL(req.get("origin") ?? "");
    if (origin.host !== getClerkProxyHost(req) ||
        !["https:", "http:"].includes(origin.protocol) ||
        (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) throw new Error();
  } catch {
    res.status(403).json({ error: "Open ALLPLAY and retry this action from Game Takes." });
    return null;
  }
  return userId!;
}
const selectTakes = () => db.select({
  id: gameTakes.id, title: gameTakes.title, description: gameTakes.description,
  sport: gameTakes.sport, game: gameTakes.game, createdAt: gameTakes.createdAt,
  fileName: takeUploads.fileName, contentType: takeUploads.contentType, size: takeUploads.size,
}).from(gameTakes).innerJoin(takeUploads, eq(gameTakes.uploadId, takeUploads.id));

router.get("/takes", guarded(async (req, res) => {
  const userId = getAuth(req).userId;
  const hasAccess = await hasProjectionAccess(userId);
  const items = hasAccess ? await selectTakes().orderBy(desc(gameTakes.createdAt)) : [];
  res.json(ListGameTakesResponse.parse({ hasAccess, isOwner: isOwnerAccount(userId), items }));
}));
router.post("/takes/uploads", guarded(async (req, res) => {
  const ownerId = ownerWrite(req, res);
  if (!ownerId) return;
  const body = RequestTakeUploadBody.safeParse(req.body);
  if (!body.success || !validTakeFile(body.data.fileName, body.data.contentType, body.data.size)) {
    res.status(400).json({ error: "Use PDF, TXT or DOCX up to 25 MB, or MP4/WebM up to 250 MB." }); return;
  }
  const uploadUrl = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadUrl);
  if (!/^\/objects\/uploads\/[a-f0-9-]+$/.test(objectPath)) throw new Error("Invalid storage upload path");
  const uploadId = randomUUID();
  await db.insert(takeUploads).values({ id: uploadId, ownerId, objectPath, ...body.data });
  res.json({ uploadId, uploadUrl });
}));
router.post("/takes", guarded(async (req, res) => {
  const ownerId = ownerWrite(req, res);
  if (!ownerId) return;
  const body = CreateGameTakeBody.safeParse(req.body);
  if (!body.success || !body.data.title.trim()) {
    res.status(400).json({ error: "A title, sport and completed upload are required." }); return;
  }
  const [upload] = await db.select().from(takeUploads).where(and(eq(takeUploads.id, body.data.uploadId), eq(takeUploads.ownerId, ownerId)));
  const [published] = await db.select({ id: gameTakes.id }).from(gameTakes).where(eq(gameTakes.uploadId, body.data.uploadId));
  if (!upload || published) { res.status(400).json({ error: "This upload is unavailable or already published." }); return; }
  // Publishing requires an upload ticket belonging to the verified owner, a
  // completed file, matching byte length/type and basic format signatures.
  let file;
  try { file = await storage.getObjectEntityFile(upload.objectPath); }
  catch { res.status(400).json({ error: "The upload has not completed. Finish uploading before publishing." }); return; }
  const [metadata] = await file.getMetadata();
  const [prefix] = await file.download({ start: 0, end: Math.min(upload.size - 1, 63) });
  if (Number(metadata.size) !== upload.size || metadata.contentType !== upload.contentType ||
      !validTakeSignature(upload.contentType, prefix)) {
    res.status(400).json({ error: "The uploaded file does not match its declared size or format." }); return;
  }
  await storage.trySetObjectEntityAclPolicy(upload.objectPath, { owner: ownerId, visibility: "private" });
  const id = randomUUID();
  const { uploadId, ...input } = body.data;
  await db.insert(gameTakes).values({ id, ownerId, uploadId, ...input, title: input.title.trim() });
  const [take] = await selectTakes().where(eq(gameTakes.id, id));
  res.status(201).json(CreateGameTakeResponse.parse(take));
}));
router.patch("/takes/:id", guarded(async (req, res) => {
  if (!ownerWrite(req, res)) return;
  const params = UpdateGameTakeParams.safeParse(req.params);
  const body = UpdateGameTakeBody.safeParse(req.body);
  if (!params.success || !body.success || !body.data.title.trim()) {
    res.status(400).json({ error: "Check the take title and sport." }); return;
  }
  const rows = await db.update(gameTakes).set({ ...body.data, title: body.data.title.trim() }).where(eq(gameTakes.id, params.data.id)).returning({ id: gameTakes.id });
  if (!rows.length) { res.status(404).json({ error: "Take not found." }); return; }
  const [take] = await selectTakes().where(eq(gameTakes.id, params.data.id));
  res.json(CreateGameTakeResponse.parse(take));
}));
router.delete("/takes/:id", guarded(async (req, res) => {
  if (!ownerWrite(req, res)) return;
  const params = DeleteGameTakeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid take." }); return; }
  const [row] = await db.select({ uploadId: gameTakes.uploadId, objectPath: takeUploads.objectPath })
    .from(gameTakes).innerJoin(takeUploads, eq(gameTakes.uploadId, takeUploads.id)).where(eq(gameTakes.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Take not found." }); return; }
  const file = await storage.getObjectEntityFile(row.objectPath);
  await file.delete({ ignoreNotFound: true });
  await db.transaction(async tx => {
    await tx.delete(gameTakes).where(eq(gameTakes.id, params.data.id));
    await tx.delete(takeUploads).where(eq(takeUploads.id, row.uploadId));
  });
  res.status(204).end();
}));
router.get("/takes/:id/file", guarded(async (req, res) => {
  if (!await hasProjectionAccess(getAuth(req).userId)) {
    res.status(403).json({ error: "Active ALLPLAY membership is required to view this file." }); return;
  }
  const params = GetGameTakeFileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid take." }); return; }
  const [row] = await db.select().from(gameTakes).innerJoin(takeUploads, eq(gameTakes.uploadId, takeUploads.id)).where(eq(gameTakes.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Take not found." }); return; }
  const upload = row.take_uploads;
  const file = await storage.getObjectEntityFile(upload.objectPath);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== upload.size || metadata.contentType !== upload.contentType) {
    res.status(409).json({ error: "This file has changed and cannot be served." }); return;
  }
  const disposition = upload.contentType.endsWith("wordprocessingml.document") ? "attachment" : "inline";
  res.set({
    "Content-Type": upload.contentType,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(upload.fileName)}`,
    "Accept-Ranges": "bytes",
    "Content-Security-Policy": "sandbox",
  });
  const rangeHeader = req.get("range");
  const range = rangeHeader ? parseTakeRange(rangeHeader, upload.size) : undefined;
  if (rangeHeader && !range) {
    res.set("Content-Range", `bytes */${upload.size}`).status(416).end(); return;
  }
  if (range) res.status(206).set({
    "Content-Range": `bytes ${range.start}-${range.end}/${upload.size}`,
    "Content-Length": String(range.end - range.start + 1),
  });
  else res.set("Content-Length", String(upload.size));
  const stream = file.createReadStream(range ? { start: range.start, end: range.end } : {});
  stream.on("error", err => { req.log.error({ err }, "Take file stream failed"); res.destroy(); });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}));
export default router;
