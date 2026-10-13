import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'allplay-sheet-export-'));
await build({ entryPoints: ['src/lib/model-sheet-export.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'export.mjs') });
const { buildModelSheetCsv, findUniqueSelectedSlateSalary, MODEL_REFERENCE_HEADERS } = await import(pathToFileURL(join(dir, 'export.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

const player = {
  id: 'model-17',
  name: '=1+1',
  team: 'BOS',
  teamId: 'team-bos',
  opponent: 'NYR',
  opponentId: 'team-nyr',
  position: 'C',
  availability: 'Available',
  participation: 'expected',
  historicalGames: 7,
  reason: null,
  modelTeamTotal: 3.25,
  modelGameTotal: 5.75,
  fantasy: [
    { site: 'draftkings', status: 'ready', mean: 0, trackedMean: 0, std: 0, p25: 0, p50: 0, p75: 0, p85: 0, p95: 0, p99: 0, sampleSize: 7, simulations: 4000, missingStats: [], notes: [], scoringSource: 'https://rules.example/dk', rulesAsOf: '2026-10-01' },
    { site: 'fanduel', status: 'partial', mean: null, trackedMean: 4.5, std: null, p25: null, p50: null, p75: null, p85: null, p95: null, p99: null, sampleSize: 7, simulations: 0, missingStats: ['goals'], notes: [], scoringSource: null, rulesAsOf: '2026-10-01' },
    { site: 'yahoo', status: 'ready', mean: -1.25, trackedMean: -1.25, std: 1.5, p25: -2, p50: -1, p75: 0, p85: 0.5, p95: 1, p99: 2, sampleSize: 7, simulations: 4000, missingStats: [], notes: [], scoringSource: 'https://rules.example/yahoo', rulesAsOf: '2026-10-01' },
    { site: 'ownersbox', status: 'unavailable', mean: null, trackedMean: null, std: null, p25: null, p50: null, p75: null, p85: null, p95: null, p99: null, sampleSize: 0, simulations: 0, missingStats: ['unverified'], notes: ['Scoring unverified'], scoringSource: null, rulesAsOf: '' },
  ],
  stats: [
    { id: 'goals', projected: 0, recentAverage: 0, baselineAverage: 0, matchupMultiplier: 1, opponentRank: 1, rankedTeams: 32, defenseGames: 4, opponentMean: 0, leagueMean: 0, sampleSize: 7, recentSampleSize: 5 },
    { id: 'plusMinus', projected: -2, recentAverage: -1, baselineAverage: -0.5, matchupMultiplier: 1, opponentRank: null, rankedTeams: 0, defenseGames: 0, opponentMean: null, leagueMean: null, sampleSize: 7, recentSampleSize: 5 },
  ],
  history: [],
};

const sheet = {
  status: 'ready',
  sport: 'nhl',
  requestedDate: '2026-10-13',
  slateDate: '2026-10-13',
  generatedAt: '2026-10-13T12:00:00Z',
  effectiveAsOf: '2026-10-12T23:00:00Z',
  recentGames: 5,
  recentWeight: 70,
  matchupWeight: 25,
  gameCount: 4,
  processedGames: 4,
  totalGames: 4,
  failedGames: 0,
  observedTeams: 8,
  players: [player],
  metrics: [
    { id: 'goals', label: 'Goals', unit: '', group: 'Scoring', higherIsBetter: true },
    { id: 'plusMinus', label: 'Plus / Minus', unit: '', group: 'Skater', higherIsBetter: true },
  ],
  modelFormula: 'Historical model.',
  notes: [],
};

const dashboard = {
  date: '2026-10-13',
  salaryCoverage: { platform: 'draftkings', available: true, selectedSlateId: 'slate-77' },
  projections: [{
    sport: 'nhl',
    name: '=1+1',
    team: 'BOS',
    salary: 5000,
    salaryPlatform: 'draftkings',
    salarySlateId: 'slate-77',
    salaryPlayerId: 'provider-902',
    rosterPositions: 'C/W',
    salarySource: 'verified-salary-file',
  }],
};

test('emits the exact 60-column reference block first, with aliases and honest availability', () => {
  assert.equal(MODEL_REFERENCE_HEADERS.length, 60);
  const rows = parseCsv(buildModelSheetCsv(sheet, dashboard, 'draftkings'));
  assert.deepEqual(rows[0].slice(0, 60), [...MODEL_REFERENCE_HEADERS]);
  const row = rows[1];
  const at = (header) => row[rows[0].indexOf(header)];
  assert.equal(at('DFS ID'), 'provider-902');
  assert.equal(at('Pos'), 'C/W');
  assert.equal(at('DK Points'), '0');
  assert.equal(at('ALLPLAY Proj'), '0');
  assert.equal(at('My Proj'), '0');
  assert.equal(at('Value'), '0');
  assert.equal(at('FD Points'), '');
  assert.equal(at('FD p25'), '');
  assert.equal(at('Yahoo Points'), '-1.25');
  assert.equal(at('Yahoo p25'), '-2');
  assert.equal(at('OB Points'), '');
  assert.equal(at('Actual'), '');
  assert.equal(at('My Own'), '');
  assert.equal(at('Adj Own'), '');
  assert.equal(at('Min Exp'), '0');
  assert.equal(at('Max Exp'), '100');
  assert.equal(at('EV Line'), '');
  assert.equal(at('PP Line'), '');
  assert.equal(at('G'), '0');
  assert.equal(at('plusMinus_recentAverage'), '-1');
  assert.equal(at('modelPlayerId'), 'model-17');
  assert.equal(at('modelRole'), 'C');
  assert.equal(at('ownPPLineAssignment'), '');
  assert.equal(at('ownEVLineAssignment'), '');
  assert.equal(at('exposureDefaultsNote'), 'Research defaults only (0–100); not optimizer controls.');
  assert.equal(at('Name'), "'=1+1");
  assert.equal(at('raw_plusMinus'), '-2');
});

test('salary-provider ID and eligibility require one exact same-slate name/team match', () => {
  assert.equal(findUniqueSelectedSlateSalary(player, sheet, dashboard, 'draftkings')?.salaryPlayerId, 'provider-902');
  assert.equal(findUniqueSelectedSlateSalary(player, sheet, { ...dashboard, date: '2026-10-14' }, 'draftkings'), undefined);
  assert.equal(findUniqueSelectedSlateSalary(player, sheet, {
    ...dashboard,
    projections: [...dashboard.projections, { ...dashboard.projections[0], salaryPlayerId: 'duplicate' }],
  }, 'draftkings'), undefined);
  assert.equal(findUniqueSelectedSlateSalary(player, sheet, dashboard, 'fanduel'), undefined);
});

test('non-ready sheets cannot generate paid-player CSV data', () => {
  assert.equal(buildModelSheetCsv({ ...sheet, status: 'warming' }, dashboard, 'draftkings'), '');
});

