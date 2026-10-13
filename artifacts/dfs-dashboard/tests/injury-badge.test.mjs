import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'allplay-injury-badge-'));
await build({ stdin: { contents: `
  import { createElement } from "react";
  import { renderToStaticMarkup } from "react-dom/server";
  import { InjuryBadge } from "./src/components/injury-badge";
  export const render = status => renderToStaticMarkup(createElement(InjuryBadge, { status }));
`, resolveDir: process.cwd() }, bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  outfile: join(dir, 'badge.mjs') });
const { render } = await import(pathToFileURL(join(dir, 'badge.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));
test('OUT stays a compact red-class badge; full injury details are tooltip-only', () => {
  const html = render('Out · Knee injury · Not expected to play');
  assert.ok(html.includes('injury-out') && html.endsWith('>OUT</span>'));
  assert.ok(html.includes('title="Out · Knee injury · Not expected to play"'));
});
test('questionable is a compact yellow-class badge with an accessible full status', () => {
  assert.ok(render('Questionable · Ankle').includes('injury-questionable'));
  assert.ok(render('Questionable · Ankle').endsWith('>QUESTIONABLE</span>'));
  assert.ok(render('Q').includes('aria-label="Injury status: Q"'));
});
test('healthy and unknown statuses do not create large status labels', () => {
  for (const status of ['Active', 'Available', 'Injury status unavailable', '', null]) assert.equal(render(status), '');
});
test('reserve, doubtful and day-to-day retain compact meaningful labels', () => {
  assert.ok(render('Injured reserve').endsWith('>IR</span>'));
  assert.ok(render('Doubtful · illness').endsWith('>DOUBTFUL</span>'));
  assert.ok(render('Day-to-day').endsWith('>DTD</span>'));
});
