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
      for (const [source, target] of Object.entries(fields)) {
        const index = keys.indexOf(source);
        const total = index < 0 ? null : numeric(list(group.totals)[index]);
        const observations = entries.map(e => numeric(list(e.stats)[index]));
        if (total === null || observations.some(v => v === null) ||
            Math.abs(observations.reduce<number>((n, v) => n + (v ?? 0), 0) - total) > .001) continue;
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
