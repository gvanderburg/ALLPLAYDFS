export const DK_CUP_RULE_SOURCE = "https://api.draftkings.com/rules-and-scoring/RulesAndScoring.json";
// Read from the current official rules renderer's NASCAR Classic entry (sport 10, game type 8).
// Do not substitute Pick6's 45/.45 coefficients or a secondary site's classic table.
export const DK_CUP_FINISH = [46, 42, 41, 40, 39, 38, 37, 36, 35, 34,
  33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18,
  17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4];
export const FD_CUP_FINISH = [43, 40, 38, 37, 36, 35, 34, 33, 32, 31,
  30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15,
  14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
export function cupFinishPoints(table: number[], finish: number): number {
  return Number.isInteger(finish) && finish >= 1 && finish <= table.length ? table[finish - 1] : NaN;
}
