import assert from 'node:assert/strict';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtApp = path.join(workspaceRoot, 'artifacts', 'dfs-dashboard', 'dist');
const vercelOutput = path.join(workspaceRoot, 'dist');

assert.equal(
  (await stat(path.join(builtApp, 'index.html'))).isFile(),
  true,
  'ALLPLAY build did not produce artifacts/dfs-dashboard/dist/index.html',
);

await rm(vercelOutput, { recursive: true, force: true });
await mkdir(vercelOutput, { recursive: true });
await cp(builtApp, vercelOutput, { recursive: true });

assert.equal(
  (await stat(path.join(vercelOutput, 'index.html'))).isFile(),
  true,
  'Failed to stage the ALLPLAY homepage in Vercel’s root dist directory',
);
console.log('Staged ALLPLAY static site in the repository-root dist directory for Vercel.');
