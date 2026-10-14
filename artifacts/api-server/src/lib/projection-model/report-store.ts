import { db, matchupReports } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListMatchupReportsResponse } from "@workspace/api-zod";
export async function approvedReports() {
  const rows = await db.select().from(matchupReports).where(eq(matchupReports.status, "approved"));
  // PostgreSQL JSON dates are strings. Revalidate/coerce before period joins.
  return ListMatchupReportsResponse.parse(rows.map(row => ({
    ...(row.data as object), id: row.id, status: row.status, createdAt: row.createdAt,
  })));
}
