type ObjectValue = Record<string, unknown>;
const obj = (v: unknown): ObjectValue => v && typeof v === "object" ? v as ObjectValue : {};
function numeric(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function spread(v: unknown): number | null {
  return typeof v === "string" && /^(pk|pick(?:'em)?)$/i.test(v.trim()) ? 0 : numeric(v);
}
function american(v: unknown): number | null {
  if (typeof v === "string" && /^even$/i.test(v.trim())) return 100;
  const n = numeric(v);
  return n !== null && Math.abs(n) >= 100 ? n : null;
}

export function competitorLines(oddsValue: unknown, side: string) {
  const odds = obj(oddsValue);
  if (side !== "home" && side !== "away") return { spread: null, moneyline: null };
  const point = obj(obj(odds.pointSpread)[side]);
  const money = obj(obj(odds.moneyline)[side]);
  const legacy = obj(odds[`${side}TeamOdds`]);
  const other = obj(odds[`${side === "home" ? "away" : "home"}TeamOdds`]);
  const magnitude = numeric(odds.spread);
  // A legacy event-level spread belongs to the favorite, not necessarily home.
  const legacySpread = magnitude === 0 ? 0 :
    magnitude !== null && (legacy.favorite === true || other.favorite === true)
      ? Math.abs(magnitude) * (legacy.favorite === true ? -1 : 1) : null;
  return {
    spread: spread(obj(point.close).line) ?? spread(obj(point.open).line) ??
      spread(legacy.spread) ?? legacySpread,
    moneyline: american(obj(money.close).odds) ?? american(obj(money.open).odds) ??
      american(legacy.moneyLine) ?? american(legacy.moneyline),
  };
}
