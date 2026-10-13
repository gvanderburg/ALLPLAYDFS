import { desc, eq } from "drizzle-orm";
import { db, membershipBindings, membershipCheckouts } from "@workspace/db";
import type { MembershipStatus } from "@workspace/api-zod";
import { getWhopClient } from "./whopClient";
import { isOwnerAccount } from "./owner-access";

export const membershipConfig = () => ({
  companyId: process.env.WHOP_COMPANY_ID,
  planId: process.env.WHOP_PLAN_ID,
  productId: process.env.WHOP_PRODUCT_ID,
});

type VerifiedMembership = {
  status: MembershipStatus;
  membershipId: string | null;
};
const accessCache = new Map<string, { expiresAt: number; value: VerifiedMembership }>();

export function clearMembershipCache(userId: string) {
  accessCache.delete(userId);
}

export function freeMembership(signedIn: boolean): MembershipStatus {
  const config = membershipConfig();
  return {
    signedIn, hasAccess: false, isOwner: false,
    ready: Boolean(config.companyId && config.planId && config.productId),
    status: "free", price: 1.99, currency: "usd", interval: "month",
    cancelAtPeriodEnd: false, renewsAt: null, manageUrl: null, error: null,
  };
}

export function unavailableMembership(signedIn: boolean): MembershipStatus {
  return {
    ...freeMembership(signedIn), status: "unavailable", ready: false,
    error: "Membership verification is temporarily unavailable. Please retry. Projections remain locked until access can be verified.",
  };
}

function whopUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "whop.com" || parsed.hostname.endsWith(".whop.com"))
      ? url : null;
  } catch { return null; }
}

export async function getVerifiedMembership(userId: string, refresh = false, paidOnly = false): Promise<VerifiedMembership> {
  // Check every time, before both provider configuration and the paid cache.
  // Owner grants aren't cached, so removing an ID revokes the bypass immediately.
  if (!paidOnly && isOwnerAccount(userId)) {
    return {
      membershipId: null,
      status: { ...freeMembership(true), isOwner: true, hasAccess: true,
        ready: true, status: "owner", price: 0 },
    };
  }
  const cached = accessCache.get(userId);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const config = membershipConfig();
  if (!config.companyId || !config.planId || !config.productId) {
    return { status: unavailableMembership(true), membershipId: null };
  }
  const [binding] = await db.select().from(membershipBindings).where(eq(membershipBindings.userId, userId));
  const checkouts = await db.select().from(membershipCheckouts)
    .where(eq(membershipCheckouts.userId, userId)).orderBy(desc(membershipCheckouts.createdAt)).limit(5);
  if (!binding && !checkouts.length) return { status: freeMembership(true), membershipId: null };
  const whop = await getWhopClient();

  async function verify(membershipId: string, expectedWhopUserId: string): Promise<VerifiedMembership> {
    const membership = await whop.memberships.retrieve(membershipId);
    if (membership.company.id !== config.companyId ||
        membership.plan.id !== config.planId ||
        membership.product.id !== config.productId ||
        membership.user?.id !== expectedWhopUserId) {
      throw new Error("Whop membership identity or product mismatch.");
    }
    const access = await whop.users.checkAccess(config.productId!, { id: expectedWhopUserId });
    const hasAccess = access.has_access &&
      membership.status !== "canceled" && membership.status !== "expired";
    return {
      membershipId,
      status: {
        ...freeMembership(true), hasAccess, status: membership.status,
        cancelAtPeriodEnd: membership.cancel_at_period_end,
        renewsAt: membership.renewal_period_end,
        manageUrl: whopUrl(membership.manage_url),
      },
    };
  }

  let verified: VerifiedMembership = { status: freeMembership(true), membershipId: null };
  if (binding) verified = await verify(binding.membershipId, binding.whopUserId);
  if (!verified.status.hasAccess && checkouts.length) {
    // These IDs come only from server-created checkouts owned by this authenticated
    // account. Neither a client-supplied receipt nor matching emails prove a purchase.
    const ids = checkouts.map((checkout) => checkout.checkoutId);
    const payments = await whop.payments.list({
      company_id: config.companyId, checkout_configuration_ids: ids, first: 100,
    });
    for (const payment of payments.data) {
      if (payment.status !== "paid" || !payment.paid_at ||
          !payment.checkout_configuration_id || !ids.includes(payment.checkout_configuration_id) ||
          payment.company?.id !== config.companyId || payment.plan?.id !== config.planId ||
          !payment.membership?.id || !payment.user?.id) continue;
      const candidate = await verify(payment.membership.id, payment.user.id);
      if (!candidate.status.hasAccess) continue;
      // A provider membership may be linked to only one ALLPLAY account. The
      // unique DB constraint also protects against concurrent binding attempts.
      await db.insert(membershipBindings).values({
        userId, membershipId: payment.membership.id, whopUserId: payment.user.id,
      }).onConflictDoUpdate({
        target: membershipBindings.userId,
        set: { membershipId: payment.membership.id, whopUserId: payment.user.id, updatedAt: new Date() },
      });
      verified = candidate;
      break;
    }
    if (!verified.membershipId) verified.status.status = "pending";
  }
  // This short, identity-keyed cache is never used after errors or cancellation.
  // Public dashboard caches retain only raw server data; every response is gated.
  if (accessCache.size > 1000) accessCache.clear();
  accessCache.set(userId, { expiresAt: Date.now() + 15_000, value: verified });
  return verified;
}

export async function hasProjectionAccess(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try { return (await getVerifiedMembership(userId)).status.hasAccess; }
  catch { clearMembershipCache(userId); return false; }
}

export { whopUrl };
