import type { DfsSalaryCoverage, DfsSalaryPlatform } from './api-types';

export default function SalaryControls({ platform, coverage, loading, onPlatformChange, onSlateChange }: {
  platform: DfsSalaryPlatform;
  coverage?: DfsSalaryCoverage;
  loading: boolean;
  onPlatformChange: (platform: DfsSalaryPlatform) => void;
  onSlateChange: (id: string) => void;
}) {
  const slates = coverage?.slates ?? [];
  return <div className="salary-section">
    <div className="salary-controls">
      <label htmlFor="salary-platform"><span className="micro-label">Salary site</span>
        <select id="salary-platform" value={platform} onChange={(e) => onPlatformChange(e.target.value as DfsSalaryPlatform)} data-testid="select-salary-platform">
          <option value="draftkings">DraftKings</option><option value="fanduel">FanDuel — not connected</option>
        </select>
      </label>
      <label htmlFor="salary-slate"><span className="micro-label">Salary slate · starts in Eastern time</span>
        <select id="salary-slate" value={coverage?.selectedSlateId ?? ''} disabled={loading || !slates.length} onChange={(e) => onSlateChange(e.target.value)} data-testid="select-salary-slate">
          {!slates.length && <option value="">{loading ? 'Loading slates…' : 'No salary slates available'}</option>}
          {slates.map((slate) => <option key={slate.id} value={slate.id}>{slate.name}</option>)}
        </select>
      </label>
    </div>
    <p className={`salary-status ${coverage?.available ? 'available' : ''}`} role="status" data-testid="status-salaries">
      {loading && !coverage ? 'Loading salary source…' : coverage?.message ?? 'Salary data has not loaded.'}
      {coverage?.fetchedAt && <span className="salary-updated"> Export checked {new Date(coverage.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</span>}
    </p>
  </div>;
}
