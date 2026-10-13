import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Whop from "@whop/sdk";

// Isolate only I/O at build time. These tests exercise production entitlement
// and response-gating code without charging a card or enabling a test bypass.
const dir = await mkdtemp(join(tmpdir(), "allplay-membership-"));
after(async () => { await rm(dir, { recursive: true, force: true }); });
globalThis.__membershipRows = { bindings: [], checkouts: [] };
const mockDb = `
const state = () => globalThis.__membershipRows;
export const membershipBindings = { kind: "bindings", userId: "userId" };
export const membershipCheckouts = { kind: "checkouts", userId: "userId", createdAt: "createdAt" };
export const db = {
  select() {
    let rows = [];
    const query = {
      from(table) { rows = [...state()[table.kind]]; return query; },
      where(filter) { rows = rows.filter(row => row[filter.column] === filter.value); return query; },
      orderBy() { rows.sort((a,b) => b.createdAt - a.createdAt); return query; },
      limit(n) { rows = rows.slice(0,n); return query; },
      then(resolve,reject) { return Promise.resolve(rows).then(resolve,reject); }
    };
    return query;
  },
  insert() { return { values(value) { return { async onConflictDoUpdate() {
    const conflict = state().bindings.find(row => row.membershipId === value.membershipId && row.userId !== value.userId);
    if (conflict) throw new Error("unique membership constraint");
    state().bindings = state().bindings.filter(row => row.userId !== value.userId);
    state().bindings.push(value);
  } }; } }; }
};`;
await build({
  entryPoints: ["src/lib/membership.ts"], outfile: join(dir, "membership.mjs"),
  absWorkingDir: new URL("../", import.meta.url).pathname,
  bundle: true, platform: "node", format: "esm",
  define: {
    "process.env.WHOP_COMPANY_ID": '"biz_test"',
    "process.env.WHOP_PRODUCT_ID": '"prod_test"',
    "process.env.WHOP_PLAN_ID": '"plan_test"',
  },
  plugins: [{
    name: "test-io",
    setup(b) {
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "orm", namespace: "fixture" }));
      b.onResolve({ filter: /whopClient$/ }, () => ({ path: "whop", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "db" ? mockDb : path === "orm"
          ? "export const eq=(column,value)=>({column,value}); export const desc=x=>x;"
          : "export async function getWhopClient(){ return globalThis.__whopFixture; }",
        loader: "js",
      }));
    },
  }],
});
await build({
  entryPoints: ["src/lib/projection-access.ts"], outfile: join(dir, "gate.mjs"),
  absWorkingDir: new URL("../", import.meta.url).pathname,
  bundle: true, platform: "node", format: "esm",
});
const member = await import(join(dir, "membership.mjs"));
const { gateDashboardProjections } = await import(join(dir, "gate.mjs"));
const now = new Date();
const validMembership = {
  id: "mem_test", company: { id: "biz_test" }, plan: { id: "plan_test" },
  product: { id: "prod_test" }, user: { id: "user_whop" }, status: "active",
  cancel_at_period_end: false, renewal_period_end: "2026-11-13T08:00:00.000Z",
  manage_url: "https://whop.com/orders/",
};
const paidReceipt = {
  status: "paid", paid_at: now.toISOString(), checkout_configuration_id: "ch_owned",
  company: { id: "biz_test" }, plan: { id: "plan_test" },
  membership: { id: "mem_test" }, user: { id: "user_whop" },
};
function fixture({ receipt = paidReceipt, membership = validMembership, access = true, checkouts = true } = {}) {
  globalThis.__membershipRows = {
    bindings: [],
    checkouts: checkouts ? [{ checkoutId: "ch_owned", userId: "account-a", createdAt: now }] : [],
  };
  globalThis.__whopFixture = {
    payments: { async list() { return { data: receipt ? [receipt] : [] }; } },
    memberships: { async retrieve() { return membership; } },
    users: { async checkAccess() { return { has_access: access }; } },
  };
  member.clearMembershipCache("account-a");
  member.clearMembershipCache("account-b");
}

test("public API removes forecasts and unknown premium fields without mutating the member cache", () => {
  const raw = { projections: [
    { id: "a", name: "A", sport: "nfl", salary: 2000, projection: 99, projectionType: "daily", source: "ESPN", secretForecast: 88 },
    { id: "b", name: "B", sport: "nfl", salary: 9000, projection: 11, projectionType: "daily", source: "ESPN" },
  ], events: [{ id: "game" }], news: [{ id: "headline" }] };
  const free = gateDashboardProjections(raw, false);
  assert.equal(free.projectionsLocked, true);
  assert.deepEqual(free.projections.map(p => p.projection), [null, null]);
  assert.deepEqual(free.projections.map(p => p.id), ["b", "a"]);
  assert.equal("secretForecast" in free.projections[1], false);
  assert.equal(raw.projections[0].projection, 99);
  assert.equal(gateDashboardProjections(raw, true).projections[0].projection, 99);
  assert.deepEqual(free.events, raw.events);
  assert.deepEqual(free.news, raw.news);
});

test("owned paid checkout + matching provider membership + provider access creates a durable binding", async () => {
  fixture();
  const result = await member.getVerifiedMembership("account-a", true);
  assert.equal(result.status.hasAccess, true);
  assert.equal(globalThis.__membershipRows.bindings[0].membershipId, "mem_test");
});

test("another account cannot claim the paid checkout", async () => {
  fixture();
  assert.equal((await member.getVerifiedMembership("account-b", true)).status.hasAccess, false);
  assert.equal(globalThis.__membershipRows.bindings.length, 0);
});

test("a checkout return alone cannot unlock access", async () => {
  fixture({ receipt: null });
  const result = await member.getVerifiedMembership("account-a", true);
  assert.equal(result.status.hasAccess, false);
  assert.equal(result.status.status, "pending");
});

for (const [name, receipt] of [
  ["unowned receipt", { ...paidReceipt, checkout_configuration_id: "ch_someone_else" }],
  ["wrong plan", { ...paidReceipt, plan: { id: "plan_other" } }],
  ["wrong merchant", { ...paidReceipt, company: { id: "biz_other" } }],
  ["unpaid receipt", { ...paidReceipt, status: "pending" }],
]) {
  test(`${name} cannot unlock or bind`, async () => {
    fixture({ receipt });
    assert.equal((await member.getVerifiedMembership("account-a", true)).status.hasAccess, false);
    assert.equal(globalThis.__membershipRows.bindings.length, 0);
  });
}
test("provider denial overrides a paid receipt", async () => {
  fixture({ access: false });
  assert.equal((await member.getVerifiedMembership("account-a", true)).status.hasAccess, false);
});
test("wrong product or membership identity fails closed", async () => {
  fixture({ membership: { ...validMembership, product: { id: "prod_other" } } });
  assert.equal(await member.hasProjectionAccess("account-a"), false);
});
test("period-end cancellation keeps access, expired membership does not", async () => {
  fixture({ membership: { ...validMembership, cancel_at_period_end: true } });
  const paidThrough = await member.getVerifiedMembership("account-a", true);
  assert.equal(paidThrough.status.hasAccess, true);
  assert.equal(paidThrough.status.cancelAtPeriodEnd, true);
  fixture({ membership: { ...validMembership, status: "expired" }, access: false });
  assert.equal(await member.hasProjectionAccess("account-a"), false);
});
test("provider failure and signed-out callers cannot receive forecasts", async () => {
  fixture();
  globalThis.__whopFixture.payments.list = async () => { throw new Error("provider unavailable"); };
  assert.equal(await member.hasProjectionAccess("account-a"), false);
  assert.equal(await member.hasProjectionAccess(null), false);
});
test("SDK cancellation wire payload preserves both period-end flags, without calling Whop", async () => {
  let sent;
  const client = new Whop({
    apiKey: "test-only-not-a-real-credential",
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify(validMembership), { headers: { "content-type": "application/json" } });
    },
  });
  const options = { cancellation_mode: "at_period_end", cancel_at_period_end: true };
  await client.memberships.cancel("mem_test", options);
  assert.equal(sent.cancellation_mode, "at_period_end");
  assert.equal(sent.cancel_at_period_end, true);
});
test("only the exact server-configured owner ID bypasses payment verification", async () => {
  fixture({ checkouts: false });
  process.env.ALLPLAY_OWNER_USER_IDS = " user_ownerFixture, user_otherFixture ";
  try {
    globalThis.__whopFixture.payments.list = async () => { throw new Error("Must not call Whop for owner access"); };
    const result = await member.getVerifiedMembership("user_ownerFixture", true);
    assert.equal(result.status.isOwner, true);
    assert.equal(result.status.hasAccess, true);
    assert.equal(result.status.ready, true);
    assert.equal(result.status.price, 0);
    assert.equal(result.membershipId, null);
    assert.equal(await member.hasProjectionAccess("user_ownerFixture"), true);
    assert.equal(await member.hasProjectionAccess("user_ownerFixtureExtra"), false);
    assert.equal(await member.hasProjectionAccess(null), false);
    assert.equal((await member.getVerifiedMembership("user_ownerFixture", true, true)).status.hasAccess, false);
  } finally { delete process.env.ALLPLAY_OWNER_USER_IDS; }
});
test("owner removal immediately revokes the bypass and wildcard grants are rejected", async () => {
  fixture({ checkouts: false });
  process.env.ALLPLAY_OWNER_USER_IDS = "user_ownerFixture";
  assert.equal(await member.hasProjectionAccess("user_ownerFixture"), true);
  delete process.env.ALLPLAY_OWNER_USER_IDS;
  assert.equal(await member.hasProjectionAccess("user_ownerFixture"), false);
  process.env.ALLPLAY_OWNER_USER_IDS = "*";
  try { assert.equal(await member.hasProjectionAccess("user_ownerFixture"), false); }
  finally { delete process.env.ALLPLAY_OWNER_USER_IDS; }
});
