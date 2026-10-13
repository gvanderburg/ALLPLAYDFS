import type { ModelPlayerRole } from "@workspace/api-zod";
import type { HistoricalGame, ModelSport, SlatePlayer } from "./types";
import { MODEL_SPORTS } from "./types";
import { rolePage, parseDepth, hockeyLines, hockeyStarter, baseballLineup, nameKey } from "./role-sources";

export interface TeamRoleInput {
  sport: ModelSport; teamId: string; teamName: string; opponentName: string; date: string;
  startTime: string; season: number; probable: string; players: SlatePlayer[]; history: HistoricalGame[]; lineupDate?: string;
}
export function recentRole(player: SlatePlayer, games: HistoricalGame[], sport: ModelSport): ModelPlayerRole {
  const teamGames = [...games].filter(g => g.teams.some(t => t.id === player.teamId))
    .sort((a,b) => Date.parse(b.date)-Date.parse(a.date)).slice(0,3);
  const unit = ["nba","wnba"].includes(sport) ? "minutes" : sport==="nhl" ? (player.position==="G"?"saves":"timeOnIce") :
    sport==="nfl"||sport==="cfb" ? player.position==="QB"?"passingAttempts":/^(RB|FB)$/.test(player.position)?"rushingAttempts":
      player.position==="K"?"extraPointsMade":teamGames.some(g=>g.players.some(p=>p.id===player.id && p.stats.targets!==undefined))?"targets":"receptions" :
    /^(SP|RP|P)$/.test(player.position) ? "inningsPitched" : "atBats";
  const observations = teamGames.flatMap(g => {
    const p = g.players.find(p => p.id === player.id && p.teamId === player.teamId);
    return p && Number.isFinite(p.stats[unit]) && p.stats[unit] >= 0 ? [p.stats[unit]] : [];
  });
  const weighted = observations.reduce((n,v,i) => n+v*.8**i,0) / observations.reduce((n,_,i)=>n+.8**i,0);
  return { status: observations.length >= 2 ? "rotation" : "unknown",
    label: observations.length >= 2 ? "Recent rotation" : "Role unverified", depthRank: null,
    eligible: observations.length >= 2, recentAppearances: observations.length, teamGames: teamGames.length,
    recentWorkload: observations.length >= 2 ? Math.round(weighted*100)/100 : null, workloadUnit: unit,
    source: "ESPN completed box scores", sourceUrl: teamGames[0] ? `https://www.espn.com/${sport==="cfb"?"college-football":sport}/boxscore/_/gameId/${teamGames[0].id}` : null,
    asOf: teamGames[0] ? new Date(teamGames[0].date) : null,
    note: `${observations.length}/${teamGames.length} recent team games have recorded ${unit}. This is observed usage, not a confirmed next-game lineup.` };
}
export function applyTeamRoles(input: TeamRoleInput, depth: ReturnType<typeof parseDepth>,
  lines: ReturnType<typeof hockeyLines> | null, goalie: ReturnType<typeof hockeyStarter>,
  baseball: Awaited<ReturnType<typeof baseballLineup>> | null): SlatePlayer[] {
  const {sport,players} = input;
  const cutoff = Math.min(Date.parse(input.date), Date.parse(new Date().toISOString().slice(0,10)));
  const freshness = (sport==="nfl"||sport==="cfb"?28:14)*86400000;
  // Role evidence must exist before the forecast cutoff. Old-season usage is not a current depth chart.
  const history = input.history.filter(g=>Date.parse(g.date)<cutoff && cutoff-Date.parse(g.date)<=freshness);
  const qbGames = [...history].filter(g=>g.teams.some(t=>t.id===input.teamId))
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,3);
  const qbUsage = new Map<string, number>();
  qbGames.forEach((g,i)=>g.players.filter(p=>p.teamId===input.teamId && p.position==="QB")
    .forEach(p=>qbUsage.set(p.id,(qbUsage.get(p.id)??0)+(p.stats.passingAttempts??0)*.8**i)));
  const totalPass = [...qbUsage.values()].reduce((a,b)=>a+b,0);
  const leader = [...qbUsage].sort((a,b)=>b[1]-a[1])[0];
  const rosterNames = new Map<string, number>();
  players.forEach(p=>rosterNames.set(nameKey(p.name),(rosterNames.get(nameKey(p.name))??0)+1));
  return players.map(player=>{
    let role=recentRole(player,history,sport);
    const d=depth.get(player.id), key=nameKey(player.name), uniqueName=rosterNames.get(key)===1;
    if (d) {
      role={...role,status:d.rank===1?"starter":"rotation",label:`${d.unit} · Depth ${d.rank}${d.rank===1?" starter":""}`,
        depthRank:d.rank,source:"ESPN live depth chart",sourceUrl:`https://www.espn.com/${sport==="cfb"?"college-football":sport}/team/depth/_/id/${input.teamId}`,
        asOf:new Date(),note:`Published depth order, not game-day confirmation. ${d.rank>1?`First option: ${d.starterName}. `:""}${role.note}`};
      if(d.rank===1)role.eligible=true;
    }
    if ((sport==="nfl"||sport==="cfb") && player.position==="QB") {
      const inferred=!d && leader?.[0]===player.id && totalPass>0 && leader[1]/totalPass>=.6 &&
        role.recentAppearances>=2 && qbGames[0]?.players.some(p=>p.id===player.id && (p.stats.passingAttempts??0)>0);
      role={...role,status:d?.rank===1?"starter":inferred?"projected-starter":d?"backup":"unknown",
        eligible:d?.rank===1 || !!inferred,label:d?`QB${d.rank} · ${d.rank===1?"Depth starter":"Backup"}`:inferred?"Recent QB leader":"QB role unverified",
        note:`${role.note} ${d && d.rank>1?`Backup behind ${d.starterName}; no verified starting assignment. Full-game past production is not an expected slate workload.`:inferred?"Recent majority passing workload supports a projected, not confirmed, QB role.":"Verify late starter and injury announcements."}`};
    }
    if (sport==="nhl") {
      const line=uniqueName?lines?.lines.get(key):undefined;
      if(line)role={...role,status:line.scratched?"backup":"rotation",label:line.label,depthRank:line.rank,eligible:!line.scratched,
        source:"Daily Faceoff line combinations",sourceUrl:`https://www.dailyfaceoff.com/teams/${slug(input.teamName)}/line-combinations`,
        asOf:lines?.asOf??null,note:"Published line/PP unit context; projected ice time uses ALLPLAY's recorded game usage. Scratches/unavailable listings are excluded."};
      else if(lines?.lines.size && player.position!=="G") role={...role,status:"unknown",label:"Unit assignment unverified",eligible:false,
        source:"Daily Faceoff line combinations",asOf:lines.asOf,note:"Not matched uniquely to an active published unit. Past appearances cannot establish a current lineup spot."};
      if(player.position==="G"){
        const chosen=uniqueName && goalie && nameKey(goalie.name)===key;
        const probable=input.probable===player.id;
        role={...role,status:chosen?(goalie.confirmed?"starter":"projected-starter"):probable?"projected-starter":goalie?"backup":"unknown",
          label:chosen?(goalie.confirmed?"Confirmed goalie":"Likely goalie"):probable?"Probable goalie":goalie?"Backup goalie":"Goalie unconfirmed",
          eligible:!!chosen||probable,source:goalie?"Daily Faceoff dated starting goalies":"ESPN probable / recent goalie usage",
          sourceUrl:goalie?`https://www.dailyfaceoff.com/starting-goalies/${input.lineupDate??input.date}`:role.sourceUrl,
          asOf:goalie?.asOf??role.asOf,note:"Goalie depth order does not establish today's starter. Value requires a same-game confirmed/likely/probable starting assignment."};
      }
    }
    if(sport==="mlb"){
      if(/^(SP|RP|P)$/.test(player.position)){
        const probable=input.probable===player.id || !!(uniqueName && baseball?.pitcher===key);
        role={...role,status:probable?"projected-starter":"unknown",eligible:probable,label:probable?"Probable starting pitcher":"Pitcher start unverified",
          source:baseball?"MLB official game schedule":"ESPN game probables",sourceUrl:baseball?.url??role.sourceUrl,
          note:"Rotation slot is not a game-specific pitching assignment. Only this game's probable pitcher receives an expected starting workload."};
      }else if(baseball?.names.length && uniqueName){
        const index=baseball.names.indexOf(key);
        role={...role,status:index>=0?"starter":"backup",eligible:index>=0,label:index>=0?`Batting order ${index+1}`:"Not in batting lineup",
          source:"MLB official game batting order",sourceUrl:baseball.url,asOf:new Date(),note:"Same-date, same-opponent, same-start-time game lineup. Non-lineup hitters have no projected starting workload."};
      }else role.note+=" Batting order has not been verified; regular/rotation usage is conditional.";
    }
    if (/\b(out|inactive|suspended|doubtful|ir|injured[- ]reserve|reserve\/injured|physically unable)\b|\d+-day[- ]il/i.test(player.availability)) {
      role.eligible=false; role.note+=` Current availability (${player.availability}) prevents a playable workload.`;
    }
    return {...player,roleContext:role,participation:`${role.label}. ${role.note}`};
  });
}
const slug=(name:string)=>name.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
export function lineupCalendarDay(startTime:string, fallback:string) {
  if(!Number.isFinite(Date.parse(startTime)))return fallback;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(new Date(startTime));
  const part=(type:string)=>parts.find(p=>p.type===type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export async function loadTeamRoles(input:TeamRoleInput) {
  const live=input.date>=new Date().toISOString().slice(0,10);
  // NHL/MLB reports use their game calendar day, not the ISO UTC date of a night game.
  const lineupDate=lineupCalendarDay(input.startTime,input.date);
  const url=`https://site.api.espn.com/apis/site/v2/sports/${MODEL_SPORTS[input.sport].path}/teams/${input.teamId}/depthcharts`;
  const [depthData,lineData,goalieData,baseball]=await Promise.all([
    live&&input.sport!=="nhl"?rolePage(url):null,
    live&&input.sport==="nhl"?rolePage(`https://www.dailyfaceoff.com/teams/${slug(input.teamName)}/line-combinations`,true):null,
    live&&input.sport==="nhl"?rolePage(`https://www.dailyfaceoff.com/starting-goalies/${lineupDate}`,true):null,
    live&&input.sport==="mlb"?baseballLineup(lineupDate,input.teamName,input.opponentName,input.startTime):null,
  ]);
  const depth=parseDepth(depthData,input.sport,input.season,input.teamId), lines=hockeyLines(lineData,input.teamName);
  const goalie=hockeyStarter(goalieData,lineupDate,input.teamName,input.opponentName,input.startTime);
  return {players:applyTeamRoles({...input,lineupDate},depth,lines,goalie,baseball),note:
    `${input.teamName}: ${depth.size?"published depth chart":lines.lines.size?"published hockey units":"published depth unavailable; recent game usage fallback"}; ${live?"current role evidence":"live depth/lineups not applied to historical slates"}. Unverified QB/goalie/pitcher starts and unsupported workloads cannot become value picks.`};
}
