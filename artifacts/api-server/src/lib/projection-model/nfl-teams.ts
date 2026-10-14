const teams: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
const aliases: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR", HST: "HOU", BLT: "BAL", NWE: "NE", SFO: "SF", TBB: "TB" };
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export function nflTeamKey(value: string) {
  const abbreviation = value.trim().toUpperCase();
  return aliases[abbreviation] ?? (teams[abbreviation] ? abbreviation
    : Object.keys(teams).find(key => nameKey(teams[key]) === nameKey(value)));
}
