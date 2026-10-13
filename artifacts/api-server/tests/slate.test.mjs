import test from 'node:test';
import assert from 'node:assert/strict';
import { competitorLines } from '../src/lib/event-lines.ts';
import { findNextSlate, scheduleDay } from '../src/lib/next-slate.ts';

test('ESPN nested lines retain home/away sides and positive American signs', () => {
  const odds = { pointSpread: { home: { close: { line: '-1.5' } }, away: { close: { line: '+1.5' } } },
    moneyline: { home: { close: { odds: '-115' } }, away: { close: { odds: '+105' } } } };
  assert.deepEqual(competitorLines(odds, 'home'), { spread: -1.5, moneyline: -115 });
  assert.deepEqual(competitorLines(odds, 'away'), { spread: 1.5, moneyline: 105 });
});
test('legacy favorite spread is not incorrectly assigned to home', () => {
  const odds = { spread: -3.5, awayTeamOdds: { favorite: true, moneyLine: -150 }, homeTeamOdds: { favorite: false, moneyLine: 130 } };
  assert.deepEqual(competitorLines(odds, 'away'), { spread: -3.5, moneyline: -150 });
  assert.deepEqual(competitorLines(odds, 'home'), { spread: 3.5, moneyline: 130 });
  assert.deepEqual(competitorLines({}, 'home'), { spread: null, moneyline: null });
  assert.equal(competitorLines({ moneyline: { home: { close: { odds: 0 } } } }, 'home').moneyline, null);
});
test('pick-em is real zero, while missing lines stay null', () => {
  assert.equal(competitorLines({ pointSpread: { home: { close: { line: 'PK' } } } }, 'home').spread, 0);
  assert.equal(competitorLines({ spread: -7 }, 'home').spread, null);
});
test('overnight UTC timestamps map to the correct Eastern slate day', () => {
  assert.equal(scheduleDay('2026-10-16T00:15Z'), '2026-10-15');
});
test('football discovers the next actual game day through published weeks', async () => {
  const calls = [];
  const initial = { leagues: [{ season: { year: 2026 }, calendar: [{ value: '2', entries: [
    { value: '6', startDate: '2026-10-13T07:00Z', endDate: '2026-10-20T06:59Z' },
  ] }] }] };
  const result = await findNextSlate('https://test/nfl', '2026-10-13', initial, async url => {
    calls.push(url); return { events: [{ date: '2026-10-16T00:15Z' }] };
  });
  assert.equal(result.date, '2026-10-15');
  assert.match(calls[0], /seasontype=2&week=6/);
  assert.match(calls[1], /dates=20261015&/);
});
test('daily calendar skips empty conditional dates and picks earliest real slate', async () => {
  const initial = { leagues: [{ season: { year: 2026 }, calendar: [
    '2026-10-16T07:00Z', '2026-10-14T07:00Z', '2026-10-15T07:00Z',
  ] }] };
  const result = await findNextSlate('https://test/wnba', '2026-10-13', initial, async url => ({
    events: url.includes('20261014') ? [] : [{ date: '2026-10-16T00:00Z' }],
  }));
  assert.equal(result.date, '2026-10-15');
});
test('unpublished next season stays empty instead of fabricating a slate', async () => {
  assert.equal(await findNextSlate('https://test', '2026-10-13', { leagues: [] },
    async () => ({ leagues: [], events: [] })), null);
});
test('NASCAR individual event calendars discover the next race day', async () => {
  const result = await findNextSlate('https://test/racing', '2026-10-13', {
    leagues: [{ season: { year: 2026 }, calendar: [
      { startDate: '2026-10-11T18:00Z', event: { $ref: 'past' } },
      { startDate: '2026-10-18T18:00Z', event: { $ref: 'next' } },
    ] }],
  }, async () => ({ events: [{ date: '2026-10-18T18:00Z' }] }));
  assert.equal(result.date, '2026-10-18');
});
test('a provider ignoring a future filter cannot advance to a past event', async () => {
  assert.equal(await findNextSlate('https://test', '2026-10-13', {
    leagues: [{ season: { year: 2026 }, calendar: ['2026-10-14T07:00Z'] }],
  }, async () => ({ events: [{ date: '2026-10-12T18:00Z' }] })), null);
});
