import { useEffect, useRef, useState } from 'react';
import type { DfsSport } from '@workspace/api-client-react';
import { ExternalLink } from 'lucide-react';
import XSourcePicker from './x-source-picker';
import { DEFAULT_X_FEEDS, defaultXSource, readXSource } from '@/lib/x-sources';

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
  const account = DEFAULT_X_FEEDS[sport];
  const [initial] = useState(() => {
    try { return { source: readXSource(sport, window.localStorage), warning: '' }; }
    catch { return { source: defaultXSource(sport), warning: 'Saved source could not be read. Using the default; browser storage may be unavailable or the saved URL invalid.' }; }
  });
  const [source, setSource] = useState(initial.source);
  const isDefault = source.url === defaultXSource(sport).url;
  const note = isDefault ? account.note : source.username?.toLowerCase() === 'underdog'
    ? 'Underdog’s main account includes multiple sports; this feed is not sport-specific.' : undefined;
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'embedded' | 'unavailable'>('loading');
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();
    // Each sport/source gets a new widget-owned target so late renders cannot
    // enter the current timeline.
    const target = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.className = 'twitter-timeline';
    anchor.href = source.url;
    anchor.textContent = `Posts from ${source.label}`;
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
  }, [source.url, source.label, account.label]);

  return <section className="panel x-panel" id="x-section" aria-labelledby="x-heading">
    <div className="panel-head panel-head-accent">
      <h2 className="panel-title" id="x-heading"><span className="x-mark">𝕏</span> {account.label} on X</h2>
      <span className="panel-meta">FREE HTML EMBED</span>
    </div>
    <div className="x-feed-meta"><span>{source.label} · {isDefault ? 'Default' : 'Custom'}</span><span>No paid X API requests</span></div>
    <XSourcePicker sport={sport} label={account.label} source={source} onChange={setSource} storageWarning={initial.warning} />
    <div className="panel-body x-scroll x-timeline-scroll" role="region" aria-labelledby="x-heading" tabIndex={0} data-testid="x-feed-scroll">
      {status === 'loading' && <p className="x-embed-status" role="status">Loading X’s public timeline…</p>}
      {status === 'unavailable' && <div className="x-feed-state" role="status"><strong>X’s embed isn’t available right now</strong><p>X or your browser may limit embedded timelines. Open this sport’s source using the link below.</p></div>}
      <div ref={hostRef} className="x-timeline-host" data-testid={`x-timeline-${sport}`} data-x-account={source.username} data-x-source={source.url} />
    </div>
    <div className="x-embed-footer">
      <a className="text-link" href={source.url} target="_blank" rel="noopener noreferrer">Open {source.label} on X <ExternalLink size={12} /></a>
      {note && <p>{note}</p>}
      <p>X controls which posts appear and may require sign-in. Custom sources may include multiple sports. These are recent source posts, not filtered by sport or the DFS slate date.</p>
    </div>
  </section>;
}
