import { pgTable, text, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectionHistory = pgTable("projection_history", {
  sport: text("sport").notNull(),
  eventId: text("event_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  data: jsonb("data").$type<unknown>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.sport, table.eventId] })]);

export const insertProjectionHistorySchema = createInsertSchema(projectionHistory);
export type InsertProjectionHistory = z.infer<typeof insertProjectionHistorySchema>;
export type ProjectionHistory = typeof projectionHistory.$inferSelect;
