import { pgTable, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modelSnapshots = pgTable("model_snapshots", {
  id: text("id").primaryKey(),
  sport: text("sport").notNull(),
  slateDate: text("slate_date").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  data: jsonb("data").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("model_snapshots_slate_idx").on(t.sport, t.slateDate)]);
export const insertModelSnapshotSchema = createInsertSchema(modelSnapshots);
export type InsertModelSnapshot = z.infer<typeof insertModelSnapshotSchema>;

export const modelEvaluations = pgTable("model_evaluations", {
  id: text("id").primaryKey(),
  sport: text("sport").notNull(),
  site: text("site").notNull(),
  fromDate: text("from_date").notNull(),
  toDate: text("to_date").notNull(),
  status: text("status").notNull(),
  report: jsonb("report").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertModelEvaluationSchema = createInsertSchema(modelEvaluations);
export type InsertModelEvaluation = z.infer<typeof insertModelEvaluationSchema>;

export const evaluationUploads = pgTable("evaluation_uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertEvaluationUploadSchema = createInsertSchema(evaluationUploads);
export type InsertEvaluationUpload = z.infer<typeof insertEvaluationUploadSchema>;

export const evaluationImports = pgTable("evaluation_imports", {
  id: text("id").primaryKey(),
  uploadId: text("upload_id").notNull().unique().references(() => evaluationUploads.id),
  kind: text("kind").notNull(),
  sport: text("sport").notNull(),
  site: text("site").notNull(),
  slateDate: text("slate_date").notNull(),
  contestId: text("contest_id").notNull(),
  source: text("source").notNull(),
  asOf: text("as_of").notNull(),
  hash: text("hash").notNull(),
  rowCount: integer("row_count").notNull(),
  data: jsonb("data").$type<unknown>().notNull(),
  verifiedBy: text("verified_by").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertEvaluationImportSchema = createInsertSchema(evaluationImports);
export type InsertEvaluationImport = z.infer<typeof insertEvaluationImportSchema>;
