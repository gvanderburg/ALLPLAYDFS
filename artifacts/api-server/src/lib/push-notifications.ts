import { createECDH, createHash, hkdfSync } from "node:crypto";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pushNotificationReceipts,
  pushSubscriptions,
} from "@workspace/db";
import { logger } from "./logger";
import { getOwnerUserIds } from "./owner-access";

type NotificationKind = "signup" | "membership";

const p256Order = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);

function getVapidKeys() {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error("SESSION_SECRET is required for owner push alerts");

  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      sessionSecret,
      Buffer.from("ALLPLAY web push"),
      Buffer.from(`VAPID P-256 key v1:${environment}`),
      32,
    ),
  );
  const scalar = (BigInt(`0x${derived.toString("hex")}`) % (p256Order - 1n)) + 1n;
  const privateKey = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(privateKey);
  const publicKey = curve.getPublicKey().toString("base64url");
  const encodedPrivateKey = privateKey.toString("base64url");

  webpush.setVapidDetails(
    process.env.ALLPLAY_VAPID_SUBJECT || "https://replit.com/",
    publicKey,
    encodedPrivateKey,
  );
  return publicKey;
}

export function getPushPublicKey() {
  return getVapidKeys();
}

export async function getOwnerDeviceCount(userId: string) {
  const rows = await db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows.length;
}

export async function saveOwnerPushSubscription(
  userId: string,
  subscription: WebPushSubscription,
) {
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: subscription.endpoint,
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        updatedAt: new Date(),
      },
    });
}

export async function removeOwnerPushSubscription(userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
}

export async function notifyOwners(
  kind: NotificationKind,
  sourceId: string,
): Promise<boolean> {
  const ownerIds = getOwnerUserIds();
  if (!ownerIds.length) return false;

  const eventKey = createHash("sha256")
    .update(`allplay:${kind}:${sourceId}`)
    .digest("hex");
  const inserted = await db
    .insert(pushNotificationReceipts)
    .values({ eventKey, eventType: kind })
    .onConflictDoNothing()
    .returning({ eventKey: pushNotificationReceipts.eventKey });
  if (!inserted.length) return false;

  const targets = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, ownerIds));
  if (!targets.length) return true;

  getVapidKeys();
  const payload = JSON.stringify({
    title: kind === "signup" ? "New ALLPLAY signup" : "New ALLPLAY membership",
    body: kind === "signup"
      ? "A new account just signed up."
      : "A new paid membership was verified.",
    url: "/account",
  });

  await Promise.all(targets.map(async (target) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        { TTL: 60 * 60 },
      );
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removeOwnerPushSubscription(target.userId, target.endpoint).catch(() => undefined);
      }
      logger.warn({ statusCode }, "Could not deliver an ALLPLAY owner push notification");
    }
  }));
  return true;
}
