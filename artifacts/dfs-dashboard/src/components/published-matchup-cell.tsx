import type { PublishedMatchupRanking } from '@workspace/api-client-react';

export function PublishedMatchupCell({ ranking }: { ranking?: PublishedMatchupRanking }) {
  if (!ranking || ranking.status !== 'available' || ranking.rank == null)
    return <span className="model-missing" title={ranking ? `${ranking.period}. ${ranking.note}` : 'Published source unavailable'}>{ranking?.status === 'stale' ? 'Stale' : ranking?.status === 'unavailable' ? 'Unavailable' : '—'}</span>;
  const easy = ranking.rankOneMeans === 'most-allowed' ? ranking.rank <= 8 : ranking.rank >= 25;
  const hard = ranking.rankOneMeans === 'strongest' ? ranking.rank <= 8 : ranking.rank >= 25;
  return <a className={`published-matchup ${easy ? 'matchup-easy' : hard ? 'matchup-hard' : ''}`}
    href={ranking.sourceUrl} target="_blank" rel="noopener noreferrer"
    aria-label={`${ranking.source === 'pff' ? 'PFF' : 'FantasyPros'} ${ranking.unit} rank ${ranking.rank} of ${ranking.rankedTeams}. Opens source in a new tab.`}
    title={`${ranking.period}. #1 = ${ranking.rankOneMeans === 'strongest' ? 'strongest defense' : 'most fantasy production allowed'}. ${ranking.note}`}>
    #{ranking.rank}<small>{ranking.source === 'pff' ? 'secondary' : ranking.unit}</small>
  </a>;
}
