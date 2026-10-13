import { useEffect, useRef, useState } from 'react';
import type { DfsSport } from '@workspace/api-client-react';
import { ExternalLink } from 'lucide-react';

const FEEDS: Record<DfsSport, { username: string; label: string; note?: string }> = {
  nfl: { username: 'UnderdogNFL', label: 'NFL' },
  nhl: { username: 'NHL', label: 'NHL', note: 'A dedicated Underdog NHL account has not been verified. This is the official NHL feed.' },
  wnba: { username: 'UnderdogWNBA', label: 'WNBA' },
  nba: { username: 'UnderdogNBA', label: 'NBA' },
  mlb: { username: 'UnderdogMLB', label: 'MLB' },
  nascar: { username: 'Underdog', label: 'NASCAR', note: 'Using Underdog’s main account for this tab, as requested. It includes other sports and is not NASCAR-only.' },
  cfb: { username: 'UnderdogCFB', label: 'College football' },
};

type WidgetApi = { widgets: { load: (root: HTMLElement) => void } };
type WidgetWindow = Window & {
  twttr?: Partial<WidgetApi> & { ready?: (callback: (api: WidgetApi) => void) => void };
};
let scriptPromise: Promise<WidgetApi> | undefined;

function loadWidgets(): Promise<WidgetApi> {
  const api = (window as WidgetWindow).twttr;
  if (api?.widgets?.load) return Promise.resolve(api as WidgetApi);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<WidgetApi>((resolve, reject) => {
    let settled = false;
    const finish = (readyApi?: WidgetApi) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (readyApi?.widgets?.load) resolve(readyApi);
      else reject(new Error('X website widget unavailable'));
    };
    const timer = window.setTimeout(() => finish(), 15000);
    const ready = () => {
      const loaded = (window as WidgetWindow).twttr;
      if (loaded?.widgets?.load) finish(loaded as WidgetApi);
      else if (loaded?.ready) loaded.ready(finish);
      else finish();
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-allplay-x-widget]');
    if (!script) {
      script = document.createElement('script');
      // Same official free embed script as the HTML supplied by the user.
      script.src = 'https://platform.x.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      script.dataset.allplayXWidget = 'true';
      script.addEventListener('load', () => {
        if (script) script.dataset.loaded = 'true';
        ready();
      }, { once: true });
      script.addEventListener('error', () => {
        script?.remove();
        finish();
      }, { once: true });
      document.head.appendChild(script);
    } else if (script.dataset.loaded === 'true') {
      ready();
    } else {
      script.addEventListener('load', ready, { once: true });
      script.addEventListener('error', () => finish(), { once: true });
    }
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

export default function XTimeline({ sport }: { sport: DfsSport }) {
  const account = FEEDS[sport];
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'embedded' | 'unavailable'>('loading');
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();
    // The widget owns this subtree, not React. Each sport gets a new target so
    // a late render from the previous sport cannot enter the current timeline.
    const target = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.className = 'twitter-timeline';
    anchor.href = `https://x.com/${account.username}?ref_src=twsrc%5Etfw`;
    anchor.textContent = `Posts by ${account.username}`;
    anchor.dataset.theme = 'dark';
    anchor.dataset.height = '360';
    anchor.dataset.chrome = 'noheader nofooter noborders transparent';
    anchor.dataset.dnt = 'true';
    target.appendChild(anchor);
    host.appendChild(target);
    setStatus('loading');
    const timeout = window.setTimeout(() => {
      if (!cancelled) setStatus('unavailable');
    }, 20000);
    const observer = new MutationObserver(() => {
      const iframe = target.querySelector('iframe');
      if (iframe && iframe.classList.contains('twitter-timeline-rendered') && iframe.getBoundingClientRect().height > 0 && iframe.style.display !== 'none' && !cancelled) {
        iframe.title = `${account.label} posts on X`;
        window.clearTimeout(timeout);
        setStatus('embedded');
      }
    });
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    loadWidgets().then((api) => {
      if (!cancelled) api.widgets.load(target);
    }).catch(() => {
      if (!cancelled) {
        window.clearTimeout(timeout);
        setStatus('unavailable');
      }
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      host.replaceChildren();
    };
  }, [account.username, account.label]);

  return <section className="panel x-panel" id="x-section" aria-labelledby="x-heading">
    <div className="panel-head panel-head-accent">
      <h2 className="panel-title" id="x-heading"><span className="x-mark">𝕏</span> {account.label} on X</h2>
      <span className="panel-meta">FREE HTML EMBED</span>
    </div>
    <div className="x-feed-meta"><span>@{account.username}</span><span>No paid X API requests</span></div>
    <div className="panel-body x-scroll x-timeline-scroll" role="region" aria-labelledby="x-heading" tabIndex={0} data-testid="x-feed-scroll">
      {status === 'loading' && <p className="x-embed-status" role="status">Loading X’s public timeline…</p>}
      {status === 'unavailable' && <div className="x-feed-state" role="status"><strong>X’s embed isn’t available right now</strong><p>X or your browser may limit embedded timelines. Open this sport’s account using the link below.</p></div>}
      <div ref={hostRef} className="x-timeline-host" data-testid={`x-timeline-${sport}`} data-x-account={account.username} />
    </div>
    <div className="x-embed-footer">
      <a className="text-link" href={`https://x.com/${account.username}`} target="_blank" rel="noopener noreferrer">Open @{account.username} on X <ExternalLink size={12} /></a>
      {account.note && <p>{account.note}</p>}
      <p>X controls which posts appear and may require sign-in. These are recent account posts, not filtered by the DFS slate date.</p>
    </div>
  </section>;
}
