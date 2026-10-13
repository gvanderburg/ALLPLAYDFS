import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_X_FEEDS, defaultXSource, parseXSource, readXSource, resetXSource, saveXSource } from '../src/lib/x-sources.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('accepts HTTPS X/Twitter profiles and both public list URL formats', () => {
  assert.equal(parseXSource(' https://www.twitter.com/UnderdogNFL/?ref=share#top ').url, 'https://x.com/UnderdogNFL');
  assert.equal(parseXSource('https://x.com/i/lists/123456789').kind, 'list');
  assert.equal(parseXSource('https://twitter.com/NHL/lists/hockey-news').url, 'https://x.com/NHL/lists/hockey-news');
  assert.equal(parseXSource('https://X.COM/NHL').label, '@NHL');
});

test('rejects unsafe URLs, Home, posts, embed HTML and non-source routes', () => {
  for (const input of [
    'http://x.com/NHL', 'javascript:alert(1)', 'data:text/html,test', '//x.com/NHL', 'x.com/NHL',
    'https://evil.com/NHL', 'https://x.com.evil.com/NHL', 'https://x.com@evil.com/NHL',
    'https://user:password@x.com/NHL', 'https://x.com:8443/NHL', 'https://mobile.twitter.com/NHL',
    'https://x.com/home', 'https://twitter.com/Home/', 'https://x.com/explore', 'https://x.com/i',
    'https://x.com/settings', 'https://x.com/search?q=hockey', 'https://x.com/intent/tweet',
    'https://x.com/NHL/status/123', 'https://x.com/NHL/with_replies', 'https://x.com/i/lists/abc',
    'https://x.com/home/lists/test', 'https://x.com/%68ome', 'https://x.com/NHL\\evil',
    'https://x.com/NH\nL', '<script src="https://platform.x.com/widgets.js"></script>',
    '<a class="twitter-timeline" href="https://x.com/NHL">Feed</a>', '',
  ]) assert.throws(() => parseXSource(input), /HTTPS public/, input);
});

test('source changes persist through reload and sport switching without changing other sports', () => {
  const storage = memoryStorage();
  const source = saveXSource('nfl', 'https://twitter.com/i/lists/123456789', storage);
  assert.equal(source.url, 'https://x.com/i/lists/123456789');
  assert.deepEqual(readXSource('nfl', storage), source);
  assert.deepEqual(readXSource('nba', storage), defaultXSource('nba'));
  saveXSource('nba', 'https://x.com/NBA', storage);
  assert.deepEqual(readXSource('nfl', storage), source);
  assert.equal(readXSource('nba', storage).username, 'NBA');
  assert.deepEqual(resetXSource('nfl', storage), defaultXSource('nfl'));
  assert.deepEqual(readXSource('nfl', storage), defaultXSource('nfl'));
  assert.equal(readXSource('nba', storage).username, 'NBA');
});

test('invalid edits do not overwrite a saved source and stored URLs are revalidated', () => {
  const storage = memoryStorage();
  const source = saveXSource('nhl', 'https://x.com/i/lists/123456789', storage);
  assert.throws(() => saveXSource('nhl', 'https://x.com/home', storage));
  assert.deepEqual(readXSource('nhl', storage), source);
  storage.setItem('allplay:x-source:v1:nhl', 'javascript:alert(1)');
  assert.throws(() => readXSource('nhl', storage));
  resetXSource('nhl', storage);
  assert.deepEqual(readXSource('nhl', storage), defaultXSource('nhl'));
});

test('preserves every verified default, NHL exception and NASCAR mixed-sport disclosure', () => {
  assert.deepEqual(Object.values(DEFAULT_X_FEEDS).map((feed) => feed.username),
    ['UnderdogNFL', 'NHL', 'UnderdogWNBA', 'UnderdogNBA', 'UnderdogMLB', 'Underdog', 'UnderdogCFB']);
  assert.match(DEFAULT_X_FEEDS.nascar.note, /other sports/);
  for (const sport of Object.keys(DEFAULT_X_FEEDS)) {
    const storage = memoryStorage();
    saveXSource(sport, 'https://x.com/TestAccount', storage);
    assert.deepEqual(resetXSource(sport, storage), defaultXSource(sport));
    assert.deepEqual(readXSource(sport, storage), defaultXSource(sport));
  }
});

test('storage failures are surfaced to callers, not treated as successful saves', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.throws(() => readXSource('nfl', blocked), /blocked/);
  assert.throws(() => saveXSource('nfl', 'https://x.com/NFL', blocked), /blocked/);
  assert.throws(() => resetXSource('nfl', blocked), /blocked/);
});
