import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import '@/styles/matchup-reports.css';
import {
  useListMatchupReports, usePreviewMatchupReport, useApproveMatchupReport, useDeleteMatchupReport,
  getListMatchupReportsQueryKey, getGetModelProjectionsQueryKey,
  type MatchupReport, type MatchupReportMetadata,
} from '@workspace/api-client-react';

const initial = (): MatchupReportMetadata => ({
  publisher: 'fantasypros', season: new Date().getFullYear(), phase: 'regular',
  startWeek: 1, endWeek: 18, publishedAt: '', asOf: '', positions: ['QB'],
  rankOneMeans: 'most-allowed', sourceUrl: 'https://www.fantasypros.com/nfl/points-allowed.php',
});
const failure = (err: unknown) => {
  const data = (err as { data?: { error?: string } })?.data;
  return data?.error ?? 'Report request failed. Please retry.';
};
export function MatchupReportManager() {
  const { userId } = useAuth();
  const client = useQueryClient();
  const key = [...getListMatchupReportsQueryKey(), { userId }];
  const list = useListMatchupReports({ query: { queryKey: key, staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 60000 } });
  const previewRequest = usePreviewMatchupReport(), approve = useApproveMatchupReport(), remove = useDeleteMatchupReport();
  const [metadata, setMetadata] = useState(initial);
  const [authorized, setAuthorized] = useState(false);
  const [file, setFile] = useState<{ format: 'csv' | 'json'; content: string; name: string }>();
  const [preview, setPreview] = useState<MatchupReport>();
  const [replaceId, setReplaceId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const busy = reading || previewRequest.isPending || approve.isPending || remove.isPending;
  useEffect(() => () => { client.removeQueries({ queryKey: getListMatchupReportsQueryKey() }); }, [client]);
  const update = (next: Partial<MatchupReportMetadata>) => {
    setMetadata(m => ({ ...m, ...next })); setPreview(undefined); setConfirmed(false); setError('');
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: getListMatchupReportsQueryKey() });
    await client.invalidateQueries({ queryKey: getGetModelProjectionsQueryKey() });
  };
  const importPreview = async () => {
    if (!file || !authorized) return;
    setError(''); setPreview(undefined); setConfirmed(false);
    try {
      setPreview(await previewRequest.mutateAsync({ data: { metadata, authorized, format: file.format, content: file.content } }));
    } catch (err) { setError(failure(err)); }
  };
  const save = async () => {
    if (!preview || !confirmed) return;
    try {
      await approve.mutateAsync({ id: preview.id, data: { confirmed, replaceId: replaceId || null } });
      setPreview(undefined); setFile(undefined); setConfirmed(false); setReplaceId(''); setError('');
      await refresh();
    } catch (err) { setError(failure(err)); }
  };
  return <details className="panel matchup-report-manager">
    <summary>Owner tools · NFL published matchup reports</summary>
    <p>Import a report you are permitted to use in ALLPLAY. No publisher sign-in is performed and no redistribution rights are implied. Files stay in your browser; only validated ranking records and provenance are saved.</p>
    <p>CSV: <code>team,position,rank</code>. JSON: <code>{'[{"team":"DEN","position":"QB","rank":19}]'}</code>. PFF uses <code>secondary</code>. Teams may use NFL abbreviations or full names. Ranks must be unique per position, 1–32; missing teams stay unavailable.</p>
    <fieldset disabled={busy}>
      <div className="matchup-report-fields">
        <label>Publisher<select value={metadata.publisher} onChange={e => {
          const publisher = e.target.value as MatchupReportMetadata['publisher'];
          update({ publisher, positions: publisher === 'pff' ? ['secondary'] : ['QB'], rankOneMeans: publisher === 'pff' ? 'strongest' : 'most-allowed',
            sourceUrl: publisher === 'pff' ? `https://www.pff.com/news/nfl-secondary-rankings-${metadata.season}` : 'https://www.fantasypros.com/nfl/points-allowed.php' });
        }}><option value="fantasypros">FantasyPros · position allowance</option><option value="pff">PFF · secondary strength</option></select></label>
        <label>Season<input type="number" min="2020" max={new Date().getFullYear() + 1} value={metadata.season} onChange={e => update({ season: Number(e.target.value) })} /></label>
        <label>Season phase<select value={metadata.phase} onChange={e => update({ phase: e.target.value as MatchupReportMetadata['phase'] })}><option value="preseason">Preseason</option><option value="regular">Regular season</option><option value="postseason">Postseason</option></select></label>
        <label>Applies from week<input type="number" min="1" max="22" value={metadata.startWeek} onChange={e => update({ startWeek: Number(e.target.value) })} /></label>
        <label>Through week<input type="number" min="1" max="22" value={metadata.endWeek} onChange={e => update({ endWeek: Number(e.target.value) })} /></label>
        <label>Published at (UTC)<input type="datetime-local" value={metadata.publishedAt.slice(0, 16)} onChange={e => update({ publishedAt: e.target.value ? `${e.target.value}:00Z` : '' })} /></label>
        <label>Data as-of (UTC)<input type="datetime-local" value={metadata.asOf.slice(0, 16)} onChange={e => update({ asOf: e.target.value ? `${e.target.value}:00Z` : '' })} /></label>
        <label>Rank 1 means<select value={metadata.rankOneMeans} onChange={e => update({ rankOneMeans: e.target.value as MatchupReportMetadata['rankOneMeans'] })}><option value="most-allowed">Most points allowed · easiest</option><option value="strongest">Strongest defense · hardest</option></select></label>
        <label className="matchup-report-url">Publisher source URL<input type="url" value={metadata.sourceUrl} onChange={e => update({ sourceUrl: e.target.value })} /></label>
      </div>
      <p>Covered weeks are the weeks this report is authorized to describe, not a guessed weekly update. Publication and as-of dates must be no later than the model cutoff.</p>
      <div>Positional scope: {metadata.publisher === 'pff' ? <strong>secondary</strong> : ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p =>
        <label className="matchup-report-check" key={p}><input type="checkbox" checked={metadata.positions.some(v => v === p)} onChange={e => update({ positions: e.target.checked ? [...metadata.positions, p as 'QB'] : metadata.positions.filter(v => v !== p) })} />{p}</label>)}</div>
      <label className="matchup-report-check"><input type="checkbox" checked={authorized} onChange={e => {
        setAuthorized(e.target.checked); setPreview(undefined); setConfirmed(false); setFile(undefined);
      }} />I confirm permitted access to this published report and permission to use these rankings in ALLPLAY for its members.</label>
      <label>Authorized CSV/JSON (200 KB maximum)<input key={String(authorized) + (file ? 'selected' : 'empty')} type="file" accept=".csv,.json" disabled={!authorized} onChange={async e => {
        const selected = e.target.files?.[0];
        setPreview(undefined); setConfirmed(false); setError('');
        if (!selected) { setFile(undefined); return; }
        if (selected.size > 200000 || !/\.(csv|json)$/i.test(selected.name)) { setFile(undefined); setError('Choose a CSV or JSON file no larger than 200 KB.'); return; }
        setReading(true);
        try { setFile({ name: selected.name, format: /\.json$/i.test(selected.name) ? 'json' : 'csv', content: await selected.text() }); }
        catch { setFile(undefined); setError('File could not be read. Choose it again.'); }
        finally { setReading(false); }
      }} /></label>
      {file && <p>Selected: {file.name}</p>}
      <button type="button" className="btn btn-quiet" disabled={!file || !authorized} onClick={importPreview}>{previewRequest.isPending ? 'Validating…' : 'Validate and preview'}</button>
      {preview && <section aria-label="Validated report preview">
        <h3>{preview.fullCoverage ? 'Full coverage' : 'Incomplete report'} · {Object.entries(preview.coverage).map(([p, count]) => `${p}: ${count}/32`).join(' · ')}</h3>
        <p>{preview.metadata.publisher.toUpperCase()} · {preview.metadata.season} {preview.metadata.phase}, weeks {preview.metadata.startWeek}–{preview.metadata.endWeek} · published {preview.metadata.publishedAt.slice(0, 10)} · as-of {preview.metadata.asOf.slice(0, 10)} · #1 {preview.metadata.rankOneMeans}. Missing opponents will not be inferred.</p>
        <div className="matchup-report-table"><table><thead><tr><th>Team</th><th>Position</th><th>Rank</th></tr></thead><tbody>{preview.rows.map(row => <tr key={`${row.team}:${row.position}`}><td>{row.team}</td><td>{row.position}</td><td>{row.rank}</td></tr>)}</tbody></table></div>
        <label>Save as<select value={replaceId} onChange={e => { setReplaceId(e.target.value); setConfirmed(false); }}><option value="">New approved report</option>{list.data?.filter(r => r.metadata.publisher === metadata.publisher).map(r => <option key={r.id} value={r.id}>Replace {r.metadata.publisher.toUpperCase()} {r.metadata.season} weeks {r.metadata.startWeek}–{r.metadata.endWeek} · {r.metadata.publishedAt.slice(0, 10)} · {r.metadata.positions.join('/')}</option>)}</select></label>
        <label className="matchup-report-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed these records, dates, scope and rank direction.{replaceId && ' Saving permanently replaces the selected report.'}</label>
        <button type="button" className="btn btn-primary" disabled={!confirmed} onClick={save}>{replaceId ? 'Approve replacement' : 'Approve and save'}</button>
      </section>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <h3>Approved reports</h3>
    {list.isLoading ? <p>Loading reports…</p> : list.isError ? <p role="alert">Reports could not be loaded. <button className="btn btn-quiet" onClick={() => list.refetch()}>Retry</button></p>
      : !list.data?.length ? <p>No approved reports. Public coverage remains the fallback.</p>
        : list.data.map(r => <div className="matchup-report-item" key={r.id}>
          <div><strong>{r.metadata.publisher.toUpperCase()} · {r.metadata.season} {r.metadata.phase} weeks {r.metadata.startWeek}–{r.metadata.endWeek}</strong><p>Published {r.metadata.publishedAt.slice(0, 10)} · as-of {r.metadata.asOf.slice(0, 10)} · {r.fullCoverage ? 'Full' : 'Incomplete'} · {Object.entries(r.coverage).map(([p, c]) => `${p} ${c}/32`).join(', ')} · #1 {r.metadata.rankOneMeans}</p><a href={r.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">Publisher source</a></div>
          <button className="btn btn-quiet" disabled={busy} onClick={async () => {
            if (!window.confirm('Permanently delete this approved report? Matchups will return to available public coverage or stay unavailable.')) return;
            try { await remove.mutateAsync({ id: r.id }); setError(''); await refresh(); }
            catch (err) { setError(failure(err)); }
          }}>Delete</button>
        </div>)}
  </details>;
}
