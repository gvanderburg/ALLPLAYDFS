import { useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import type { DfsCompetitor, DfsEvent } from '@workspace/api-client-react';

function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time TBD' : date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function signedLine(value?: number | null, spread = false) {
  if (value == null) return '—';
  if (spread && value === 0) return 'PK';
  return value > 0 ? `+${value}` : String(value);
}

export function gameState(status: string) {
  const final = /final|complete|finished|full time|^ft$|^post$/i.test(status);
  const live = !final && /live|in.progress|\b[1-9](st|nd|rd|th)\b|halftime|intermission/i.test(status);
  const interrupted = /postpon|cancel|delay|suspend/i.test(status);
  return { final, live, hasScore: final || live, label: final ? 'Final' : live || interrupted ? status : 'Scheduled' };
}

function teams(event: DfsEvent) {
  const away = event.competitors.find((team) => team.homeAway === 'away');
  const home = event.competitors.find((team) => team.homeAway === 'home');
  return { away, home, teamGame: !!away && !!home };
}

function pair(away: DfsCompetitor | undefined, home: DfsCompetitor | undefined, key: 'spread' | 'moneyline') {
  return `${away?.abbreviation || 'Away'} ${signedLine(away?.[key], key === 'spread')} · ${home?.abbreviation || 'Home'} ${signedLine(home?.[key], key === 'spread')}`;
}

export function EventSlate({ events, loading }: { events: DfsEvent[]; loading: boolean }) {
  if (loading) return <div className="slate-matchup-grid" aria-label="Loading slate" aria-busy="true">{[1, 2, 3, 4].map((n) => <div className="skeleton" key={n} style={{ height: 190 }} />)}</div>;
  if (!events.length) return <div className="state-box"><div className="state-icon"><CalendarDays size={17} /></div><strong>No events on this slate</strong><p>No games were returned for this date and sport. Try another date or refresh the slate.</p></div>;
  return <div className="slate-matchup-grid">{events.map((event) => {
    const { away, home, teamGame } = teams(event);
    const state = gameState(event.status);
    return <article className="slate-game" id={`game-${event.id}`} key={event.id} tabIndex={-1} data-testid={`event-${event.id}`} aria-label={event.name}>
      <div className="slate-game-top"><time dateTime={event.startTime}>{clock(event.startTime)}</time><span className={`slate-game-status ${state.live ? 'is-live' : ''}`}>{state.label}</span></div>
      <div className="slate-game-main">
        {teamGame ? <div className="slate-game-teams">{[away!, home!].map((team) => <div className="slate-game-team" key={team.id}>
          <span className="slate-team-code" aria-hidden="true">{team.abbreviation || '—'}</span>
          <span className="slate-team-name" title={team.name}>{team.name}<small>{team.homeAway === 'home' ? 'HOME' : 'AWAY'}</small></span>
          <strong className="slate-team-score">{state.hasScore ? team.score ?? '—' : '—'}</strong>
        </div>)}</div> : <h3 className="slate-race-name">{event.name}</h3>}
        <div className="slate-game-markets">
          <div><small>{event.sport === 'nascar' ? 'RACE TOTAL' : 'OVER / UNDER'}</small><strong>{event.totalPoints ?? '—'}</strong></div>
          {teamGame && <><div><small>SPREAD</small><strong>{pair(away, home, 'spread')}</strong></div><div><small>MONEYLINE</small><strong>{pair(away, home, 'moneyline')}</strong></div></>}
        </div>
      </div>
      <div className="slate-game-foot"><span title={event.venue || 'Venue unavailable'}><MapPin size={11} />{event.venue || 'Venue unavailable'}</span><span title={event.oddsSource ? `${event.oddsSource} · American odds` : 'No published lines'}>{event.oddsSource || 'Lines unavailable'}</span></div>
    </article>;
  })}</div>;
}

export function GameTicker({ events, sport, date, loading, error, updatedAt }: { events: DfsEvent[]; sport: string; date: string; loading: boolean; error: boolean; updatedAt?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => track.current?.scrollBy({ left: direction * Math.max(220, track.current.clientWidth * .7), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return <section className="top-game-strip" aria-label={`${sport} game strip`} data-testid="game-ticker">
    <div className="game-strip-label"><span>SLATE & SCORES</span><strong>{sport} <small>{date}</small></strong><small>{error ? 'Update failed · retry above' : loading ? 'Updating slate…' : updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting slate data'}</small></div>
    <button type="button" className="game-strip-arrow" onClick={() => scroll(-1)} disabled={events.length < 2} aria-label="Scroll games left"><ChevronLeft size={16} /></button>
    <div ref={track} className="game-strip-track" tabIndex={0} role="region" aria-label={`Scroll through ${sport} games`} aria-busy={loading}>
      {events.map((event) => {
        const { away, home, teamGame } = teams(event);
        const state = gameState(event.status);
        const spreadTeam = home?.spread != null ? home : away;
        return <a className="game-strip-item" key={event.id} href={`#game-${event.id}`} aria-label={`${event.name}, ${state.label}, ${clock(event.startTime)}. Open matchup.`} data-testid={`ticker-event-${event.id}`}>
          <span className="game-strip-meta"><span>{event.league}</span><span className={state.live ? 'is-live' : ''}>{state.hasScore ? state.label : clock(event.startTime)}</span></span>
          <span className="game-strip-matchup">{teamGame ? <><span>{away!.abbreviation}</span><strong>{state.hasScore ? `${away!.score ?? '—'} – ${home!.score ?? '—'}` : '@'}</strong><span>{home!.abbreviation}</span></> : <strong>{event.shortName || event.name}</strong>}</span>
          <span className="game-strip-lines"><span>O/U {event.totalPoints ?? '—'}</span><span>{spreadTeam ? `${spreadTeam.abbreviation} ${signedLine(spreadTeam.spread, true)}` : 'Spread —'}</span></span>
        </a>;
      })}
      {!events.length && <div className="game-strip-empty" role="status">{loading ? 'Loading the selected slate…' : error ? 'Could not load games. Use Refresh to try again.' : `No published ${sport} games for ${date}. Choose another date or sport.`}</div>}
    </div>
    <button type="button" className="game-strip-arrow" onClick={() => scroll(1)} disabled={events.length < 2} aria-label="Scroll games right"><ChevronRight size={16} /></button>
  </section>;
}
