import { createHash } from "node:crypto";

export interface PoolRow {
  playerId: string; eventId: string; teamId: string; name: string;
  position: string; availability: string; salary: number | null;
}
export interface OwnershipRow { playerId: string; ownership: number; }
/** Strict RFC4180 subset, including quoted commas/newlines and escaped quotes. */
export function parseCsv(text: string): string[][] {
  if (!text || Buffer.byteLength(text) > 1048576 || text.includes("\0") || text.includes("\uFFFD")) throw new Error("Use a valid UTF-8 CSV up to 1 MB.");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Invalid CSV quoting.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field.trim()); field = ""; closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(v => v !== "")) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("Unexpected text after CSV quote.");
      field += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  row.push(field.trim());
  if (row.some(v => v !== "")) rows.push(row);
  if (rows.length < 2 || rows.length > 3001) throw new Error("CSV needs 1–3,000 records.");
  if (rows.some(r => r.length !== rows[0].length)) throw new Error("CSV column counts do not match.");
  return rows;
}
const id = (v: string) => /^[a-zA-Z0-9:_-]{1,100}$/.test(v);
const number = (v: string) => /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : NaN;
export function validateImportCsv(text: string, kind: "pool" | "ownership") {
  const [header, ...values] = parseCsv(text);
  const expected = kind === "pool" ? ["player_id", "event_id", "team_id", "name", "position", "availability", "salary"] : ["player_id", "ownership_percent"];
  if (header.join(",") !== expected.join(",")) throw new Error(`CSV header must be ${expected.join(",")}.`);
  const seen = new Set<string>();
  const records = values.map((v, i) => {
    if (!id(v[0]) || seen.has(v[0])) throw new Error(`Row ${i + 2}: invalid or duplicate player_id; multi-game players are not supported in one contest.`);
    seen.add(v[0]);
    if (kind === "ownership") {
      const ownership = number(v[1]);
      if (!Number.isFinite(ownership) || ownership < 0 || ownership > 100) throw new Error(`Row ${i + 2}: ownership_percent must explicitly be 0–100, not blank or a fraction/percent string.`);
      return { playerId: v[0], ownership } as OwnershipRow;
    }
    const salary = v[6] === "" ? null : number(v[6]);
    if (!id(v[1]) || !id(v[2]) || !v[3] || !v[4] || !v[5] || v.slice(3, 6).some(s => s.length > 200) ||
        salary !== null && (!Number.isInteger(salary) || salary <= 0 || salary > 100000)) throw new Error(`Row ${i + 2}: provide historical event/team IDs, name, position, availability and a positive integer salary or blank.`);
    return { playerId: v[0], eventId: v[1], teamId: v[2], name: v[3], position: v[4], availability: v[5], salary } as PoolRow;
  });
  return { records, hash: createHash("sha256").update(text).digest("hex"), rowCount: records.length };
}
