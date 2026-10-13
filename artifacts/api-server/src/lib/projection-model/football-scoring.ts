import type { HistoricalPlayer } from "./types";
import { list, numeric, obj, str, type Json } from "./normalize";

const coreGroups: Record<string, Record<string, string>> = {
  passing: { passingYards: "passingYards", passingTouchdowns: "passingTDs", interceptions: "interceptionsThrown" },
  rushing: { rushingAttempts: "rushingAttempts", rushingYards: "rushingYards", rushingTouchdowns: "rushingTDs" },
  receiving: { receptions: "receptions", receivingYards: "receivingYards", receivingTouchdowns: "receivingTDs", receivingTargets: "targets" },
  fumbles: { fumblesLost: "fumblesLost" },
};
const athleteId = (p: Json) => str(obj(p.athlete).id) ||
  str(obj(p.athlete).$ref).match(/\/athletes\/(\d+)(?:\?|$)/)?.[1] || "";
const teamId = (value: unknown) => str(obj(value).id) ||
  str(obj(value).$ref).match(/\/teams\/(\d+)(?:\?|$)/)?.[1] || "";

// Absence is zero only in a published category whose athlete totals reconcile.
export function enrichFootball(data: Json, competition: Json, players: Map<string, HistoricalPlayer>) {
  for (const value of list(obj(data.boxscore).players)) {
    const team = obj(value);
    const id = str(obj(team.team).id);
    const groups = list(team.statistics).map(obj);
    const active = [...players.values()].filter(p => p.teamId === id &&
      (/^(QB|RB|FB|WR|TE)$/.test(p.position) ||
       ["passingYards", "rushingYards", "receivingYards", "receptions"].some(k => p.stats[k] !== undefined)));
    for (const [category, fields] of Object.entries(coreGroups)) {
      const group = groups.find(g => str(g.name || g.type) === category);
      if (!group) continue;
      const keys = list(group.keys).map(str), entries = list(group.athletes).map(obj);
      const ids = entries.map(e => str(obj(e.athlete).id));
      if (ids.some(id => !id) || new Set(ids).size !== ids.length) continue;
      if (category === "passing") {
        const index = keys.indexOf("completions/passingAttempts");
        const pair = (value: unknown) => {
          const parts = str(value).split("/");
          return parts.length === 2 ? parts.map(numeric) : [null, null];
        };
        const total = pair(list(group.totals)[index]);
        const values = entries.map(e => pair(list(e.stats)[index]));
        const reconciled = index >= 0 && total.every(v => v !== null && v >= 0) &&
          values.every(v => v.every(n => n !== null && n >= 0) && v[0]! <= v[1]!) &&
          [0, 1].every(i => values.reduce((sum, row) => sum + row[i]!, 0) === total[i]);
        if (reconciled) for (const player of active) {
          const row = values[ids.indexOf(player.id)] ?? [0, 0];
          player.stats.passingCompletions = row[0]!;
          player.stats.passingAttempts = row[1]!;
        }
      }
      for (const [source, target] of Object.entries(fields)) {
        const index = keys.indexOf(source);
        const total = index < 0 ? null : numeric(list(group.totals)[index]);
        const observations = entries.map(e => numeric(list(e.stats)[index]));
        if (total === null || observations.some(v => v === null)) continue;
        const sum = observations.reduce<number>((n, v) => n + (v ?? 0), 0);
        let reconciled = Math.abs(sum - total) <= .001;
        // ESPN's team passing total is NET of sacks; athlete passing yards are GROSS.
        // Validate both sack components before deriving absent-player zeros.
        if (!reconciled && category === "passing" && source === "passingYards") {
          const sackIndex = keys.indexOf("sacks-sackYardsLost");
          const pair = (value: unknown) => str(value).split("-").map(numeric);
          const totalSacks = pair(list(group.totals)[sackIndex]);
          const sacks = entries.map(e => pair(list(e.stats)[sackIndex]));
          const verifiedSacks = sackIndex >= 0 && totalSacks.length === 2 && totalSacks.every(v => v !== null && v >= 0) &&
            sacks.every(row => row.length === 2 && row.every(v => v !== null && v >= 0)) &&
            [0, 1].every(i => sacks.reduce((n, row) => n + row[i]!, 0) === totalSacks[i]);
          reconciled = verifiedSacks && Math.abs(sum - totalSacks[1]! - total) <= .001;
        }
        if (!reconciled) continue;
        const recorded = new Map(entries.map((e, i) => [str(obj(e.athlete).id), observations[i]!]));
        for (const player of active) player.stats[target] = recorded.get(player.id) ?? 0;
      }
    }
  }
  const page = obj(data.allplayFootballPlays);
  const plays = list(page.items).map(obj);
  const declared = numeric(page.count);
  const last = plays.at(-1);
  const competitors = list(competition.competitors).map(obj);
  const home = competitors.find(c => c.homeAway === "home"), away = competitors.find(c => c.homeAway === "away");
  const homeScore = numeric(home?.score), awayScore = numeric(away?.score);
  const complete = declared !== null && declared === plays.length && declared > 0 && last &&
    homeScore !== null && awayScore !== null &&
    numeric(last.homeScore) === homeScore && numeric(last.awayScore) === awayScore;
  if (!complete) return;
  const rare = new Map<string, Record<string, number>>();
  const add = (id: string, stat: string) => {
    const row = rare.get(id) ?? {};
    row[stat] = (row[stat] ?? 0) + 1;
    rare.set(id, row);
  };
  let verified = true;
  for (const play of plays) {
    if (play.scoringPlay !== true || /nullified|no play|two-point.*fail|conversion.*fail/i.test(str(play.text))) continue;
    const kind = str(obj(play.type).text);
    const participants = list(play.participants).map(obj);
    if (/two.?point|two pt|2.?pt.*conversion/i.test(kind)) {
      const scorers = participants.filter(p => ["passer", "receiver", "rusher"].includes(str(p.type)));
      if (!scorers.length) { verified = false; continue; }
      for (const id of new Set(scorers.map(athleteId))) {
        if (!id) verified = false;
        else add(id, "twoPointConversions");
      }
    } else if (/(kickoff|kick return|punt|field goal|blocked kick).*touchdown/i.test(kind)) {
      const id = athleteId(participants.find(p => p.type === "returner") ?? {});
      if (!id) verified = false;
      else add(id, "returnTouchdowns");
    } else if (/fumble.*touchdown/i.test(kind)) {
      const scorer = participants.find(p => ["recoverer", "rusher", "returner"].includes(str(p.type)));
      const id = athleteId(scorer ?? {}), player = players.get(id);
      if (!id) verified = false;
      else if (player && /^(QB|RB|FB|WR|TE)$/.test(player.position) && player.teamId === teamId(play.team))
        add(id, "fumbleRecoveryTouchdowns");
    }
  }
  if (!verified) return;
  for (const player of players.values()) {
    if (!/^(QB|RB|FB|WR|TE)$/.test(player.position) &&
        !["passingYards", "rushingYards", "receivingYards", "receptions"].some(k => player.stats[k] !== undefined)) continue;
    for (const key of ["twoPointConversions", "returnTouchdowns", "fumbleRecoveryTouchdowns"])
      player.stats[key] = rare.get(player.id)?.[key] ?? 0;
  }
}
