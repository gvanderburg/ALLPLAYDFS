import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "allplay-notifications-"));
const entry = `
  export { default as notificationsRouter } from "./src/routes/notifications";
  export {
    notifyOwners, saveOwnerPushSubscription
  } from "./src/lib/push-notifications";
  export { db, pushSubscriptions, pushNotificationReceipts } from "@workspace/db";
`;
const dbFixture = `
const state = () => globalThis.__notificationRows;
export const pushSubscriptions = {
  table: "subscriptions",
  endpoint: { table: "subscriptions", name: "endpoint" },
  userId: { table: "subscriptions", name: "userId" },
  p256dh: { table: "subscriptions", name: "p256dh" },
  auth: { table: "subscriptions", name: "auth" },
};
export const pushNotificationReceipts = {
  table: "receipts",
  eventKey: { table: "receipts", name: "eventKey" },
  eventType: { table: "receipts", name: "eventType" },
};
const matches = (row, filter) => {
  if (!filter) return true;
  if (filter.op === "and") return filter.filters.every(f => matches(row, f));
  if (filter.op === "eq") return row[filter.column.name] === filter.value;
  if (filter.op === "in") return filter.values.includes(row[filter.column.name]);
  return false;
};
export const db = {
  select() {
    let table, filter;
    const query = {
      from(value) { table = value.table; return query; },
      where(value) { filter = value; return query; },
      then(resolve, reject) {
        return Promise.resolve(state()[table].filter(row => matches(row, filter))).then(resolve, reject);
      },
    };
    return query;
  },
  insert(table) {
    return { values(value) {
      return {
        async onConflictDoUpdate() {
          if (table.table === "subscriptions") {
            const index = state().subscriptions.findIndex(row => row.endpoint === value.endpoint);
            if (index < 0) state().subscriptions.push(value);
            else state().subscriptions[index] = value;
          }
        },
        onConflictDoNothing() {
          return { returning: async () => {
            if (state().receipts.some(row => row.eventKey === value.eventKey)) return [];
            state().receipts.push(value);
            return [{ eventKey: value.eventKey }];
          } };
        },
      };
    } };
  },
  delete(table) {
    return { where: async filter => {
      state()[table.table] = state()[table.table].filter(row => !matches(row, filter));
    } };
  },
};
`;

globalThis.__notificationRows = { subscriptions: [], receipts: [] };
globalThis.__notificationLog = [];
globalThis.__sentPushes = [];
globalThis.__clerkUsers = {};
globalThis.__deadPushEndpoint = null;

await build({
  stdin: { contents: entry, resolveDir: new URL("../", import.meta.url).pathname },
  outfile: join(dir, "notifications.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  plugins: [{
    name: "isolated-notification-services",
    setup(build) {
      build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      build.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "orm", namespace: "fixture" }));
      build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "fixture" }));
      build.onResolve({ filter: /^@workspace\/api-zod$/ }, () => ({ path: "schemas", namespace: "fixture" }));
      build.onResolve({ filter: /^web-push$/ }, () => ({ path: "webpush", namespace: "fixture" }));
      build.onResolve({ filter: /owner-access$/ }, () => ({ path: "owner", namespace: "fixture" }));
      build.onResolve({ filter: /logger$/ }, () => ({ path: "logger", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "db" ? dbFixture
          : path === "orm" ? `
            export const eq=(column,value)=>({op:"eq",column,value});
            export const and=(...filters)=>({op:"and",filters});
            export const inArray=(column,values)=>({op:"in",column,values});
          `
          : path === "clerk" ? `
            export const getAuth=req=>({userId:req.get("x-test-user")||null});
            export const clerkClient={users:{getUser:async id=>{
              const user=globalThis.__clerkUsers[id];
              if(!user) throw new Error("Missing fixture user");
              return user;
            }}};
          `
          : path === "schemas" ? `
            const validSubscription = value => Boolean(value && typeof value.endpoint === "string"
              && value.keys && typeof value.keys.p256dh === "string" && typeof value.keys.auth === "string");
            export const SubscribePushNotificationsBody={safeParse:value=>
              validSubscription(value)?{success:true,data:value}:{success:false}};
            export const UnsubscribePushNotificationsBody={safeParse:value=>
              value && typeof value.endpoint==="string"?{success:true,data:value}:{success:false}};
          `
          : path === "webpush" ? `
            const api={
              setVapidDetails(){},
              async sendNotification(subscription){
                globalThis.__sentPushes.push(subscription.endpoint);
                if(subscription.endpoint===globalThis.__deadPushEndpoint){
                  const error=new Error("private push transport detail");
                  error.statusCode=410;
                  throw error;
                }
              }
            };
            export default api;
          `
          : path === "owner" ? `
            export const getOwnerUserIds=()=>(
              process.env.ALLPLAY_OWNER_USER_IDS||""
            ).split(",").map(x=>x.trim()).filter(Boolean);
            export const isOwnerAccount=id=>getOwnerUserIds().includes(id);
          `
          : `export const logger={warn:(fields,message)=>globalThis.__notificationLog.push({fields,message})};`,
        loader: "js",
      }));
    },
  }],
});

const { notificationsRouter, notifyOwners, saveOwnerPushSubscription, db, pushSubscriptions } =
  await import(pathToFileURL(join(dir, "notifications.mjs")));
process.env.ALLPLAY_OWNER_USER_IDS = "user_ownerFixture";
process.env.SESSION_SECRET = "notification-tests-only-secret";
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.log = { error() {}, warn() {} };
  next();
});
app.use("/api", notificationsRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.on("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

function reset() {
  globalThis.__notificationRows = { subscriptions: [], receipts: [] };
  globalThis.__notificationLog = [];
  globalThis.__sentPushes = [];
  globalThis.__clerkUsers = {};
  globalThis.__deadPushEndpoint = null;
}

async function request(user, path, method = "POST", body, origin = base) {
  const headers = { "Content-Type": "application/json" };
  if (user) headers["x-test-user"] = user;
  if (origin) headers.Origin = origin;
  const response = await fetch(`${base}/api/notifications/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

const subscription = endpoint => ({
  endpoint,
  keys: { p256dh: "x".repeat(32), auth: "y".repeat(16) },
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
  delete process.env.ALLPLAY_OWNER_USER_IDS;
  delete process.env.SESSION_SECRET;
});

test("only the owner can add or remove a device, and cross-origin or missing-origin writes fail", async () => {
  reset();
  const sub = subscription("https://push.example/device-a");
  assert.equal((await request("user_memberFixture", "subscribe", "POST", sub)).status, 403);
  assert.equal((await request("user_ownerFixture", "subscribe", "POST", sub, "https://evil.example")).status, 403);
  assert.equal((await request("user_ownerFixture", "subscribe", "POST", sub, null)).status, 403);
  assert.equal((await request("user_ownerFixture", "subscribe", "DELETE", { endpoint: sub.endpoint }, "https://evil.example")).status, 403);
  assert.equal((await request("user_ownerFixture", "subscribe", "DELETE", { endpoint: sub.endpoint }, null)).status, 403);
  assert.equal(globalThis.__notificationRows.subscriptions.length, 0);
  assert.equal((await request("user_ownerFixture", "subscribe", "POST", sub)).status, 200);
  assert.equal(globalThis.__notificationRows.subscriptions.length, 1);
  assert.equal((await request("user_ownerFixture", "subscribe", "DELETE", { endpoint: sub.endpoint })).status, 204);
  assert.equal(globalThis.__notificationRows.subscriptions.length, 0);
});

test("a recent Clerk signup is accepted once; an old account is ignored", async () => {
  reset();
  globalThis.__clerkUsers.user_newFixture = { createdAt: Date.now() };
  globalThis.__clerkUsers.user_oldFixture = { createdAt: Date.now() - 25 * 60 * 60 * 1000 };
  assert.deepEqual((await request("user_newFixture", "signup-event")).data, { accepted: true });
  assert.deepEqual((await request("user_newFixture", "signup-event")).data, { accepted: false });
  assert.deepEqual((await request("user_oldFixture", "signup-event")).data, { accepted: false });
  assert.equal(globalThis.__notificationRows.receipts.length, 1);
  assert.equal(globalThis.__notificationRows.receipts[0].eventType, "signup");
});

test("a verified membership alert is deduplicated across retries", async () => {
  reset();
  await saveOwnerPushSubscription("user_ownerFixture", subscription("https://push.example/membership"));
  assert.equal(await notifyOwners("membership", "mem_verifiedFixture"), true);
  assert.equal(await notifyOwners("membership", "mem_verifiedFixture"), false);
  assert.deepEqual(globalThis.__sentPushes, ["https://push.example/membership"]);
  assert.equal(globalThis.__notificationRows.receipts.length, 1);
});

test("expired push subscriptions are deleted and their endpoint details never reach logs", async () => {
  reset();
  const expired = "https://push.example/private-expired-device";
  const active = "https://push.example/active-device";
  globalThis.__deadPushEndpoint = expired;
  await saveOwnerPushSubscription("user_ownerFixture", subscription(expired));
  await saveOwnerPushSubscription("user_ownerFixture", subscription(active));

  assert.equal(await notifyOwners("signup", "signup-expired-endpoint-fixture"), true);
  assert.deepEqual(globalThis.__notificationRows.subscriptions.map(row => row.endpoint), [active]);
  assert.equal(globalThis.__sentPushes.length, 2);
  assert.equal(globalThis.__notificationLog.length, 1);
  const serializedLog = JSON.stringify(globalThis.__notificationLog);
  for (const privateValue of [expired, "x".repeat(32), "y".repeat(16), "private push transport detail"])
    assert.equal(serializedLog.includes(privateValue), false);
  assert.deepEqual(globalThis.__notificationLog[0].fields, { statusCode: 410 });
  assert.equal(pushSubscriptions.endpoint.name, "endpoint");
  const remaining = await db.select().from(pushSubscriptions);
  assert.equal(remaining.length, 1);
});
