import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// Identity/payment bindings only. Whop remains the subscription and pricing authority.
export const membershipBindings = pgTable("membership_bindings", {
  userId: text("user_id").primaryKey(),
  membershipId: text("membership_id").notNull().unique(),
  whopUserId: text("whop_user_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const membershipCheckouts = pgTable("membership_checkouts", {
  checkoutId: text("checkout_id").primaryKey(),
  userId: text("user_id").notNull(),
  purchaseUrl: text("purchase_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("membership_checkouts_user_created_idx").on(table.userId, table.createdAt)]);
