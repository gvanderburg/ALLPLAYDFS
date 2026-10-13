import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  FeedbackTicketInputCategory, FeedbackTicketUpdateStatus,
  getListFeedbackTicketsQueryKey, useCreateFeedbackTicket,
  useListFeedbackTickets, useUpdateFeedbackTicket,
  type DfsSport, type FeedbackTicket, type FeedbackTicketStatus,
} from '@workspace/api-client-react';
import { Activity, AlertCircle, ArrowLeft, Check, ChevronDown, ChevronRight, CircleHelp, Inbox, MessageSquareText, RefreshCw, Send, ShieldCheck, TicketCheck } from 'lucide-react';

const SPORTS: { id: DfsSport; label: string }[] = [
  { id: 'nfl', label: 'NFL' }, { id: 'nhl', label: 'NHL' }, { id: 'wnba', label: 'WNBA' },
  { id: 'nba', label: 'NBA' }, { id: 'mlb', label: 'MLB' }, { id: 'nascar', label: 'NASCAR' },
  { id: 'cfb', label: 'College football' },
];
const CATEGORY_LABEL: Record<string, string> = { issue: 'Issue', request: 'Feature request', general: 'General feedback' };
const STATUS_LABEL: Record<FeedbackTicketStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
const BASE_KEY = getListFeedbackTicketsQueryKey();
type TicketDraft = { status: FeedbackTicketStatus; ownerResponse: string; baseStatus: FeedbackTicketStatus; baseResponse: string };
const draftFor = (ticket: FeedbackTicket): TicketDraft => ({ status: ticket.status, ownerResponse: ticket.ownerResponse, baseStatus: ticket.status, baseResponse: ticket.ownerResponse });
type FormDraft = { category: typeof FeedbackTicketInputCategory[keyof typeof FeedbackTicketInputCategory]; subject: string; details: string; sport: string; contextPath: string };
const blankDraft: FormDraft = { category: FeedbackTicketInputCategory.issue, subject: '', details: '', sport: '', contextPath: '' };

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'That did not go through. Check your connection and try again.';
}
function statusName(status: FeedbackTicketStatus) { return STATUS_LABEL[status]; }

export default function FeedbackPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = isLoaded && isSignedIn === true;
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [before, setBefore] = useState<number | undefined>();
  const [collected, setCollected] = useState<{ scopeKey: string; items: FeedbackTicket[] }>({ scopeKey: '', items: [] });
  const [form, setForm] = useState<FormDraft>({ ...blankDraft });
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [ticketDrafts, setTicketDrafts] = useState<Record<number, TicketDraft>>({});
  const [savedTicketId, setSavedTicketId] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<Record<number, string>>({});
  const identity = signedIn ? userId ?? 'signed-in' : 'signed-out';
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const scopeKey = `${identity}:${scope}`;
  const params = useMemo(() => ({ scope, ...(before !== undefined ? { before } : {}) }), [scope, before]);
  const queryKey = useMemo(() => [...getListFeedbackTicketsQueryKey(params), { clerkUserId: identity }] as const, [params, identity]);
  const ticketsQuery = useListFeedbackTickets(params, {
    query: { queryKey, enabled: isLoaded && signedIn, staleTime: 30_000, gcTime: 5 * 60_000, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 60_000, retry: 1 },
  });
  const createTicket = useCreateFeedbackTicket();
  const updateTicket = useUpdateFeedbackTicket();
  const pageData = ticketsQuery.data;
  const isOwner = pageData?.isOwner === true;
  const items = collected.scopeKey === scopeKey ? collected.items : [];
  const visibleTickets = useMemo(() => {
    const deduped = new Map<number, FeedbackTicket>();
    for (const item of items) deduped.set(item.id, item);
    return [...deduped.values()].sort((a, b) => b.id - a.id);
  }, [items]);

  useEffect(() => {
    setScope('mine');
    createTicket.reset();
    updateTicket.reset();
  }, [identity]);
  useEffect(() => {
    document.title = 'Feedback & support | ALLPLAY';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Send ALLPLAY feedback, track your tickets and read owner responses.');
  }, []);
  useEffect(() => {
    setCollected({ scopeKey, items: [] });
    setBefore(undefined);
    setTicketDrafts({});
    setUpdateError({});
    setSavedTicketId(null);
    setSubmitError('');
    setSubmitSuccess('');
    setForm({ ...blankDraft });
  }, [identity, scope]);
  useEffect(() => {
    if (!pageData || !signedIn) return;
    setCollected((current) => {
      const prior = current.scopeKey === scopeKey ? current.items : [];
      const combined = new Map(prior.map((item) => [item.id, item]));
      for (const item of pageData.items) combined.set(item.id, item);
      return { scopeKey, items: [...combined.values()] };
    });
    setTicketDrafts((current) => {
      const next = { ...current };
      for (const ticket of pageData.items) {
        const draft = next[ticket.id];
        if (!draft || (draft.status === draft.baseStatus && draft.ownerResponse === draft.baseResponse)) next[ticket.id] = draftFor(ticket);
      }
      return next;
    });
  }, [pageData, scopeKey, signedIn]);

  const invalidateTickets = async () => {
    await queryClient.invalidateQueries({ queryKey: BASE_KEY });
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signedIn || createTicket.isPending) return;
    const subject = form.subject.trim();
    const details = form.details.trim();
    const contextPath = form.contextPath.trim();
    if (subject.length < 3 || subject.length > 120) { setSubmitError('Subject must be between 3 and 120 characters.'); return; }
    if (details.length < 10 || details.length > 4000) { setSubmitError('Details must be between 10 and 4,000 characters.'); return; }
    if (contextPath && (contextPath.length > 200 || !/^\/[a-zA-Z0-9/_-]*$/.test(contextPath))) { setSubmitError('Use a site path beginning with /, with no query string or special characters.'); return; }
    setSubmitError('');
    setSubmitSuccess('');
    const actor = identity;
    try {
      const saved = await createTicket.mutateAsync({ data: {
        category: form.category, subject, details,
        sport: form.sport ? form.sport as DfsSport : null,
        contextPath: contextPath || null,
      } });
      if (identityRef.current !== actor) return;
      setCollected((current) => {
        const prior = current.scopeKey === scopeKey ? current.items : [];
        return { scopeKey, items: [saved, ...prior.filter((item) => item.id !== saved.id)] };
      });
      setForm({ ...blankDraft });
      setSubmitSuccess(`Ticket #${saved.id} is in. Your ticket history is below.`);
      setBefore(undefined);
      await invalidateTickets();
    } catch (error) {
      if (identityRef.current !== actor) return;
      setSubmitError(errorMessage(error));
    }
  };
  const saveOwnerUpdate = async (ticket: FeedbackTicket) => {
    if (!isOwner || updateTicket.isPending) return;
    const draft = ticketDrafts[ticket.id] ?? draftFor(ticket);
    const actor = identity;
    setUpdateError((current) => ({ ...current, [ticket.id]: '' }));
    try {
      const updated = await updateTicket.mutateAsync({
        ticketId: ticket.id,
        data: { status: draft.status, ownerResponse: draft.ownerResponse },
      });
      if (identityRef.current !== actor) return;
      setCollected((current) => ({ ...current, items: current.items.map((item) => item.id === updated.id ? updated : item) }));
      setTicketDrafts((current) => ({ ...current, [ticket.id]: draftFor(updated) }));
      setSavedTicketId(ticket.id);
      await invalidateTickets();
    } catch (error) {
      if (identityRef.current !== actor) return;
      setUpdateError((current) => ({ ...current, [ticket.id]: errorMessage(error) }));
    }
  };
  const switchScope = (next: 'mine' | 'all') => {
    setScope(next);
    setBefore(undefined);
  };
   const retry = async () => { setBefore(undefined); await invalidateTickets(); };
  const canLoadMore = pageData?.nextCursor != null;

  return <div className="app-shell feedback-app">
    <header className="topbar">
      <Link href="/user-portal" className="brand" aria-label="ALLPLAY dashboard"><span className="brand-mark"><Activity size={17} /></span><span className="brand-name">ALLPLAY</span></Link>
      <nav className="feedback-top-nav" aria-label="Dashboard navigation">
        <Link href="/user-portal" className="btn btn-quiet"><ArrowLeft size={14} />Dashboard</Link>
        <Link href="/projections" className="btn btn-quiet">Model</Link>
        <Link href="/takes" className="btn btn-quiet">Takes</Link>
        {signedIn ? <Link href="/account" className="btn btn-quiet">Account</Link> : <Link href="/sign-in" className="btn btn-quiet">Sign in</Link>}
      </nav>
    </header>
    <aside className="side-rail" aria-label="Dashboard navigation">
      <div className="rail-caption">YOUR WORKSPACE</div>
      <Link className="rail-link" href="/user-portal"><Activity size={15} />Overview</Link>
      <Link className="rail-link" href="/projections">Projections</Link>
      <Link className="rail-link" href="/takes">Game takes</Link>
      <Link className="rail-link selected" href="/feedback" aria-current="page"><MessageSquareText size={15} />Feedback</Link>
      <Link className="rail-link" href="/account">Account</Link>
      <div className="rail-bottom"><span className="rail-caption">FEEDBACK & SUPPORT</span><div className="rail-sports">Issues · requests<br />Research feedback</div></div>
    </aside>
    <main className="main-wrap feedback-main">
      <div className="feedback-breadcrumb"><Link href="/user-portal">Dashboard</Link><span>/</span><span>Feedback</span></div>
      <div className="feedback-heading">
        <div><div className="eyebrow">ALLPLAY / YOUR VOICE</div><h1>Feedback<span>.</span></h1><p className="subhead">A direct line to the people building your research desk.</p></div>
        <div className="feedback-heading-mark"><MessageSquareText size={20} /><span>PRIVATE SUPPORT THREAD</span></div>
      </div>
      {!isLoaded ? <section className="feedback-loading" aria-label="Checking sign-in"><div className="skeleton" /><div className="skeleton" /></section>
        : !signedIn ? <section className="feedback-anon">
          <div className="feedback-anon-icon"><Inbox size={21} /></div>
          <div className="feedback-kicker">A PERSONAL INBOX FOR YOUR NOTES</div>
          <h2>Sign in to start a conversation.</h2>
          <p>Feedback is available to every ALLPLAY account—no paid membership or Whop subscription required. Sign in to submit a note and keep a private history of the replies.</p>
          <Link href="/sign-in" className="btn btn-primary" data-testid="link-feedback-sign-in">Sign in to leave feedback <ChevronRight size={15} /></Link>
        </section>
        : <div className="feedback-layout">
          <section className="feedback-compose panel" aria-labelledby="feedback-form-title">
            <div className="feedback-section-top"><div><div className="feedback-kicker">OPEN A TICKET</div><h2 id="feedback-form-title">What’s on your mind?</h2></div><span className="feedback-private"><ShieldCheck size={13} /> ACCOUNT PRIVATE</span></div>
            <p className="feedback-copy">Report a problem, ask for a change, or send a general note. Replies stay here. Don’t include passwords, API keys or payment details.</p>
            <form onSubmit={submit} noValidate>
              <label className="feedback-field"><span>Type of note</span><select value={form.category} onChange={(event) => setForm((value) => ({ ...value, category: event.target.value as typeof value.category }))} disabled={createTicket.isPending} data-testid="select-feedback-category">
                <option value={FeedbackTicketInputCategory.issue}>Issue</option><option value={FeedbackTicketInputCategory.request}>Feature request</option><option value={FeedbackTicketInputCategory.general}>General feedback</option>
              </select></label>
              <label className="feedback-field"><span>Subject <i>3–120 characters</i></span><input value={form.subject} onChange={(event) => setForm((value) => ({ ...value, subject: event.target.value }))} minLength={3} maxLength={120} placeholder="A clear headline helps us get to it faster" disabled={createTicket.isPending} data-testid="input-feedback-subject" /></label>
              <label className="feedback-field"><span>Details <i>10–4,000 characters</i></span><textarea rows={6} value={form.details} onChange={(event) => setForm((value) => ({ ...value, details: event.target.value }))} minLength={10} maxLength={4000} placeholder="What happened, what you expected, or what would make the research desk better?" disabled={createTicket.isPending} data-testid="input-feedback-details" /><small className="feedback-count">{form.details.length.toLocaleString()} / 4,000</small></label>
              <div className="feedback-fields-row">
                <label className="feedback-field"><span>Sport <i>Optional</i></span><select value={form.sport} onChange={(event) => setForm((value) => ({ ...value, sport: event.target.value }))} disabled={createTicket.isPending} data-testid="select-feedback-sport"><option value="">Not sport-specific</option>{SPORTS.map((sport) => <option key={sport.id} value={sport.id}>{sport.label}</option>)}</select></label>
                <label className="feedback-field"><span>Affected page <i>Optional</i></span><input value={form.contextPath} onChange={(event) => setForm((value) => ({ ...value, contextPath: event.target.value }))} maxLength={200} placeholder="/projections" disabled={createTicket.isPending} data-testid="input-feedback-path" /></label>
              </div>
              {submitError && <div className="feedback-alert" role="alert"><AlertCircle size={15} />{submitError}</div>}
              {submitSuccess && <div className="feedback-success" role="status"><Check size={15} />{submitSuccess}</div>}
              <div className="feedback-submit-row"><span>Only you and ALLPLAY can read this thread.</span><button className="btn btn-primary" type="submit" disabled={createTicket.isPending} data-testid="button-submit-feedback">{createTicket.isPending ? <><span className="feedback-button-pulse" />Sending…</> : <><Send size={14} />Send feedback</>}</button></div>
            </form>
          </section>
          <section className="feedback-history" aria-labelledby="feedback-history-title">
            <div className="feedback-history-head">
              <div><div className="feedback-kicker">YOUR SUPPORT HISTORY</div><h2 id="feedback-history-title">Tickets <span>{visibleTickets.length}</span></h2></div>
              {isOwner && <div className="feedback-scope" role="group" aria-label="Ticket view"><button type="button" className={scope === 'mine' ? 'active' : ''} onClick={() => switchScope('mine')} aria-pressed={scope === 'mine'}>Mine</button><button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => switchScope('all')} aria-pressed={scope === 'all'}>All tickets</button></div>}
            </div>
            {!ticketsQuery.data && ticketsQuery.isLoading ? <div className="feedback-ticket-skeleton" aria-label="Loading ticket history"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
              : ticketsQuery.isError ? <div className="feedback-history-state feedback-history-error" role="alert"><AlertCircle size={18} /><h3>History isn’t available</h3><p>Your submissions stay saved. We couldn’t load them just now.</p><button type="button" className="btn btn-quiet" onClick={retry} disabled={ticketsQuery.isFetching}><RefreshCw size={14} className={ticketsQuery.isFetching ? 'spin' : ''} />Try again</button></div>
                : visibleTickets.length === 0 ? <div className="feedback-history-state"><div className="feedback-empty-mark"><CircleHelp size={19} /></div><h3>{scope === 'all' ? 'No tickets to review.' : 'No tickets yet.'}</h3><p>{scope === 'all' ? 'New tickets from ALLPLAY accounts will appear here.' : 'When you send a note, it will live here with its number and any reply.'}</p></div>
                  : <div className="feedback-ticket-list">{visibleTickets.map((ticket) => {
                    const draft = ticketDrafts[ticket.id] ?? draftFor(ticket);
                    const dirty = draft.status !== ticket.status || draft.ownerResponse !== ticket.ownerResponse;
                    return <article className="feedback-ticket" key={ticket.id} data-testid={`card-feedback-ticket-${ticket.id}`}>
                      <div className="feedback-ticket-top"><div className="feedback-ticket-id">#{ticket.id} <span>·</span> {CATEGORY_LABEL[ticket.category]}</div><span className={`feedback-status status-${ticket.status}`}>{statusName(ticket.status)}</span></div>
                      <h3>{ticket.subject}</h3>
                      <div className="feedback-ticket-meta"><time>{readableDate(ticket.createdAt)}</time>{ticket.sport && <span>{SPORTS.find((item) => item.id === ticket.sport)?.label ?? ticket.sport.toUpperCase()}</span>}{ticket.contextPath && <code>{ticket.contextPath}</code>}</div>
                      <p className="feedback-ticket-details">{ticket.details}</p>
                      {ticket.ownerResponse && <div className="feedback-response"><div className="feedback-response-label"><TicketCheck size={14} /> ALLPLAY REPLY</div><p>{ticket.ownerResponse}</p><small>Updated {readableDate(ticket.updatedAt)}</small></div>}
                      {isOwner && <div className="feedback-owner-tools">
                        <label className="feedback-field"><span>Status</span><select value={draft.status} onChange={(event) => setTicketDrafts((current) => ({ ...current, [ticket.id]: { ...draft, status: event.target.value as FeedbackTicketStatus } }))} disabled={updateTicket.isPending} data-testid={`select-feedback-status-${ticket.id}`}>{Object.values(FeedbackTicketUpdateStatus).map((status) => <option value={status} key={status}>{statusName(status)}</option>)}</select></label>
                        <label className="feedback-field"><span>Owner response <i>0–2,000 characters · leave blank to clear</i></span><textarea rows={3} maxLength={2000} value={draft.ownerResponse} onChange={(event) => setTicketDrafts((current) => ({ ...current, [ticket.id]: { ...draft, ownerResponse: event.target.value } }))} disabled={updateTicket.isPending} data-testid={`input-feedback-response-${ticket.id}`} /></label>
                        {updateError[ticket.id] && <div className="feedback-alert" role="alert"><AlertCircle size={14} />{updateError[ticket.id]}</div>}
                        <div className="feedback-owner-save"><span role="status">{savedTicketId === ticket.id && !dirty ? <><Check size={13} /> Saved</> : ''}</span><button type="button" className="btn btn-quiet" onClick={() => void saveOwnerUpdate(ticket)} disabled={updateTicket.isPending || !dirty} data-testid={`button-save-feedback-${ticket.id}`}>{updateTicket.isPending ? 'Saving…' : 'Save update'}</button></div>
                      </div>}
                    </article>;
                  })}</div>}
            {canLoadMore && !ticketsQuery.isError && <button type="button" className="feedback-load-more" onClick={() => setBefore(pageData.nextCursor ?? undefined)} disabled={ticketsQuery.isFetching} data-testid="button-feedback-next-page">{ticketsQuery.isFetching ? 'Loading older tickets…' : <>Older tickets <ChevronDown size={14} /></>}</button>}
            {ticketsQuery.isFetching && !!ticketsQuery.data && <div className="feedback-refresh-note" role="status"><RefreshCw size={12} className="spin" />Syncing the latest ticket state</div>}
          </section>
        </div>}
      <footer className="feedback-footer"><span>ALLPLAY SUPPORT DESK</span><span>Replies stay attached to your account</span></footer>
    </main>
  </div>;
}
