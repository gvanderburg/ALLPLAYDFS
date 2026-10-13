import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { getGetDfsDashboardQueryKey, useGetDfsDashboard } from '@workspace/api-client-react';
import type { DfsSport } from '@workspace/api-client-react';
import { ArrowLeft, Newspaper, RefreshCw } from 'lucide-react';
import { MODEL_SPORTS } from '@/components/model-projections';
import { NewsFeed } from '@/pages/dashboard';
import '@/styles/news-desk.css';

export default function NewsDesk() {
  const { userId, isSignedIn } = useAuth();
  const [sport, setSport] = useState<DfsSport>(() => {
    const requested = new URLSearchParams(window.location.search).get('sport');
    return MODEL_SPORTS.find(item => item.id === requested)?.id ?? 'nfl';
  });
  const [date] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const params = useMemo(() => ({ sport, date }), [sport, date]);
  const query = useGetDfsDashboard(params, { query: {
    queryKey: [...getGetDfsDashboardQueryKey(params), 'news-desk', userId ?? 'anonymous'],
    staleTime: 60_000, refetchInterval: 300_000, refetchOnWindowFocus: true,
  } });
  const news = (query.data?.news ?? []).filter(item => item.sport === sport);
  const sportLabel = MODEL_SPORTS.find(item => item.id === sport)?.label ?? sport.toUpperCase();
  useEffect(() => { document.title = `ALLPLAY · ${sportLabel} news`; }, [sportLabel]);
  const selectSport = (next: DfsSport) => {
    setSport(next);
    const url = new URL(window.location.href);
    url.searchParams.set('sport', next);
    window.history.replaceState(window.history.state, '', url);
  };

  return <div className="news-desk">
    <header className="news-desk-header">
      <span className="brand-name">ALLPLAY <span>NEWS DESK</span></span>
      <nav className="news-desk-nav" aria-label="ALLPLAY sections"><Link className="btn btn-quiet" href={isSignedIn ? '/user-portal' : '/'}><ArrowLeft size={14} />Dashboard</Link><Link className="btn btn-quiet" href="/projections">Projections</Link><Link className="btn btn-quiet" href="/takes">Takes</Link><Link className="btn btn-quiet" href="/feedback">Feedback</Link>{isSignedIn ? <Link className="btn btn-quiet" href="/account">Account</Link> : <Link className="btn btn-quiet" href="/sign-in">Sign in</Link>}</nav>
    </header>
    <main className="news-desk-main">
      <div className="news-desk-heading">
        <div><div className="eyebrow">SPORTS &amp; FANTASY NEWS</div><h1>{sportLabel} news</h1><p className="subhead">Latest reporting, player updates and fantasy headlines.</p></div>
        <button className="btn btn-quiet" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Refresh news"><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} />Refresh</button>
      </div>
      <nav className="news-desk-sports" aria-label="News sport">
        {MODEL_SPORTS.map(item => <button key={item.id} className={`model-sport-tab ${sport === item.id ? 'active' : ''}`} aria-pressed={sport === item.id} onClick={() => selectSport(item.id)}>{item.short}</button>)}
      </nav>
      <section className="panel" aria-labelledby="news-desk-feed-heading">
        <div className="panel-head panel-head-accent"><h2 className="panel-title" id="news-desk-feed-heading"><Newspaper size={16} />{sportLabel} headlines</h2><span className="panel-meta">{query.isFetching ? 'UPDATING' : `${news.length} STORIES`}</span></div>
        <div className="panel-body news-desk-feed" aria-live="polite">
          {query.isError && <div className="state-box" role="alert"><strong>News could not refresh</strong><p>{query.data ? 'Showing the last available stories. Use Refresh to try again.' : 'Use Refresh to try loading the news again.'}</p></div>}
          {(!query.isError || query.data) && <NewsFeed news={news} loading={query.isLoading && !query.data} />}
        </div>
      </section>
    </main>
  </div>;
}
