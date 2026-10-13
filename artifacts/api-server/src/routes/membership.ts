import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, membershipCheckouts } from "@workspace/db";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { getWhopClient } from "../lib/whopClient";
import {
  clearMembershipCache, freeMembership, getVerifiedMembership, membershipConfig,
  unavailableMembership, whopUrl,
} from "../lib/membership";

const router = Router();
router.use("/membership", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie");
  next();
});

function authenticatedOrigin(req: Request, res: Response): { userId: string; origin: string } | null {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to manage membership." }); return null; }
  try {
    const origin = new URL(req.get("origin") ?? "");
    if (origin.host !== getClerkProxyHost(req) ||
        !["https:", "http:"].includes(origin.protocol) ||
        (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) {
      throw new Error("Invalid origin");
    }
    return { userId, origin: origin.origin };
  } catch {
    res.status(403).json({ error: "Open ALLPLAY and retry this action from your account page." });
    return null;
  }
}

router.get("/membership", async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.json(freeMembership(false)); return; }
  try { res.json((await getVerifiedMembership(userId, true)).status); }
  catch {
    clearMembershipCache(userId);
    req.log.warn("Membership verification unavailable");
    res.json(unavailableMembership(true));
  }
});

router.post("/membership/checkout", async (req, res) => {
  const auth = authenticatedOrigin(req, res);
  if (!auth) return;
  try {
    const config = membershipConfig();
    if (!config.companyId || !config.planId || !config.productId) throw new Error("Membership not configured");
    const current = await getVerifiedMembership(auth.userId, true);
    if (current.status.hasAccess) {
      res.status(409).json({ error: "Your account already has projection access." }); return;
    }
    const whop = await getWhopClient();
    const plan = await whop.plans.retrieve(config.planId);
    // Keep the fee the user approved. Refuse checkout if provider pricing drifts.
    const product = plan.product as { id?: string } | null;
    if (product?.id !== config.productId || plan.currency !== "usd" ||
        plan.plan_type !== "renewal" || plan.billing_period !== 30 ||
        plan.initial_price !== 0 || plan.renewal_price !== 1.99) {
      throw new Error("Membership plan differs from the approved price");
    }
    const purchaseUrl = await db.transaction(async (tx) => {
      // Serialize checkout creation per account, preventing duplicate paid checkouts
      // from double-clicks or two browser tabs. Reuse a recent pending checkout.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${auth.userId}))`);
      const [recent] = await tx.select().from(membershipCheckouts)
        .where(eq(membershipCheckouts.userId, auth.userId))
        .orderBy(sql`${membershipCheckouts.createdAt} DESC`).limit(1);
      if (recent && Date.now() - recent.createdAt.getTime() < 20 * 60 * 1000) {
        return recent.purchaseUrl;
      }
      const checkout = await whop.checkoutConfigurations.create({
        plan_id: config.planId,
        redirect_url: `${auth.origin}/account?checkout=returned`,
      });
      const url = whopUrl(checkout.purchase_url);
      if (!url) throw new Error("Whop did not return a secure checkout URL");
      await tx.insert(membershipCheckouts).values({
        checkoutId: checkout.id, userId: auth.userId, purchaseUrl: url,
      });
      return url;
    });
    clearMembershipCache(auth.userId);
    res.json({ purchaseUrl });
  } catch {
    req.log.warn("Whop checkout unavailable");
    res.status(503).json({ error: "Checkout is temporarily unavailable. No purchase was completed here. Please retry." });
  }
});

router.post("/membership/cancel", async (req, res) => {
  const auth = authenticatedOrigin(req, res);
  if (!auth) return;
  try {
    // A pre-existing paid subscription remains separately cancellable even if
    // the account subsequently receives owner access.
    const current = await getVerifiedMembership(auth.userId, true, true);
    if (!current.membershipId) { res.status(404).json({ error: "No linked membership was found." }); return; }
    const whop = await getWhopClient();
    // Include the canonical flag and the SDK's legacy equivalent. Both API
    // versions must stop renewal rather than revoke paid-through access.
    const cancelOptions = { cancellation_mode: "at_period_end" as const, cancel_at_period_end: true };
    await whop.memberships.cancel(current.membershipId, cancelOptions);
    clearMembershipCache(auth.userId);
    res.json((await getVerifiedMembership(auth.userId, true)).status);
  } catch {
    clearMembershipCache(auth.userId);
    req.log.warn("Whop cancellation unavailable");
    res.status(503).json({ error: "We could not confirm cancellation. Please retry or manage the subscription through Whop." });
  }
});

export default router;
