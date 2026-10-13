/** Parse the platform's CSV, including escaped quotes, BOMs and quoted newlines. */
export function parseSalaryCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; field = "";
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else field += char;
  }
  if (quoted) throw new Error("Incomplete salary CSV");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  const headers = rows.shift() ?? [];
  if (!["Name", "ID", "Salary", "Roster Position", "TeamAbbrev", "Game Info"]
    .every((header) => headers.includes(header))) {
    throw new Error("Unexpected salary export format");
  }
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error("Malformed salary CSV row");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}
