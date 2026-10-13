import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListEvaluationsQueryKey,
  useListEvaluations,
  useRequestEvaluationUpload,
  useStartEvaluation,
  useVerifyEvaluationImport,
  type EvaluationImport,
  type EvaluationRun,
  type EvaluationStartInputSite,
  type EvaluationStartInputSport,
} from '@workspace/api-client-react';
import { ArrowLeft, CircleAlert, Download, LoaderCircle, Lock, Play, RefreshCw, Upload } from 'lucide-react';
import useMembership from '@/hooks/use-membership';
import '@/styles/evaluation.css';

const SPORTS: EvaluationStartInputSport[] = ['nfl', 'nhl', 'nba', 'wnba', 'mlb', 'cfb', 'nascar'];
const SITES: EvaluationStartInputSite[] = ['draftkings', 'fanduel', 'yahoo', 'ownersbox'];
const POOL_HEADER = ['player_id', 'event_id', 'team_id', 'name', 'position', 'availability', 'salary'];
const OWN_HEADER = ['player_id', 'ownership_percent'];
const MAX_DAYS = 7;

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const asArr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(asRec) : []);
const str = (v: unknown, d = '—') => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : d);
const num = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');
const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${(v <= 1 ? v * 100 : v).toFixed(1)}%` : '—');
const errMsg = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);

function daysBetween(a: string, b: string) {
  const s = Date.parse(`${a}T00:00:00Z`); const e = Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(s) || Number.isNaN(e) ? NaN : Math.round((e - s) / 86400000) + 1;
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function validateCsv(file: File, kind: 'pool' | 'ownership'): Promise<string | null> {
  if (file.size < 1 || file.size > 1048576) return 'CSV must be between 1 byte and 1 MB.';
  const text = await file.text();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return 'CSV needs a header row and at least one data row.';
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"([^"]+)"$/, '$1'));
  const expected = kind === 'pool' ? POOL_HEADER : OWN_HEADER;
  if (header.join(',') !== expected.join(',')) return `Header must be exactly: ${expected.join(',')}`;
  // Record parsing/validation belongs to the server's quoted-CSV parser.
  // Splitting rows by commas here would incorrectly reject quoted player names.
  return null;
}

function Gate({ children }: { children: ReactNode }) {
  return <div className="account-page"><div className="account-wrap eval-wrap">{children}</div></div>;
}

export default function EvaluationPage() {
  const { isSignedIn } = useAuth();
  const membership = useMembership(isSignedIn === true);
  const s = membership.data;
  const unavailable = membership.isError || (!!s && (!s.ready || !!s.error || s.status.toLowerCase() === 'unavailable' || s.signedIn !== true));
  const owner = s?.hasAccess === true && !unavailable && s?.isOwner === true;

  if (membership.isLoading && !s) return <Gate><div className="membership-state member-loading skeleton" aria-label="Checking owner access" style={{ marginTop: 40 }} /></Gate>;
  if (!owner) return <Gate>
    <section className="account-panel" data-testid="status-evaluation-locked" style={{ marginTop: 60 }}>
      <div className="membership-state"><span className="membership-state-icon"><Lock size={17} /></span><div><h3>Owner access required</h3><p>{unavailable ? 'Access could not be verified right now. No evaluation data is loaded.' : 'Historical evaluation is restricted to the server-verified ALLPLAY owner account.'}</p></div></div>
      <div className="membership-actions"><Link href="/account" className="btn btn-quiet" data-testid="link-account"><ArrowLeft size={14} /> Back to account</Link></div>
    </section>
  </Gate>;
  return <OwnerEvaluation />;
}

function OwnerEvaluation() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = [...getListEvaluationsQueryKey(), { clerkUserId: userId, scope: 'owner' }];
  const list = useListEvaluations({
    query: {
      queryKey,
      enabled: !!userId,
      refetchInterval: (query) => ((query.state.data?.runs ?? []).some((r) => r?.status === 'running') ? 4000 : false),
    },
  });
  const runs: EvaluationRun[] = useMemo(() => (Array.isArray(list.data?.runs) ? list.data!.runs : []), [list.data]);
  const imports: EvaluationImport[] = useMemo(() => (Array.isArray(list.data?.imports) ? list.data!.imports : []), [list.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListEvaluationsQueryKey() });

  return <Gate>
    <header className="account-top">
      <Link href="/" className="account-brand"><span className="account-brand-mark">A</span>ALLPLAY</Link>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href="/account" className="btn btn-quiet" data-testid="link-account"><ArrowLeft size={14} /> Account</Link>
        <button className="btn btn-quiet" onClick={() => void list.refetch()} disabled={list.isFetching} data-testid="button-refresh"><RefreshCw size={14} className={list.isFetching ? 'spin' : ''} /> Refresh</button>
      </div>
    </header>
    <section className="account-hero">
      <div className="account-kicker">Owner / historical evaluation</div>
      <h1>How did the forecasts hold up?</h1>
      <p>Replay up to {MAX_DAYS} past days with fixed model settings, then compare forecasts and ownership estimates against what actually happened. Classic contests only. Holdout settings are fixed before the replay and never tuned to the result.</p>
    </section>
    <div className="eval-grid">
      <StartPanel imports={imports} onDone={(run) => { setSelectedId(run.id); void refresh(); }} />
      <ImportPanel runs={runs} onDone={() => void refresh()} />
    </div>
    <section className="account-panel">
      <h2>Saved runs and verified imports</h2>
      <p className="account-panel-intro">Runs in progress refresh automatically every few seconds.</p>
      {list.isLoading ? <div className="membership-state member-loading skeleton" /> :
        list.isError ? <div className="error-box" role="alert"><span>{errMsg(list.error, 'Evaluations could not be loaded.')}</span><button className="btn btn-quiet" onClick={() => void list.refetch()} data-testid="button-retry">Retry</button></div> :
          <div className="eval-grid">
            <div className="eval-list">
              <div className="eval-hint">Runs ({runs.length})</div>
              {runs.length === 0 ? <div className="eval-empty">No runs yet. Choose a sport, site and a date window of up to {MAX_DAYS} days above to start the first replay.</div> :
                runs.map((r) => <button key={r.id} className="eval-item" aria-current={selected?.id === r.id} onClick={() => setSelectedId(r.id)} data-testid={`button-run-${r.id}`}>
                  <span><strong>{str(r.sport).toUpperCase()} / {str(r.site)}</strong><small>{str(r.fromDate)} to {str(r.toDate)} · created {new Date(r.createdAt).toLocaleString()}</small></span>
                  <span className={`eval-pill ${r.status}`}>{r.status}</span>
                </button>)}
            </div>
            <div className="eval-list">
              <div className="eval-hint">Verified imports ({imports.length})</div>
              {imports.length === 0 ? <div className="eval-empty">No imports. Pool imports are optional; ownership imports need a ready run.</div> :
                imports.map((i) => <div key={i.id} className="eval-item" data-testid={`row-import-${i.id}`}>
                  <span><strong>{i.kind === 'pool' ? 'Player pool' : 'Ownership'} · {str(i.contestId)}</strong><small>{str(i.sport).toUpperCase()} / {str(i.site)} · slate {str(i.slateDate)} · {i.rowCount} rows · hash <span className="eval-mono">{str(i.hash).slice(0, 10)}</span></small><small>Source: {str(i.source)}</small></span>
                  <span className="eval-pill">{i.kind}</span>
                </div>)}
            </div>
          </div>}
    </section>
    {selected && <ReportPanel run={selected} />}
  </Gate>;
}

function StartPanel({ imports, onDone }: { imports: EvaluationImport[]; onDone: (run: EvaluationRun) => void }) {
  const start = useStartEvaluation();
  const [sport, setSport] = useState<EvaluationStartInputSport>('nba');
  const [site, setSite] = useState<EvaluationStartInputSite>('draftkings');
  const [fromDate, setFrom] = useState('');
  const [toDate, setTo] = useState('');
  const [recentGames, setRecentGames] = useState('5');
  const [recentWeight, setRecentWeight] = useState('60');
  const [matchupWeight, setMatchupWeight] = useState('15');
  const [poolImportId, setPool] = useState('');
  const [error, setError] = useState<string | null>(null);
  const span = daysBetween(fromDate, toDate);
  const pools = imports.filter((i) => i.kind === 'pool' && i.sport === sport && i.site === site);
  const singleDay = span === 1;

  const submit = () => {
    setError(null);
    if (!fromDate || !toDate || !(span >= 1)) return setError('Choose a valid date window.');
    if (span > MAX_DAYS) return setError(`Maximum ${MAX_DAYS} historical days per run.`);
    const rg = Number(recentGames); const rw = Number(recentWeight); const mw = Number(matchupWeight);
    if (!(rg >= 3 && rg <= 10) || !(rw >= 0 && rw <= 100) || !(mw >= 0 && mw <= 50)) return setError('Settings out of range.');
    const pool = singleDay && poolImportId ? pools.find((p) => p.id === poolImportId) : undefined;
    if (pool && pool.slateDate !== fromDate) return setError('Pool import slate date must match the replay day.');
    start.mutate({ data: { sport, site, fromDate, toDate, recentGames: rg, recentWeight: rw, matchupWeight: mw, ...(pool ? { poolImportId: pool.id } : {}) } }, {
      onSuccess: onDone,
      onError: (e) => setError(errMsg(e, 'Run could not be started.')),
    });
  };

  return <section className="account-panel">
    <h2>Start a replay</h2>
    <p className="account-panel-intro">Settings are frozen for the holdout window. Stat history must have verified completion before UTC midnight; saved roster snapshots may be captured later, but strictly before the first game.</p>
    <div className="eval-form">
      <label className="eval-field">Sport<select value={sport} onChange={(e) => setSport(e.target.value as EvaluationStartInputSport)} data-testid="select-sport">{SPORTS.map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label>
      <label className="eval-field">Site<select value={site} onChange={(e) => setSite(e.target.value as EvaluationStartInputSite)} data-testid="select-site">{SITES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
      <label className="eval-field">From<input type="date" value={fromDate} onChange={(e) => setFrom(e.target.value)} data-testid="input-from" /></label>
      <label className="eval-field">To<input type="date" value={toDate} onChange={(e) => setTo(e.target.value)} data-testid="input-to" /></label>
      <label className="eval-field">Recent games (3-10)<input type="number" min={3} max={10} value={recentGames} onChange={(e) => setRecentGames(e.target.value)} data-testid="input-recent-games" /></label>
      <label className="eval-field">Recent weight (0-100)<input type="number" min={0} max={100} value={recentWeight} onChange={(e) => setRecentWeight(e.target.value)} data-testid="input-recent-weight" /></label>
      <label className="eval-field">Matchup weight (0-50)<input type="number" min={0} max={50} value={matchupWeight} onChange={(e) => setMatchupWeight(e.target.value)} data-testid="input-matchup-weight" /></label>
      <label className="eval-field">Pool import (single day, optional)<select value={poolImportId} onChange={(e) => setPool(e.target.value)} disabled={!singleDay} data-testid="select-pool">
        <option value="">Recent-history fallback</option>
        {pools.map((p) => <option key={p.id} value={p.id}>{p.slateDate} · {p.contestId}</option>)}
      </select></label>
      <p className="eval-hint full">{Number.isNaN(span) ? `Window: up to ${MAX_DAYS} days.` : `Window: ${span} day${span === 1 ? '' : 's'}${span > MAX_DAYS ? ` (over the ${MAX_DAYS}-day limit)` : ''}.`} Without a pool import, the player pool is rebuilt from recent history, which favors players who kept playing (selection bias).</p>
    </div>
    {error && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    <div className="membership-actions"><button className="btn btn-primary" onClick={submit} disabled={start.isPending} data-testid="button-start-run">{start.isPending ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Start replay</button></div>
  </section>;
}

function ImportPanel({ runs, onDone }: { runs: EvaluationRun[]; onDone: () => void }) {
  const requestUpload = useRequestEvaluationUpload();
  const verify = useVerifyEvaluationImport();
  const [kind, setKind] = useState<'pool' | 'ownership'>('pool');
  const [sport, setSport] = useState<EvaluationStartInputSport>('nba');
  const [site, setSite] = useState<EvaluationStartInputSite>('draftkings');
  const [slateDate, setSlate] = useState('');
  const [contestId, setContest] = useState('');
  const [source, setSource] = useState('');
  const [asOf, setAsOf] = useState('');
  const [runId, setRunId] = useState('');
  const [verified, setVerified] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'verifying'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const readyRuns = runs.filter((r) => r.status === 'ready' && r.sport === sport && r.site === site);
  const selectedRun = readyRuns.find((r) => r.id === runId);
  const runContests = selectedRun ? asArr(asRec(selectedRun.report).slates).map((sl) => str(sl.contestId, '')).filter(Boolean) : [];

  const submit = async () => {
    setError(null); setOk(null);
    if (!file) return setError('Choose a CSV file.');
    if (!slateDate) return setError('Slate date is required.');
    if (!contestId.trim()) return setError('Contest ID is required.');
    if (source.trim().length < 10) return setError('Source provenance must be at least 10 characters.');
    if (!asOf) return setError('As-of timestamp is required.');
    if (!Number.isFinite(Date.parse(asOf))) return setError('Choose a valid as-of timestamp.');
    const asOfIso = new Date(asOf).toISOString();
    if (kind === 'pool' && Date.parse(asOfIso) >= Date.parse(`${slateDate}T00:00:00Z`)) return setError('Pool as-of must be before UTC midnight of the slate date (pregame information only).');
    if (kind === 'ownership') {
      if (!selectedRun) return setError('Ownership imports require a ready run.');
      if (!runContests.includes(contestId.trim())) return setError('The selected run has no pool with this contest ID.');
    }
    if (!verified) return setError('Attestation is required.');
    const csvError = await validateCsv(file, kind);
    if (csvError) return setError(csvError);
    try {
      setPhase('uploading');
      const { id, uploadURL } = await requestUpload.mutateAsync({ data: { fileName: file.name, size: file.size } });
      const put = await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': 'text/csv' } });
      if (!put.ok) throw new Error(`Upload to private storage failed (${put.status}).`);
      setPhase('verifying');
      const result = await verify.mutateAsync({ data: { uploadId: id, kind, sport, site, slateDate, contestId: contestId.trim(), source: source.trim(), asOf: asOfIso, verified: true, ...(kind === 'ownership' && runId ? { runId } : {}) } });
      setOk(`Validated ${result.rowCount} owner-attested rows. Hash ${str(result.hash).slice(0, 12)}.`);
      setFile(null); setVerified(false);
      onDone();
    } catch (e) {
      setError(errMsg(e, 'Import failed.'));
    } finally { setPhase('idle'); }
  };

  return <section className="account-panel">
    <h2>Import verified contest data</h2>
    <p className="account-panel-intro">CSV files upload directly to private storage, then the server validates their structure and provenance. You verify the official source; this is not independent provider authentication. Classic contests only. Use ESPN player, event and team IDs for pool rows.</p>
    <div className="eval-tabs" role="group">
      <button aria-pressed={kind === 'pool'} onClick={() => setKind('pool')} data-testid="button-kind-pool">Player pool</button>
      <button aria-pressed={kind === 'ownership'} onClick={() => setKind('ownership')} data-testid="button-kind-ownership">Ownership</button>
    </div>
    <p className="eval-hint" style={{ marginBottom: 12 }}>{kind === 'pool'
      ? <>Columns exactly <code>{POOL_HEADER.join(',')}</code>. Salary may be blank. Availability must be the pregame status as of the timestamp, with no later information.</>
      : <>Columns exactly <code>{OWN_HEADER.join(',')}</code>. Every value must be an explicit number from 0 to 100 from the actual contest export. No estimated or heuristic values.</>}</p>
    <div className="eval-form">
      <label className="eval-field">Sport<select value={sport} onChange={(e) => setSport(e.target.value as EvaluationStartInputSport)} data-testid="select-import-sport">{SPORTS.map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label>
      <label className="eval-field">Site<select value={site} onChange={(e) => setSite(e.target.value as EvaluationStartInputSite)} data-testid="select-import-site">{SITES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
      <label className="eval-field">Slate date<input type="date" value={slateDate} onChange={(e) => setSlate(e.target.value)} data-testid="input-slate-date" /></label>
      <label className="eval-field">Contest ID<input value={contestId} maxLength={150} onChange={(e) => setContest(e.target.value)} data-testid="input-contest-id" /></label>
      <label className="eval-field">{kind === 'pool' ? 'As of (pregame, before UTC midnight)' : 'Export as of'}<input type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="input-as-of" /></label>
      {kind === 'ownership' ? <label className="eval-field">Ready run<select value={runId} onChange={(e) => setRunId(e.target.value)} data-testid="select-run">
        <option value="">Select a ready run</option>
        {readyRuns.map((r) => <option key={r.id} value={r.id}>{r.fromDate} to {r.toDate}</option>)}
      </select></label> : <label className="eval-field">CSV file<input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-file" /></label>}
      {kind === 'ownership' && <label className="eval-field full">CSV file<input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-file-ownership" /></label>}
      {kind === 'ownership' && selectedRun && <p className="eval-hint full">Contest IDs in this run: {runContests.length ? runContests.join(', ') : 'none (import a pool and run a single-day replay first)'}.</p>}
      <label className="eval-field full">Source provenance (min 10 characters)<textarea value={source} maxLength={2000} onChange={(e) => setSource(e.target.value)} placeholder="Where the export came from and how it was obtained" data-testid="input-source" /></label>
      <label className="eval-check full"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="checkbox-verified" />I attest this is a verified official classic-contest export, not predictions, projections or estimates.</label>
    </div>
    {error && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    {ok && <p role="status" className="eval-hint" style={{ marginTop: 12, color: '#a9e4c1' }}>{ok}</p>}
    <div className="membership-actions"><button className="btn btn-primary" onClick={() => void submit()} disabled={phase !== 'idle'} data-testid="button-import">{phase !== 'idle' ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}{phase === 'uploading' ? 'Uploading…' : phase === 'verifying' ? 'Verifying…' : 'Upload and verify'}</button></div>
  </section>;
}

function ReportPanel({ run }: { run: EvaluationRun }) {
  const report = asRec(run.report);
  const settings = asRec(report.settings);
  const groups = asArr(report.groups);
  const research = asArr(report.research);
  const ownership = asArr(report.ownership);
  const slates = asArr(report.slates);
  const rows = asArr(report.rows);
  const notes = Array.isArray(report.notes) ? report.notes.filter((n): n is string => typeof n === 'string') : [];
  const excluded = rows.filter((r) => r.exclusion);
  const progress = typeof report.progress === 'number' ? Math.max(0, Math.min(1, report.progress > 1 ? report.progress / 100 : report.progress)) : null;
  const errorText = typeof report.error === 'string' ? report.error : null;
  const base = `allplay-evaluation-${run.sport}-${run.fromDate}-${run.toDate}`;

  return <section className="account-panel" data-testid={`panel-report-${run.id}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><h2>Report · {run.sport.toUpperCase()} / {run.site}</h2><p className="account-panel-intro">Holdout {run.fromDate} to {run.toDate}</p></div>
      <span className={`eval-pill ${run.status}`}>{run.status}</span>
    </div>
    {run.status === 'running' && <div><p className="eval-hint">Replay in progress{progress !== null ? ` · ${Math.round(progress * 100)}%` : ''}. Results appear when the run is ready.</p><div className="eval-progress"><span style={{ transform: `scaleX(${progress ?? 0.08})` }} /></div></div>}
    {(run.status === 'error' || errorText) && <div className="error-box" role="alert" style={{ marginTop: 10 }}><span><CircleAlert size={14} /> {errorText ?? 'This run failed without a detailed error.'}</span></div>}
    {run.status === 'ready' && <>
      <div className="eval-meta">
        <span>Model <b>{str(report.modelVersion)}</b></span><span>History <b>{str(report.historyVersion)}</b></span><span>Rules as of <b>{str(report.rulesAsOf)}</b></span><span>Scoring <b>{str(report.scoringPolicy)}</b></span>
        {Object.entries(settings).map(([k, v]) => <span key={k}>{k} <b>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</b></span>)}
      </div>
      <div className="eval-caveat">
        <strong>Read before interpreting</strong>
        <ul>
          <li>No calibrated profitability claims. These are forecast-error measurements, not expected returns.</li>
          <li>Counterfactual scoring rules dated 2026-10-13 are applied equally to forecasts and outcomes for every replay day.</li>
          <li>Model settings were fixed for the holdout window, not optimized against it.</li>
          <li>Fallback pools rebuilt from recent history include only players who recently played, which introduces selection bias.</li>
          <li>Players whose outcome is unknown (DNP or missing box score) are excluded, never scored as zero.</li>
          <li>Classic contests only.</li>
        </ul>
      </div>
      <div className="eval-defs">
        <div><strong>Bias</strong>Mean of forecast minus actual. Positive means forecasts ran high.</div>
        <div><strong>MAE</strong>Projection MAE is in fantasy points; ownership MAE is in percentage points.</div>
        <div><strong>Coverage pXX</strong>Share of outcomes observed at or below that percentile. Well calibrated p75 is near 75%.</div>
        <div><strong>Central 50</strong>Share inside p25 to p75; nominal 50%.</div>
      </div>
      {notes.length > 0 && <ul className="eval-hint" style={{ paddingLeft: 18 }}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

      <h3 className="eval-section-title">Projection accuracy by position</h3>
      {groups.length === 0 ? <div className="eval-empty">No scored groups. All outcomes may have been excluded.</div> :
        <div className="eval-table-wrap"><table className="eval-table"><thead><tr><th>Position</th><th>Holdout</th><th className="num">n</th><th className="num">MAE pts</th><th className="num">Bias</th>{['p25', 'p50', 'p75', 'p85', 'p95', 'p99', 'central50'].map((k) => <th key={k} className="num">{k}</th>)}</tr></thead>
          <tbody>{groups.map((g, i) => { const c = asRec(g.coverage); return <tr key={i}><td>{str(g.sport).toUpperCase()} {str(g.site)} {str(g.position)}</td><td>{str(g.fromDate)} to {str(g.toDate)}</td><td className="num">{str(g.n)}</td><td className="num">{num(g.mae)}</td><td className="num">{num(g.bias)}</td>{['p25', 'p50', 'p75', 'p85', 'p95', 'p99', 'central50'].map((k) => <td key={k} className="num">{pct(c[k])}</td>)}</tr>; })}</tbody></table></div>}

      <h3 className="eval-section-title">Ranking research</h3>
      <p className="eval-hint">Forecast and actual means use the same observed players. “n” counts selected candidates; “Observed n” excludes unknown or incomplete outcomes.</p>
      {research.length === 0 ? <div className="eval-empty">No ranking research rows for this run.</div> :
        <div className="eval-table-wrap"><table className="eval-table"><thead><tr><th>Date</th><th>Style</th><th className="num">n</th><th className="num">Observed n</th><th className="num">Forecast mean</th><th className="num">Actual mean</th><th className="num">MAE pts</th><th className="num">Top K</th><th>Selection bias</th></tr></thead>
          <tbody>{research.map((r, i) => <tr key={i}><td>{str(r.date)}</td><td>{str(r.style)}</td><td className="num">{str(r.n)}</td><td className="num">{str(r.observedN)}</td><td className="num">{num(r.pairedForecastMean)}</td><td className="num">{num(r.actualMean)}</td><td className="num">{num(r.mae)}</td><td className="num">{str(r.topK)}</td><td>{str(r.selectionBias)}</td></tr>)}</tbody></table></div>}

      <h3 className="eval-section-title">Ownership accuracy</h3>
      {ownership.length === 0 ? <div className="eval-empty">Unavailable. Ownership accuracy is reported only when an actual contest ownership export has been imported and paired with forecasts from this run.</div> :
        ownership.map((o, i) => <div key={i} style={{ marginBottom: 12 }}>
          <div className="eval-meta"><span>Contest <b>{str(o.contestId)}</b></span><span>n <b>{str(o.n)}</b></span><span>Unmatched <b>{str(o.unmatched)}</b></span><span>MAE <b>{num(o.mae)} pp</b></span><span>Bias <b>{num(o.bias)} pp</b></span><span>{str(o.fromDate)} to {str(o.toDate)}</span><span>Hash <b className="eval-mono">{str(o.hash).slice(0, 12)}</b></span></div>
          <p className="eval-hint">Source: {str(o.source)}</p>
          {asArr(o.bins).length > 0 && <div className="eval-table-wrap"><table className="eval-table"><thead><tr><th>Estimated range</th><th className="num">n</th><th className="num">Estimated mean</th><th className="num">Actual mean</th></tr></thead>
            <tbody>{asArr(o.bins).map((b, j) => <tr key={j}><td>{str(b.range)}</td><td className="num">{str(b.n)}</td><td className="num">{num(b.estimatedMean, 1)}%</td><td className="num">{num(b.actualMean, 1)}%</td></tr>)}</tbody></table></div>}
        </div>)}

      <h3 className="eval-section-title">Slates</h3>
      {slates.length === 0 ? <div className="eval-empty">No slate records.</div> :
        <div className="eval-table-wrap"><table className="eval-table"><thead><tr><th>Date</th><th>As of</th><th>Pool</th><th>Contest</th><th>Selection bias</th><th className="num">History games</th><th className="num">Failed</th><th>Truncated</th><th className="num">Excluded</th><th>Notes</th></tr></thead>
          <tbody>{slates.map((sl, i) => <tr key={i}><td>{str(sl.date)}</td><td>{str(sl.asOf)}</td><td>{str(sl.poolSource)}{sl.poolImportId ? ` (${str(sl.poolImportId).slice(0, 8)})` : ''}</td><td>{str(sl.contestId)}</td><td>{str(sl.selectionBias)}</td><td className="num">{str(sl.historyGames)}</td><td className="num">{str(sl.failedGames)}</td><td>{sl.truncated ? 'yes' : 'no'}</td><td className="num">{Array.isArray(sl.excluded) ? sl.excluded.length : str(sl.excluded)}</td><td style={{ whiteSpace: 'normal', minWidth: 200 }}>{Array.isArray(sl.notes) ? sl.notes.join('; ') : str(sl.notes)}</td></tr>)}</tbody></table></div>}

      <h3 className="eval-section-title">Audit data</h3>
      <p className="eval-hint">{rows.length} player rows, {excluded.length} excluded. JSON is generated in your browser.</p>
      <div className="membership-actions">
        <button className="btn btn-quiet" onClick={() => downloadJson(`${base}-report.json`, report)} data-testid="button-download-report"><Download size={14} /> Full report JSON</button>
        <button className="btn btn-quiet" onClick={() => downloadJson(`${base}-exclusions.json`, excluded)} disabled={!excluded.length} data-testid="button-download-exclusions"><Download size={14} /> Exclusions JSON</button>
      </div>
      <details className="eval-details"><summary>Exclusions ({excluded.length})</summary>
        {excluded.length === 0 ? <p className="eval-hint">No exclusions.</p> :
          <div className="eval-table-wrap"><table className="eval-table"><thead><tr><th>Date</th><th>Player</th><th>Pos</th><th>Event</th><th>Reason</th></tr></thead>
            <tbody>{excluded.slice(0, 300).map((r, i) => <tr key={i}><td>{str(r.date)}</td><td>{str(r.name)}</td><td>{str(r.position)}</td><td className="eval-mono">{str(r.eventId)}</td><td>{typeof r.exclusion === 'string' ? r.exclusion : JSON.stringify(r.exclusion)}</td></tr>)}</tbody></table></div>}
      </details>
      <details className="eval-details"><summary>Player rows preview (first 200)</summary>
        <div className="eval-table-wrap"><table className="eval-table"><thead><tr><th>Date</th><th>Player</th><th>Pos</th><th className="num">Forecast</th><th className="num">Actual</th><th className="num">p25</th><th className="num">p50</th><th className="num">p75</th><th className="num">p95</th><th className="num">Bal rank</th><th className="num">GPP rank</th><th className="num">Est own</th><th>Source</th></tr></thead>
          <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i}><td>{str(r.date)}</td><td>{str(r.name)}</td><td>{str(r.position)}</td><td className="num">{num(r.forecast)}</td><td className="num">{num(r.actual)}</td><td className="num">{num(r.p25)}</td><td className="num">{num(r.p50)}</td><td className="num">{num(r.p75)}</td><td className="num">{num(r.p95)}</td><td className="num">{str(r.balancedRank)}</td><td className="num">{str(r.tournamentRank)}</td><td className="num">{num(r.estimatedOwnership, 1)}</td><td>{str(r.source)}</td></tr>)}</tbody></table></div>
      </details>
      <details className="eval-details"><summary>Raw report JSON</summary><pre className="eval-json">{JSON.stringify(report, null, 2)}</pre></details>
    </>}
  </section>;
}
