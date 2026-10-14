import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("push_subscriptions_user_idx").on(table.userId)],
);

export const pushNotificationReceipts = pgTable("push_notification_receipts", {
  eventKey: text("event_key").primaryKey(),
  eventType: text("event_type").notNull(),
  // Existing receipts predate delivery tracking and must remain deduplicated.
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushNotificationDeliveries = pgTable(
  "push_notification_deliveries",
  {
    eventKey: text("event_key").notNull(),
    endpoint: text("endpoint").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.eventKey, table.endpoint] })],
);
