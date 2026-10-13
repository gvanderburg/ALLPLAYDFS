import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGameTakeFileUrl, getListGameTakesQueryKey, useCreateGameTake,
  useDeleteGameTake, useListGameTakes, useRequestTakeUpload, useUpdateGameTake,
  type GameTake, type DfsSport,
} from '@workspace/api-client-react';
import useMembership from '@/hooks/use-membership';
import MembershipCheckoutButton from '@/components/membership-checkout-button';
import {
  Activity, ArrowDownToLine, ArrowLeft, AlertCircle, BookOpen, Check,
  CircleHelp, FileText, Film, LockKeyhole, Pencil, Plus, RefreshCw,
  ShieldCheck, Trash2, UploadCloud, X,
} from 'lucide-react';

const SPORTS: { id: DfsSport; label: string }[] = [
  { id: 'nfl', label: 'NFL' }, { id: 'nhl', label: 'NHL' }, { id: 'wnba', label: 'WNBA' },
  { id: 'nba', label: 'NBA' }, { id: 'mlb', label: 'MLB' }, { id: 'nascar', label: 'NASCAR' },
  { id: 'cfb', label: 'College football' },
];
const ACCEPTED = new Map([
  ['.pdf', 'application/pdf'], ['.txt', 'text/plain'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
]);
const DOC_MAX = 25 * 1024 * 1024;
const VIDEO_MAX = 250 * 1024 * 1024;

type TakeFormValue = { title: string; description: string; sport: DfsSport; game: string };
const blankForm: TakeFormValue = { title: '', description: '', sport: 'nfl', game: '' };

function prettySize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) < 100000 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function readableDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function kindOf(take: GameTake) {
  return take.contentType.startsWith('video/') ? 'video' : 'document';
}
function UploadProgress({ percent }: { percent: number }) {
  return <div className="takes-progress" role="progressbar" aria-label="File upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ transform: `scaleX(${percent / 100})` }} /></div>;
}

function TakeForm({
  initial, mode, busy, progress, error, onClose, onSubmit,
}: {
  initial: TakeFormValue; mode: 'upload' | 'edit'; busy: boolean; progress: number | null;
  error: string | null; onClose: () => void; onSubmit: (value: TakeFormValue, file?: File) => void;
}) {
  const [value, setValue] = useState(initial);
  const [file, setFile] = useState<File | undefined>();
  const [localError, setLocalError] = useState<string | null>(null);
  const selectFile = (picked?: File) => {
    setFile(picked);
    setLocalError(null);
    if (!picked) return;
    const ext = `.${picked.name.split('.').pop()?.toLowerCase() ?? ''}`;
    const expected = ACCEPTED.get(ext);
    const type = picked.type || expected;
    if (!expected || type !== expected) {
      setLocalError('Choose a PDF, TXT, DOCX, MP4 or WebM file. The file type must match its extension.');
      setFile(undefined);
      return;
    }
    const limit = type.startsWith('video/') ? VIDEO_MAX : DOC_MAX;
    if (picked.size < 1 || picked.size > limit) {
      setLocalError(type.startsWith('video/') ? 'Videos must be 250 MB or smaller.' : 'Documents must be 25 MB or smaller.');
      setFile(undefined);
    }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.title.trim()) { setLocalError('Add a title before saving.'); return; }
    if (mode === 'upload' && !file) { setLocalError('Choose a file to upload.'); return; }
    if (value.description.length > 5000 || value.game.length > 150) { setLocalError('Description is limited to 5,000 characters and matchup to 150.'); return; }
    onSubmit({ ...value, title: value.title.trim(), description: value.description.trim(), game: value.game.trim() }, file);
  };
  return <div className="takes-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="takes-dialog" role="dialog" aria-modal="true" aria-labelledby="take-form-title">
      <div className="takes-dialog-head"><div><div className="takes-kicker">{mode === 'upload' ? 'OWNER WORKSPACE' : 'METADATA'}</div><h2 id="take-form-title">{mode === 'upload' ? 'Add a game take' : 'Edit game take'}</h2></div><button className="btn btn-quiet icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></div>
      <form onSubmit={submit}>
        {mode === 'upload' && <label className="takes-field takes-file-field"><span>File <i>PDF, TXT, DOCX up to 25 MB · MP4 / WebM up to 250 MB</i></span><input type="file" accept=".pdf,.txt,.docx,.mp4,.webm,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,video/webm" onChange={(e) => selectFile(e.target.files?.[0])} disabled={busy} data-testid="input-take-file" />{file && <small><Check size={13} />{file.name} · {prettySize(file.size)}</small>}</label>}
        <label className="takes-field"><span>Title <i>Required</i></span><input autoFocus maxLength={150} value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder="e.g. Red zone concepts from Week 6" disabled={busy} data-testid="input-take-title" /></label>
        <label className="takes-field"><span>Description <i>Optional · up to 5,000 characters</i></span><textarea rows={3} maxLength={5000} value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="A short note on what members will find inside." disabled={busy} data-testid="input-take-description" /></label>
        <div className="takes-form-row"><label className="takes-field"><span>Sport</span><select value={value.sport} onChange={(e) => setValue({ ...value, sport: e.target.value as DfsSport })} disabled={busy} data-testid="select-take-sport">{SPORTS.map((sport) => <option key={sport.id} value={sport.id}>{sport.label}</option>)}</select></label><label className="takes-field"><span>Matchup <i>Optional</i></span><input maxLength={150} value={value.game} onChange={(e) => setValue({ ...value, game: e.target.value })} placeholder="e.g. Buffalo at Kansas City" disabled={busy} data-testid="input-take-game" /></label></div>
        {(localError || error) && <div className="takes-form-error" role="alert"><AlertCircle size={15} />{localError || error}</div>}
        {busy && <div className="takes-upload-state"><div>{progress === null ? 'Preparing secure upload…' : `Uploading file · ${progress}%`}</div>{progress !== null && <UploadProgress percent={progress} />}<small>The take becomes visible only after the file upload is confirmed.</small></div>}
        <div className="takes-dialog-actions"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy} data-testid="button-submit-take">{busy ? 'Working…' : mode === 'upload' ? <><UploadCloud size={15} /> Upload take</> : 'Save changes'}</button></div>
      </form>
    </section>
  </div>;
}

function TakeCard({ take, owner, onEdit, onDelete }: { take: GameTake; owner: boolean; onEdit: () => void; onDelete: () => void }) {
  const video = kindOf(take) === 'video';
  const fileUrl = getGetGameTakeFileUrl(take.id);
  const [videoError, setVideoError] = useState(false);
  return <article className="take-card" data-testid={`card-take-${take.id}`}>
    <div className="take-card-top"><div className={`take-file-icon ${video ? 'is-video' : ''}`}>{video ? <Film size={18} /> : <FileText size={18} />}</div><div className="take-title-wrap"><span className="takes-filetype">{video ? 'VIDEO TAKE' : `${take.fileName.split('.').pop()?.toUpperCase() ?? 'DOCUMENT'} · DOCUMENT`}</span><h3>{take.title}</h3></div>{owner && <div className="take-owner-actions"><button className="btn btn-quiet icon-btn" onClick={onEdit} aria-label={`Edit ${take.title}`} title="Edit details"><Pencil size={14} /></button><button className="btn btn-quiet icon-btn takes-delete-icon" onClick={onDelete} aria-label={`Delete ${take.title}`} title="Delete take"><Trash2 size={14} /></button></div>}</div>
    {take.description && <p className="take-description">{take.description}</p>}
    <div className="take-tags"><span>{take.sport.toUpperCase()}</span>{take.game && <span>{take.game}</span>}<span>{readableDate(take.createdAt)}</span><span>{prettySize(take.size)}</span></div>
    {video ? <div className="take-video-wrap">{videoError ? <div className="take-video-fallback"><AlertCircle size={16} /><span>Playback could not start in this browser.</span><a href={fileUrl} download={take.fileName}><ArrowDownToLine size={14} /> Download video</a></div> : <video controls preload="metadata" playsInline src={fileUrl} onError={() => setVideoError(true)} aria-label={`Video: ${take.title}`} />}</div>
      : <div className="take-document-link"><div><BookOpen size={15} /><span>Private member document</span></div><a href={fileUrl} target={take.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? undefined : '_blank'} rel="noreferrer" download={take.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? take.fileName : undefined} data-testid={`link-take-file-${take.id}`}><span>{take.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'Download DOCX' : 'Open document'}</span><ArrowDownToLine size={14} /></a></div>}
  </article>;
}

export default function GameTakesPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const signedIn = isLoaded && isSignedIn === true;
  const membership = useMembership(signedIn);
  const queryClient = useQueryClient();
  const takesKey = useMemo(() => [...getListGameTakesQueryKey(), { clerkUserId: signedIn ? userId ?? 'signed-in' : 'signed-out' }] as const, [signedIn, userId]);
  const query = useListGameTakes({ query: { queryKey: takesKey, enabled: isLoaded && signedIn, staleTime: 30_000, refetchOnMount: 'always', refetchOnWindowFocus: true, retry: 1 } });
  const requestUpload = useRequestTakeUpload();
  const createTake = useCreateGameTake();
  const updateTake = useUpdateGameTake();
  const deleteTake = useDeleteGameTake();
  const [sportFilter, setSportFilter] = useState('all');
  const [form, setForm] = useState<{ mode: 'upload' | 'edit'; take?: GameTake } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameTake | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const list = query.data;
  const access = query.isSuccess && !query.isFetching && list?.hasAccess === true;
  const owner = access && list?.isOwner === true && membership.data?.isOwner !== false;
  const membershipReady = membership.data?.ready === true && membership.data?.signedIn === true && !membership.data?.error;
  const items = access ? (list?.items ?? []) : [];
  const visible = useMemo(() => items.filter((take) => sportFilter === 'all' || take.sport === sportFilter), [items, sportFilter]);
  const confirmedMember = signedIn && membershipReady && membership.data?.hasAccess === true;
  const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Something interrupted that action. Please try again.';
  const invalidate = async () => { await queryClient.invalidateQueries({ queryKey: takesKey }); };

  useEffect(() => {
    document.title = 'Game Takes | ALLPLAY';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Owner-uploaded game breakdowns, documents and video takes for ALLPLAY members.');
  }, []);

  const save = async (value: TakeFormValue, file?: File) => {
    setActionError(null);
    if (form?.mode === 'edit' && form.take) {
      try {
        await updateTake.mutateAsync({ id: form.take.id, data: value });
        setForm(null);
        await invalidate();
      } catch (cause) { setActionError(errorMessage(cause)); }
      return;
    }
    if (!file) return;
    if (file.name.length > 200) { setActionError('File names must be 200 characters or fewer. Rename the file and try again.'); return; }
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    const contentType = file.type || ACCEPTED.get(extension);
    if (!contentType || contentType !== ACCEPTED.get(extension)) { setActionError('Unsupported file type. Choose PDF, TXT, DOCX, MP4 or WebM.'); return; }
    setUploading(true);
    setProgress(null);
    try {
      const requested = await requestUpload.mutateAsync({ data: { fileName: file.name, contentType: contentType as 'application/pdf' | 'text/plain' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'video/mp4' | 'video/webm', size: file.size } });
      const target = new URL(requested.uploadUrl, window.location.origin);
      if (target.protocol !== 'https:' && target.origin !== window.location.origin) throw new Error('The upload service returned an invalid secure URL.');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', target.toString());
        xhr.setRequestHeader('Content-Type', contentType);
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed with status ${xhr.status}. The take was not published.`));
        xhr.onerror = () => reject(new Error('Network error while uploading. Check your connection and retry; the take was not published.'));
        xhr.onabort = () => reject(new Error('Upload was interrupted. The take was not published.'));
        xhr.send(file);
      });
      await createTake.mutateAsync({ data: { uploadId: requested.uploadId, ...value } });
      setForm(null);
      await invalidate();
    } catch (cause) { setActionError(errorMessage(cause)); }
    finally { setUploading(false); setProgress(null); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await deleteTake.mutateAsync({ id: deleteTarget.id });
      setDeleteTarget(null);
      await invalidate();
    } catch (cause) { setActionError(errorMessage(cause)); setDeleteTarget(null); }
  };
  const refresh = async () => {
    setRefreshError(null);
    try { await query.refetch(); } catch { setRefreshError('Could not refresh the take library. Try again in a moment.'); }
  };
  const retryMessage = query.isError || refreshError;
  const unverified = !isLoaded || !query.isSuccess;

  return <div className="app-shell takes-app">
     <header className="topbar"><Link href="/user-portal" className="brand" aria-label="ALLPLAY dashboard"><span className="brand-mark"><Activity size={17} /></span><span className="brand-name">ALLPLAY</span></Link><nav className="takes-top-nav" aria-label="Account navigation"><Link className="btn btn-quiet" href="/user-portal"><ArrowLeft size={14} />Dashboard</Link><Link className="btn btn-quiet" href="/feedback">Feedback</Link><Link className="btn btn-quiet" href="/account">Account</Link></nav></header>
     <aside className="side-rail" aria-label="Dashboard navigation"><div className="rail-caption">YOUR WORKSPACE</div><Link className="rail-link" href="/user-portal"><Activity size={15} />Overview</Link><Link className="rail-link" href="/projections">Projections</Link><Link className="rail-link selected" href="/takes" aria-current="page"><Film size={15} />Game takes</Link><Link className="rail-link" href="/feedback">Feedback</Link><div className="rail-bottom"><span className="rail-caption">MEMBER LIBRARY</span><div className="rail-sports">OWNER-LED RESEARCH<br />DOCUMENTS · VIDEO</div></div></aside>
    <main className="main-wrap takes-main">
      <div className="takes-breadcrumb"><Link href="/user-portal">Dashboard</Link><span>/</span><span>Game takes</span></div>
      <div className="takes-heading"><div><div className="eyebrow">OWNER UPLOADS <span>/</span> MEMBER ACCESS</div><h1>Game takes</h1><p className="subhead">Film notes, matchup breakdowns and the details worth keeping.</p></div><div className="takes-heading-stamp"><span className="takes-live-dot" />PRIVATE MEMBER LIBRARY</div></div>
      {!isLoaded ? <section className="takes-loading" aria-label="Checking account"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></section>
        : !signedIn ? <section className="takes-wall"><div className="takes-wall-art"><LockKeyhole size={22} /></div><div className="takes-kicker">MEMBERSHIP REQUIRED</div><h2>Research for the people in the room.</h2><p>Game takes are a private ALLPLAY member library. Sign in to verify access before any content is shown.</p><div className="takes-wall-actions"><Link href="/sign-in" className="btn btn-primary">Sign in to check access</Link><Link href="/user-portal" className="btn btn-quiet">Back to dashboard</Link></div></section>
        : query.isLoading || query.isFetching ? <section className="takes-loading" aria-label="Loading game takes"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><span>Verifying your access before loading the library…</span></section>
        : query.isError ? <section className="takes-state takes-error"><div className="takes-state-icon"><AlertCircle size={19} /></div><h2>Couldn’t verify the library</h2><p>No documents or videos are available until access is checked successfully. Check your connection and retry.</p><button className="btn btn-primary" onClick={refresh}><RefreshCw size={14} /> Retry access check</button></section>
        : !access ? <section className="takes-wall"><div className="takes-wall-art"><LockKeyhole size={22} /></div><div className="takes-kicker">PRIVATE MEMBER LIBRARY</div><h2>{membership.isLoading ? 'Checking your membership…' : 'The film room is for members.'}</h2><p>{membership.isError || membership.data?.error ? 'We could not verify your membership status. Your library stays private until it is confirmed.' : 'Join ALLPLAY to view owner-uploaded scouting notes, game documents and video breakdowns.'}</p>{membership.isError || membership.data?.error ? <Link href="/account" className="btn btn-quiet">Check membership status</Link> : membershipReady && membership.data?.hasAccess ? <button className="btn btn-quiet" onClick={refresh}><RefreshCw size={14} /> Refresh access</button> : <div className="takes-wall-actions">{signedIn ? <MembershipCheckoutButton signedIn={signedIn} label="Join the membership" /> : <Link href="/sign-in" className="btn btn-primary">Sign in to join</Link>}<Link href="/account" className="btn btn-quiet">Membership details</Link></div>}</section>
        : <>
          <div className="takes-toolbar"><div className="takes-stats"><div><strong>{items.length}</strong><span>{items.length === 1 ? 'TAKE' : 'TAKES'}</span></div><div><strong>{items.filter((item) => kindOf(item) === 'video').length}</strong><span>VIDEOS</span></div><div><strong>{items.filter((item) => kindOf(item) === 'document').length}</strong><span>DOCUMENTS</span></div></div><div className="takes-toolbar-actions"><label className="takes-filter"><span className="sr-only">Filter by sport</span><select value={sportFilter} onChange={(e) => setSportFilter(e.target.value)} data-testid="select-takes-sport"><option value="all">All sports</option>{SPORTS.map((sport) => <option key={sport.id} value={sport.id}>{sport.label}</option>)}</select></label><button className="btn btn-quiet" onClick={refresh} disabled={query.isFetching} data-testid="button-refresh-takes"><RefreshCw size={14} className={query.isFetching ? 'spin' : ''} /> Refresh</button>{owner && <button className="btn btn-primary" onClick={() => { setActionError(null); setForm({ mode: 'upload' }); }} data-testid="button-add-take"><Plus size={15} /> Add take</button>}</div></div>
          {retryMessage && <div className="takes-inline-alert" role="alert"><AlertCircle size={15} />{refreshError || 'The library could not be refreshed.'}<button className="btn btn-quiet" onClick={refresh}>Retry</button></div>}
          {actionError && !form && <div className="takes-inline-alert" role="alert"><AlertCircle size={15} />{actionError}</div>}
          <div className="takes-section-label"><span>THE FILM ROOM</span><span>{owner ? <><ShieldCheck size={12} /> OWNER VIEW</> : <><LockKeyhole size={12} /> VERIFIED MEMBER ACCESS</>}</span></div>
          {visible.length ? <div className="takes-grid">{visible.map((take) => <TakeCard key={take.id} take={take} owner={owner} onEdit={() => { setActionError(null); setForm({ mode: 'edit', take }); }} onDelete={() => { setActionError(null); setDeleteTarget(take); }} />)}</div>
            : <section className="takes-empty"><div className="takes-empty-mark">{sportFilter === 'all' ? <BookOpen size={20} /> : <CircleHelp size={20} />}</div><h2>{items.length ? `No ${SPORTS.find((sport) => sport.id === sportFilter)?.label ?? ''} takes yet` : 'The library is ready for its first take.'}</h2><p>{items.length ? 'Try another sport filter to see more owner research.' : owner ? 'Add a first film breakdown or document. It will appear here once the private upload is confirmed.' : 'There are no owner uploads in the member library just yet. Check back soon.'}</p>{owner && items.length === 0 && <button className="btn btn-primary" onClick={() => { setActionError(null); setForm({ mode: 'upload' }); }}><Plus size={15} /> Add the first take</button>}</section>}
          <footer className="takes-footer"><span>Files stream through ALLPLAY’s protected route</span><span>{confirmedMember ? 'MEMBERSHIP VERIFIED' : 'ACCESS VERIFIED BY LIBRARY'}</span></footer>
        </>}
      {form && <TakeForm initial={form.take ? { title: form.take.title, description: form.take.description, sport: form.take.sport, game: form.take.game } : blankForm} mode={form.mode} busy={form.mode === 'upload' ? uploading : updateTake.isPending} progress={progress} error={actionError} onClose={() => { if (!uploading) { setForm(null); setActionError(null); } }} onSubmit={save} />}
      {deleteTarget && <div className="takes-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !deleteTake.isPending) setDeleteTarget(null); }}><section className="takes-dialog takes-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-take-title"><div className="takes-dialog-head"><div><div className="takes-kicker">REMOVE FROM LIBRARY</div><h2 id="delete-take-title">Delete this take?</h2></div><button className="btn btn-quiet icon-btn" onClick={() => setDeleteTarget(null)} aria-label="Close confirmation"><X size={17} /></button></div><p><strong>{deleteTarget.title}</strong> and its private file will be removed. Members will no longer be able to open or play it. This action cannot be undone.</p>{actionError && <div className="takes-form-error" role="alert"><AlertCircle size={15} />{actionError}</div>}<div className="takes-dialog-actions"><button className="btn btn-quiet" onClick={() => setDeleteTarget(null)} disabled={deleteTake.isPending}>Keep take</button><button className="btn takes-danger" onClick={remove} disabled={deleteTake.isPending} data-testid="button-confirm-delete-take"><Trash2 size={14} />{deleteTake.isPending ? 'Removing…' : 'Delete take'}</button></div></section></div>}
    </main>
  </div>;
}
