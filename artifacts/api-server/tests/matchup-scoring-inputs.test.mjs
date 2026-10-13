import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'allplay-scoring-inputs-'));
await build({ stdin: { contents: 'export * from "./src/lib/projection-model/normalize"; export * from "./src/lib/projection-model/fantasy"; export * from "./src/lib/projection-model/calculate"; export * from "./src/lib/projection-model/schedule-history";', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'model.mjs') });
const { normalizeSummary, calculatePlayers, scoringRule, scoreOutcome, completedScheduleIds } = await import(pathToFileURL(join(dir, 'model.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));
const group = (name, keys, rows, totals) => ({ name, keys, totals, athletes: rows.map(([id, position, stats]) => ({
  athlete: { id, displayName: id === 'p1' ? 'Recorded Player' : id, position: { abbreviation: position } }, stats,
})) });
function base() {
  return { header: { id: '111', season: { type: 2, year: 2026 }, competitions: [{ date: '2026-10-01T20:00:00Z', status: { type: { completed: true } },
    competitors: [{ id: 'a', homeAway: 'home', score: '7', team: { id: 'a', displayName: 'Team A', abbreviation: 'AAA' } },
      { id: 'b', homeAway: 'away', score: '3', team: { id: 'b', displayName: 'Team B', abbreviation: 'BBB' } }] }] } };
}
function football() {
  return { ...base(), boxscore: { players: [{ team: { id: 'a' }, statistics: [
    group('passing', ['passingYards', 'passingTouchdowns', 'interceptions'], [['p1', 'QB', ['100', '1', '0']]], ['100', '1', '0']),
    group('rushing', ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'], [['rb', 'RB', ['10', '40', '0']]], ['10', '40', '0']),
    group('receiving', ['receptions', 'receivingYards', 'receivingTouchdowns', 'receivingTargets'], [['wr', 'WR', ['4', '100', '1', '6']]], ['4', '100', '1', '6']),
    group('fumbles', ['fumblesLost'], [['rb', 'RB', ['0']]], ['0']),
  ] }] }, allplayFootballPlays: { count: 1, items: [{ homeScore: 7, awayScore: 3, type: { text: 'End of Game' } }] } };
}
test('football missing offensive categories become zero only when published team totals reconcile', () => {
  const data = football(), player = normalizeSummary(data, 'nfl').players.find(p => p.id === 'p1');
  assert.equal(player.stats.receptions, 0);
  assert.equal(player.stats.rushingYards, 0);
  assert.equal(player.stats.fumblesLost, 0);
  assert.equal(player.stats.twoPointConversions, 0);
  data.boxscore.players[0].statistics.find(g => g.name === 'receiving').totals[0] = '10';
  const incomplete = normalizeSummary(data, 'nfl').players.find(p => p.id === 'p1');
  assert.equal(incomplete.stats.receptions, undefined);
});
test('missing, truncated, or mismatched football scoring logs never invent rare-scoring zeros', () => {
  for (const change of [d => delete d.allplayFootballPlays, d => d.allplayFootballPlays.count++,
    d => d.allplayFootballPlays.items[0].homeScore++, d => delete d.header.competitions[0].competitors[0].score]) {
    const data = football(); change(data);
    const player = normalizeSummary(data, 'nfl').players.find(p => p.id === 'p1');
    assert.equal(player.stats.twoPointConversions, undefined);
    assert.equal(player.stats.returnTouchdowns, undefined);
  }
});
test('successful two-point passes credit verified passer and receiver, not nullified return touchdowns', () => {
  const data = football();
  data.allplayFootballPlays.items.unshift({ scoringPlay: true, type: { text: 'Two-Point Pass' }, participants: [
    { type: 'passer', athlete: { $ref: 'https://sports.core.api.espn.com/athletes/1' } },
    { type: 'receiver', athlete: { id: 'wr' } },
  ] });
  data.allplayFootballPlays.items.unshift({ scoringPlay: true, type: { text: 'Kickoff Return Touchdown' }, text: 'Touchdown NULLIFIED by penalty - No Play' });
  data.allplayFootballPlays.count = 3;
  const players = normalizeSummary(data, 'nfl').players;
  assert.equal(players.find(p => p.id === 'wr').stats.twoPointConversions, 1);
  assert.equal(players.find(p => p.id === 'p1').stats.returnTouchdowns, 0);
});
test('own football forecasts now produce complete DK/FD points when all scoring inputs are verified', () => {
  const first = normalizeSummary(football(), 'nfl'), second = { ...first, id: '112', date: '2026-10-04T20:00:00Z' };
  const candidate = { id: 'p1', name: 'Recorded Player', teamId: 'a', team: 'AAA', opponentId: 'b', opponent: 'BBB',
    position: 'QB', availability: 'Active', participation: 'Conditional' };
  const result = calculatePlayers('nfl', [candidate], [first, second], { recentGames: 3, recentWeight: 70, matchupWeight: 25 }, '2026-10-05T00:00:00Z', 2);
  for (const site of ['draftkings', 'fanduel']) {
    const forecast = result.players[0].fantasy.find(f => f.site === site);
    assert.equal(forecast.status, 'ready');
    assert.equal(forecast.mean, 8);
    assert.equal(forecast.simulations, 2048);
  }
});
test('MLB supplemental scoring requires verified full team identity, final score and a unique player name', () => {
  const data = { ...base(), boxscore: { players: [{ team: { id: 'a' }, statistics: [
    group('batting', ['atBats', 'hits', 'runs', 'RBIs', 'homeRuns', 'walks', 'strikeouts'],
      [['p1', 'OF', ['3', '2', '1', '0', '0', '0', '1']]], []),
  ] }] }, allplayBaseballBox: { teams: { home: { team: { name: 'Team A' }, teamStats: { batting: { runs: 7 } },
    players: { ID99: { person: { fullName: 'Recorded Player' }, stats: { batting: {
      gamesPlayed: 1, hits: 2, doubles: 1, triples: 0, homeRuns: 0, stolenBases: 1, hitByPitch: 0,
    } } } } } } } };
  const game = normalizeSummary(data, 'mlb'), player = game.players[0];
  assert.equal(player.stats.singles, 1); assert.equal(player.stats.doubles, 1); assert.equal(player.stats.stolenBases, 1);
  const candidate = { id: 'p1', name: player.name, teamId: 'a', team: 'AAA', opponentId: 'b', opponent: 'BBB', position: 'OF',
    availability: 'Active', participation: 'Conditional' };
  const forecasts = calculatePlayers('mlb', [candidate], [game, { ...game, id: '112', date: '2026-10-02T20:00:00Z' }],
    { recentGames: 3, recentWeight: 70, matchupWeight: 25 }, '2026-10-05T00:00:00Z', 2).players[0].fantasy;
  assert.equal(forecasts.find(f => f.site === 'draftkings').mean, 15);
  assert.equal(forecasts.find(f => f.site === 'fanduel').mean, 18.2);
  data.allplayBaseballBox.teams.home.teamStats.batting.runs = 0;
  assert.equal(normalizeSummary(data, 'mlb').players[0].stats.singles, undefined);
});
test('site-specific own scoring has distinct PPR/fumble rules and verified baseball weights', () => {
  const v = { passingYards: 0, passingTDs: 0, interceptionsThrown: 0, rushingYards: 0, rushingTDs: 0,
    receivingYards: 0, receivingTDs: 0, receptions: 4, fumblesLost: 1, twoPointConversions: 0, returnTouchdowns: 0, fumbleRecoveryTouchdowns: 0 };
  assert.equal(scoreOutcome(scoringRule('nfl', 'draftkings', false, 'WR'), v), 3);
  assert.equal(scoreOutcome(scoringRule('nfl', 'fanduel', false, 'WR'), v), 0);
  assert.equal(scoreOutcome(scoringRule('mlb', 'draftkings', false, 'SP'), { inningsPitched: 6, pitcherStrikeouts: 6, wins: 1,
    earnedRuns: 1, hitsAllowed: 4, walksAllowed: 1, hitBatters: 0, completeGames: 0, shutouts: 0, noHitters: 0 }), 24.5);
});
test('season-opener history prioritizes latest verified same-phase games, excluding live/future results', () => {
  const e = (id, date, phase, completed = true) => ({ id, date, seasonType: { type: phase }, competitions: [{ status: { type: { completed } } }] });
  const payload = { events: [e('1', '2025-10-01', 2), e('2', '2026-10-01', 2), e('3', '2026-10-13', 2),
    e('4', '2026-10-02', 1), e('5', '2026-10-03', 2, false)] };
  assert.deepEqual(completedScheduleIds(payload, '2026-10-13T00:00:00Z', 2), ['2', '1']);
  assert.deepEqual(completedScheduleIds(payload, '2026-10-13T00:00:00Z', 2, 1), ['2']);
});
