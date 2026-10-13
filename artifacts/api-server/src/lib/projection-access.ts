import { GetDfsDashboardResponse } from "@workspace/api-zod";

type DashboardData = ReturnType<typeof GetDfsDashboardResponse.parse>;

export function gateDashboardProjections(data: DashboardData, hasAccess: boolean): DashboardData {
  if (hasAccess) return { ...data, projectionsLocked: false };
  // The entire player dataset is premium, including salary values and any
  // future stats fields. Never send hidden data to an unpaid browser.
  // Raw server caches remain unchanged and every response is gated separately.
  return { ...data, projectionsLocked: true, projections: [] };
}
