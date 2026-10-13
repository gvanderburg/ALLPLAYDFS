import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "allplay-take-files-"));
after(() => rm(dir, { recursive: true, force: true }));
await build({
  entryPoints: ["src/lib/take-files.ts"],
  absWorkingDir: new URL("../", import.meta.url).pathname,
  outfile: join(dir, "files.mjs"), bundle: true, platform: "node", format: "esm",
});
const { validTakeFile, validTakeSignature, parseTakeRange, DOCUMENT_LIMIT, VIDEO_LIMIT } = await import(join(dir, "files.mjs"));
test("allowed formats and per-kind size limits are enforced", () => {
  assert.equal(validTakeFile("article.PDF", "application/pdf", DOCUMENT_LIMIT), true);
  assert.equal(validTakeFile("script.mp4", "video/mp4", VIDEO_LIMIT), true);
  for (const [name, type, size] of [
    ["article.pdf", "application/pdf", DOCUMENT_LIMIT + 1],
    ["clip.mp4", "video/mp4", VIDEO_LIMIT + 1],
    ["clip.mp4", "application/pdf", 15],
    ["page.html", "text/html", 15],
    ["../secret.pdf", "application/pdf", 15],
    ["new\nname.txt", "text/plain", 15],
    ["empty.txt", "text/plain", 0],
  ]) assert.equal(validTakeFile(name, type, size), false);
});
test("file contents must match their approved format", () => {
  assert.equal(validTakeSignature("application/pdf", Buffer.from("%PDF-1.4")), true);
  assert.equal(validTakeSignature("application/pdf", Buffer.from("<html>")), false);
  assert.equal(validTakeSignature("video/mp4", Buffer.from([0,0,0,32,102,116,121,112])), true);
  assert.equal(validTakeSignature("video/webm", Buffer.from([0x1a,0x45,0xdf,0xa3])), true);
  assert.equal(validTakeSignature("text/plain", Buffer.from([1,0,2])), false);
});
test("video byte ranges support seeking and reject invalid/multiple ranges", () => {
  assert.deepEqual(parseTakeRange("bytes=10-20", 100), { start: 10, end: 20 });
  assert.deepEqual(parseTakeRange("bytes=10-", 100), { start: 10, end: 99 });
  assert.deepEqual(parseTakeRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseTakeRange("bytes=90-500", 100), { start: 90, end: 99 });
  for (const value of ["bytes=500-", "bytes=10-5", "bytes=-0", "bytes=-", "bytes=0-1,3-4", "bytes=NaN-"]) {
    assert.equal(parseTakeRange(value, 100), null);
  }
});
