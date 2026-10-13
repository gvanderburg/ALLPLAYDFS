import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSalaryCsv } from "../src/lib/salary-csv.ts";

const header = "Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev";
test("reads platform prices and quoted comma/quote/newline fields", () => {
  const rows = parseSalaryCsv(`\uFEFF${header}\r\nC,"Player, ""Test""",123,C/UTIL,9500,"A@B\nGame",A\r\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Name, 'Player, "Test"');
  assert.equal(rows[0].Salary, "9500");
  assert.equal(rows[0]["Game Info"], "A@B\nGame");
});
test("does not treat an HTML error page or malformed export as salary data", () => {
  assert.throws(() => parseSalaryCsv("<html>Login required</html>"), /Unexpected/);
  assert.throws(() => parseSalaryCsv(`${header}\nC,"Unfinished`), /Incomplete/);
  assert.throws(() => parseSalaryCsv(`${header}\nC,Missing columns`), /Malformed/);
});
test("recognizes an unpublished, header-only salary export", () => {
  assert.deepEqual(parseSalaryCsv(header + "\r\n"), []);
});
