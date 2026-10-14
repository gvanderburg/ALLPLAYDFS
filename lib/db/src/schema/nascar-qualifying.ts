import { createInsertSchema } from "drizzle-zod";
import { date, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export interface OfficialCupGridEntry {
  driverId: string;
  driverName: string;
  position: number;
}

export const nascarQualifyingGrids = pgTable("nascar_qualifying_grids", {
  id: text("id").primaryKey(),
  season: integer("season").notNull(),
  raceId: integer("race_id").notNull(),
  raceDate: date("race_date", { mode: "string" }).notNull(),
  fieldSize: integer("field_size").notNull(),
  qualifyingOrder: jsonb("qualifying_order").$type<OfficialCupGridEntry[]>().notNull(),
  startingOrder: jsonb("starting_order").$type<OfficialCupGridEntry[]>().notNull(),
  sourceUrl: text("source_url").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
}, table => [index("nascar_qualifying_race_date_idx").on(table.raceDate)]);

export const insertNascarQualifyingGridSchema = createInsertSchema(nascarQualifyingGrids);
export type InsertNascarQualifyingGrid = z.infer<typeof insertNascarQualifyingGridSchema>;
export type NascarQualifyingGrid = typeof nascarQualifyingGrids.$inferSelect;
