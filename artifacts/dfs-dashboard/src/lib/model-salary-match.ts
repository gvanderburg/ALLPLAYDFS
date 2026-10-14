import type { DfsDashboard, DfsSalaryPlatform, ModelPlayerProjection, ModelProjectionSheet } from '@workspace/api-client-react';

/** Only salary metadata from the same sport, UTC slate day, selected slate and site. */
export function findUniqueSelectedSlateSalary(
  player: ModelPlayerProjection, sheet: ModelProjectionSheet,
  dashboard: DfsDashboard | undefined, platform: DfsSalaryPlatform,
) {
  if (player.roleContext?.eligible === false) return undefined;
  const selected = dashboard?.salaryCoverage?.platform === platform ? dashboard.salaryCoverage.selectedSlateId : null;
  if (!selected || !sheet.slateDate || dashboard?.date?.slice(0, 10) !== sheet.slateDate.slice(0, 10)) return undefined;
  const name = player.name.trim().toLocaleLowerCase(), team = player.team.trim().toLocaleLowerCase();
  // Drivers are individuals; a provider's car/team label is not the model's "Driver pool".
  // Only relax team equality for NASCAR, keeping unique identity and every slate/site boundary.
  const individual = sheet.sport === 'nascar';
  if (!name || (!individual && !team) || sheet.players.filter(p =>
    p.name.trim().toLocaleLowerCase() === name && (individual || p.team.trim().toLocaleLowerCase() === team)).length !== 1) return undefined;
  const matches = (dashboard?.projections ?? []).filter(row =>
    row.sport === sheet.sport && row.salaryPlatform === platform && row.salarySlateId === selected &&
    row.salary != null && row.name.trim().toLocaleLowerCase() === name && (individual || row.team?.trim().toLocaleLowerCase() === team));
  return matches.length === 1 ? matches[0] : undefined;
}
