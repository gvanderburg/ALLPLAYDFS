import { Router, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { SubscribePushNotificationsBody, UnsubscribePushNotificationsBody } from "@workspace/api-zod";
import { isOwnerAccount } from "../lib/owner-access";
import {
  getOwnerDeviceCount,
  getPushPublicKey,
  notifyOwners,
  removeOwnerPushSubscription,
  saveOwnerPushSubscription,
} from "../lib/push-notifications";

const router = Router();
const signupWindowMs = 24 * 60 * 60 * 1000;

function sameOriginRequest(req: Request) {
  const origin = req.get("origin");
  if (!origin) return false;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  try {
    const parsed = new URL(origin);
    return parsed.host === host
      && (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function withPrivateHeaders(res: Response) {
  res.set("Cache-Control", "private, no-store").vary("Cookie").vary("Authorization");
}

router.get("/notifications/status", async (req, res) => {
  withPrivateHeaders(res);
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!isOwnerAccount(userId)) {
    res.json({ isOwner: false, isSupported: false, deviceCount: 0, publicKey: null });
    return;
  }

  try {
    res.json({
      isOwner: true,
      isSupported: true,
      deviceCount: await getOwnerDeviceCount(userId),
      publicKey: getPushPublicKey(),
    });
  } catch (error) {
    req.log?.error({ error }, "Could not load owner push notification settings");
    res.status(503).json({ error: "Phone alerts are temporarily unavailable." });
  }
});

router.post("/notifications/subscribe", async (req, res) => {
  withPrivateHeaders(res);
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!isOwnerAccount(userId)) {
    res.status(403).json({ error: "Owner access required." });
    return;
  }
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "This request must come from ALLPLAY." });
    return;
  }

  const parsed = SubscribePushNotificationsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push subscription." });
    return;
  }
  try {
    const endpoint = new URL(parsed.data.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.hostname === "localhost" || endpoint.hostname.endsWith(".local")) {
      res.status(400).json({ error: "Unsupported push endpoint." });
      return;
    }
    getPushPublicKey();
    await saveOwnerPushSubscription(userId, parsed.data);
    res.json({ ok: true });
  } catch (error) {
    req.log?.error({ error }, "Could not save owner push subscription");
    res.status(503).json({ error: "Could not enable phone alerts. Please try again." });
  }
});

router.delete("/notifications/subscribe", async (req, res) => {
  withPrivateHeaders(res);
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!isOwnerAccount(userId)) {
    res.status(403).json({ error: "Owner access required." });
    return;
  }
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "This request must come from ALLPLAY." });
    return;
  }

  const parsed = UnsubscribePushNotificationsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push endpoint." });
    return;
  }
  try {
    await removeOwnerPushSubscription(userId, parsed.data.endpoint);
    res.status(204).end();
  } catch (error) {
    req.log?.error({ error }, "Could not remove owner push subscription");
    res.status(503).json({ error: "Could not disable phone alerts. Please try again." });
  }
});

router.post("/notifications/signup-event", async (req, res) => {
  withPrivateHeaders(res);
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "This request must come from ALLPLAY." });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const createdAt = user.createdAt;
    const now = Date.now();
    const isRecent = typeof createdAt === "number"
      && Number.isFinite(createdAt)
      && createdAt <= now
      && now - createdAt <= signupWindowMs;
    const accepted = isRecent ? await notifyOwners("signup", userId) : false;
    res.json({ accepted });
  } catch (error) {
    req.log?.warn({ error }, "Could not verify a recent ALLPLAY signup");
    res.status(503).json({ error: "Signup notification could not be checked." });
  }
});

export default router;
