import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(config.outputDirectory, 'dist');
assert.match(config.buildCommand, /BASE_PATH=\//);
assert.match(config.buildCommand, /VITE_CLERK_PROXY_URL=\/api\/__clerk/);
assert.match(config.buildCommand, /scripts\/stage-vercel-output\.mjs$/);
assert.equal(config.rewrites[0].source, '/api/:path*');
assert.match(config.rewrites[0].destination, /^https:\/\/[^/]+\.replit\.app\/api\/:path\*$/);
assert.equal(config.rewrites[1].destination, '/index.html');
const pagePattern = new RegExp(`^${config.rewrites[1].source}$`);
assert.ok(pagePattern.test('/projections'));
assert.ok(!pagePattern.test('/api'));
assert.ok(!pagePattern.test('/api/membership'));
assert.ok(config.headers.find(rule => rule.source === '/api/:path*')
  ?.headers.some(header => header.key === 'Vercel-CDN-Cache-Control' && header.value === 'no-store'));
console.log('Vercel configuration checks passed.');

if (process.argv[2]) {
  const base = new URL(process.argv[2]);
  assert.equal(base.protocol, 'https:', 'Use the HTTPS deployment URL.');
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  const request = async (path) => {
    const response = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(45_000),
      redirect: 'follow',
    });
    assert.equal(response.status, 200, `${path}: expected HTTP 200, got ${response.status}`);
    return response;
  };
  const page = await request('/');
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const html = await page.text();
  assert.match(html, /ALLPLAY/);
  const script = html.match(/src=["']([^"']+\.js)["']/)?.[1];
  assert.ok(script, 'Homepage must reference a built JavaScript asset.');
  assert.match((await request(script)).headers.get('content-type') ?? '', /javascript/);
  for (const path of ['/projections', '/account', '/sign-in']) {
    assert.match((await request(path)).headers.get('content-type') ?? '', /text\/html/);
  }
  assert.equal((await (await request('/api/healthz')).json()).status, 'ok');
  const membershipResponse = await request('/api/membership');
  assert.match(membershipResponse.headers.get('cache-control') ?? '', /no-store/);
  const membership = await membershipResponse.json();
  assert.equal(membership.signedIn, false);
  assert.equal(membership.hasAccess, false);
  assert.equal(membership.isOwner, false);
  console.log(`Public routing and anonymous access checks passed for ${base.origin}.`);
  console.log('Authenticated flows still need verification before changing DNS.');
}
