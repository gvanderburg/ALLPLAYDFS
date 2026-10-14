import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Structured ranking records, not uploaded file bytes. Original files stay in
// the owner's browser; previews expire and never participate in matchup joins.
export const matchupReports = pgTable("matchup_reports", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull(),
  data: jsonb("data").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("matchup_reports_status_idx").on(t.status)]);
