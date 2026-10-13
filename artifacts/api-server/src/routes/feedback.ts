import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, feedbackTickets, type FeedbackTicketRow } from "@workspace/db";
import {
  CreateFeedbackTicketBody, UpdateFeedbackTicketBody, UpdateFeedbackTicketParams,
  ListFeedbackTicketsQueryParams, ListFeedbackTicketsResponse, CreateFeedbackTicketResponse,
} from "@workspace/api-zod";
import { isOwnerAccount } from "../lib/owner-access";

const publicTicket = ({ reporterId: _privateIdentity, ...ticket }: FeedbackTicketRow) =>
  CreateFeedbackTicketResponse.parse(ticket);
const cleanText = (value: unknown) => typeof value === "string" ? value.trim() : value;

/** Dependency injection is for isolated HTTP tests; production always uses verified Clerk auth. */
export function createFeedbackRouter(auth = {
  userId: (req: Request) => getAuth(req).userId,
  owner: isOwnerAccount,
}) {
  const router = Router();
  const guarded = (handler: (req: Request, res: Response, userId: string) => Promise<void>) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "private, no-store").vary("Cookie").vary("Authorization");
      try {
        const userId = auth.userId(req);
        if (!userId) { res.status(401).json({ error: "Sign in to submit or view feedback. No paid membership is required." }); return; }
        await handler(req, res, userId);
      } catch (err) {
        req.log?.error({ err }, "Feedback request failed");
        if (!res.headersSent) res.status(503).json({ error: "Feedback is temporarily unavailable. Your submission was not confirmed; please retry." });
        else res.destroy();
      }
    };

  router.get("/feedback", guarded(async (req, res, userId) => {
    const query = ListFeedbackTicketsQueryParams.safeParse({
      ...req.query, before: req.query.before === undefined ? undefined : Number(req.query.before),
    });
    if (!query.success) { res.status(400).json({ error: "Invalid ticket scope or page cursor." }); return; }
    const isOwner = auth.owner(userId);
    if (query.data.scope === "all" && !isOwner) { res.status(403).json({ error: "Owner access is required to view all tickets." }); return; }
    const rows = await db.select().from(feedbackTickets).where(and(
      query.data.scope === "all" ? undefined : eq(feedbackTickets.reporterId, userId),
      query.data.before === undefined ? undefined : lt(feedbackTickets.id, query.data.before),
    )).orderBy(desc(feedbackTickets.id)).limit(51);
    const items = rows.slice(0, 50);
    res.json(ListFeedbackTicketsResponse.parse({
      isOwner, items: items.map(publicTicket), nextCursor: rows.length > 50 ? items.at(-1)!.id : null,
    }));
  }));

  router.post("/feedback", guarded(async (req, res, userId) => {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const input = CreateFeedbackTicketBody.safeParse({
      ...body, subject: cleanText(body.subject), details: cleanText(body.details),
      contextPath: body.contextPath == null || body.contextPath === "" ? null : cleanText(body.contextPath),
    });
    if (!input.success) { res.status(400).json({ error: "Choose a feedback type, enter a 3–120 character subject and 10–4,000 character description. Affected pages must be simple paths such as /projections." }); return; }
    const ticket = await db.transaction(async tx => {
      // Atomic per-account quota: concurrent requests cannot race past the limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
      const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(feedbackTickets).where(and(
        eq(feedbackTickets.reporterId, userId), gte(feedbackTickets.createdAt, new Date(Date.now() - 3600_000)),
      ));
      if (usage.count >= 5) return null;
      const [saved] = await tx.insert(feedbackTickets).values({
        reporterId: userId, category: input.data.category, subject: input.data.subject, details: input.data.details,
        sport: input.data.sport ?? null, contextPath: input.data.contextPath ?? null,
        status: "open", ownerResponse: "",
      }).returning();
      return saved;
    });
    if (!ticket) { res.set("Retry-After", "3600").status(429).json({ error: "You can submit up to five tickets per hour. Please try again later." }); return; }
    res.status(201).json(publicTicket(ticket));
  }));

  router.patch("/feedback/:ticketId", guarded(async (req, res, userId) => {
    if (!auth.owner(userId)) { res.status(403).json({ error: "Only the owner can update ticket status or responses." }); return; }
    const params = UpdateFeedbackTicketParams.safeParse({ ticketId: Number(req.params.ticketId) });
    const input = UpdateFeedbackTicketBody.safeParse({ ...req.body, ownerResponse: cleanText(req.body?.ownerResponse) });
    if (!params.success || !input.success) { res.status(400).json({ error: "Choose a valid status and a response of at most 2,000 characters." }); return; }
    const [updated] = await db.update(feedbackTickets).set({
      status: input.data.status, ownerResponse: input.data.ownerResponse, updatedAt: new Date(),
    }).where(eq(feedbackTickets.id, params.data.ticketId)).returning();
    if (!updated) { res.status(404).json({ error: "Ticket not found." }); return; }
    res.json(publicTicket(updated));
  }));
  return router;
}
export default createFeedbackRouter();
