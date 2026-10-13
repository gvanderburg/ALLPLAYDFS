import type { DfsSport } from '@workspace/api-client-react';

export const DEFAULT_X_FEEDS: Record<DfsSport, { username: string; label: string; note?: string }> = {
  nfl: { username: 'UnderdogNFL', label: 'NFL' },
  nhl: { username: 'NHL', label: 'NHL', note: 'A dedicated Underdog NHL account has not been verified. This is the official NHL feed.' },
  wnba: { username: 'UnderdogWNBA', label: 'WNBA' },
  nba: { username: 'UnderdogNBA', label: 'NBA' },
  mlb: { username: 'UnderdogMLB', label: 'MLB' },
  nascar: { username: 'Underdog', label: 'NASCAR', note: 'Using Underdog’s main account for this tab, as requested. It includes other sports and is not NASCAR-only.' },
  cfb: { username: 'UnderdogCFB', label: 'College football' },
};

export type XSource = { url: string; label: string; kind: 'profile' | 'list'; username?: string };
const RESERVED = new Set(['home', 'i', 'explore', 'search', 'notifications', 'messages', 'settings', 'intent', 'share', 'login', 'logout', 'signup', 'tos', 'privacy', 'about', 'help', 'jobs', 'download', 'compose', 'account', 'welcome', 'lists', 'hashtag', 'widgets', 'oauth']);
const VALIDATION_ERROR = 'Enter an HTTPS public X/Twitter profile or list URL, not Home, a post, or embed HTML.';

export function parseXSource(input: string): XSource {
  const value = input.trim();
  // Reject markup, control characters, encoded paths and URL parser repairs.
  if (!/^https:\/\/[^\\\s<>"']+$/i.test(value)) throw new Error(VALIDATION_ERROR);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(VALIDATION_ERROR); }
  if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error(VALIDATION_ERROR);
  const path = url.pathname.replace(/\/$/, '');
  const profile = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
  if (profile && !RESERVED.has(profile[1].toLowerCase())) {
    return { url: `https://x.com/${profile[1]}`, label: `@${profile[1]}`, username: profile[1], kind: 'profile' };
  }
  const list = path.match(/^\/i\/lists\/([1-9][0-9]{0,24})$/);
  if (list) return { url: `https://x.com/i/lists/${list[1]}`, label: `X list ${list[1]}`, kind: 'list' };
  const namedList = path.match(/^\/([A-Za-z0-9_]{1,15})\/lists\/([A-Za-z0-9_-]{1,100})$/);
  if (namedList && !RESERVED.has(namedList[1].toLowerCase())) {
    return { url: `https://x.com/${namedList[1]}/lists/${namedList[2]}`, label: `@${namedList[1]} / ${namedList[2]}`, kind: 'list' };
  }
  throw new Error(VALIDATION_ERROR);
}

export function defaultXSource(sport: DfsSport): XSource {
  return parseXSource(`https://x.com/${DEFAULT_X_FEEDS[sport].username}`);
}

type SourceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (sport: DfsSport) => `allplay:x-source:v1:${sport}`;

export function readXSource(sport: DfsSport, storage: SourceStorage): XSource {
  const saved = storage.getItem(storageKey(sport));
  return saved === null ? defaultXSource(sport) : parseXSource(saved);
}

export function saveXSource(sport: DfsSport, input: string, storage: SourceStorage): XSource {
  const source = parseXSource(input);
  storage.setItem(storageKey(sport), source.url);
  return source;
}

export function resetXSource(sport: DfsSport, storage: SourceStorage): XSource {
  storage.removeItem(storageKey(sport));
  return defaultXSource(sport);
}
