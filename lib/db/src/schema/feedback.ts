import { pgTable, serial, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feedbackTickets = pgTable("feedback_tickets", {
  id: serial("id").primaryKey(),
  reporterId: text("reporter_id").notNull(),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  details: text("details").notNull(),
  sport: text("sport"),
  contextPath: text("context_path"),
  status: text("status").notNull().default("open"),
  ownerResponse: text("owner_response").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index("feedback_reporter_id_idx").on(table.reporterId, table.id),
  index("feedback_reporter_created_idx").on(table.reporterId, table.createdAt),
  check("feedback_category_check", sql`${table.category} in ('issue', 'request', 'general')`),
  check("feedback_status_check", sql`${table.status} in ('open', 'in_progress', 'resolved')`),
]);
export const insertFeedbackTicketSchema = createInsertSchema(feedbackTickets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeedbackTicket = z.infer<typeof insertFeedbackTicketSchema>;
export type FeedbackTicketRow = typeof feedbackTickets.$inferSelect;
