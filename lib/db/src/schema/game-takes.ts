import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const takeUploads = pgTable("take_uploads", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectPath: text("object_path").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const gameTakes = pgTable("game_takes", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  uploadId: uuid("upload_id").notNull().unique().references(() => takeUploads.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sport: text("sport").notNull(),
  game: text("game").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertGameTakeSchema = createInsertSchema(gameTakes).omit({ id: true, createdAt: true });
export type InsertGameTake = z.infer<typeof insertGameTakeSchema>;
export type GameTake = typeof gameTakes.$inferSelect;
