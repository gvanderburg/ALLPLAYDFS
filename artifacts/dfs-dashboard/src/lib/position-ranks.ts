import type { ModelPlayerProjection, ModelProjectionSheet } from '@workspace/api-client-react';

export function positionRanks(sheet: ModelProjectionSheet, site: string) {
  const groups = new Map<string, { id: string; points: number }[]>();
  for (const player of sheet.players) {
    if (player.roleContext?.eligible === false) continue;
    const forecast = player.fantasy?.find(row => row.site === site && row.status === 'ready');
    if (!forecast || forecast.mean == null || !Number.isFinite(forecast.mean) ||
      /\bout\b|\bdoubtful\b|\binactive\b|\bir\b|injured[- ]reserve|^o$/i.test(player.availability)) continue;
    const position = positionKey(player, sheet.sport);
    if (!position) continue;
    const group = groups.get(position) ?? [];
    group.push({ id: player.id, points: forecast.mean });
    groups.set(position, group);
  }
  const ranks = new Map<string, { position: string; rank: number; count: number }>();
  for (const [position, group] of groups) {
    for (const player of group) ranks.set(player.id, { position, count: group.length,
      rank: 1 + group.filter(other => other.points > player.points + 1e-9).length });
  }
  return ranks;
}

export function positionKey(player: Pick<ModelPlayerProjection, 'position'>, sport: string) {
  const position = player.position.trim().toUpperCase().split(/[/-]/)[0];
  if (sport === 'nhl' && ['LW', 'RW', 'W'].includes(position)) return 'W';
  if (sport === 'mlb' && ['SP', 'RP', 'P'].includes(position)) return 'P';
  if (sport === 'mlb' && ['LF', 'RF', 'CF', 'OF'].includes(position)) return 'OF';
  return position;
}

/** Presentation only: the underlying same-slate salary-value calculation is unchanged. */
export function formatValueMultiple(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}x`;
}
