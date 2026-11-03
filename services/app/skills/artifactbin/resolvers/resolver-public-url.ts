/**
 * Example resolver: rows from a public CSV or JSON URL (no secrets), typed for the page.
 * Usage: cp resolvers/resolver-public-url.ts sales.ts; link it with
 *   <link rel="af-resolver" data-af-name="sales" href="./sales.ts"> and query
 *   {sales{rows{name value}}}.
 * Next: set URL; rename Row's fields and the mapping in row() to your columns.
 * Gotchas: HTTPS on port 443 only, 2 MiB and 10 s per request; private addresses are refused. A
 *   Google Sheet published to the web works: use its CSV export URL. Quoted fields may hold commas.
 */
const URL = 'https://example.com/data.csv';
export const typeDefs = `
  type Row { name: String! value: Float }
  type Query {
    rows(limit: Int): [Row!]!
    test: String! @auth(role: owner)
  }
`;
type Res = { ok: boolean; status: number; text(): Promise<string> };
type Caps = { fetch(url: string): Promise<Res> };
type Fields = Record<string, string>;

/** One CSV line into fields; doubled quotes inside a quoted field are one quote. */
function fields(line: string): string[] {
  const out: string[] = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { out.push(value); value = ''; }
    else value += c;
  }
  return [...out, value];
}

async function records(caps: Caps): Promise<Fields[]> {
  const res = await caps.fetch(URL);
  if (!res.ok) throw Error('The URL answered ' + res.status);
  const text = await res.text();
  if (/^\s*[[{]/.test(text)) {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : data.rows ?? data.data ?? [];
  }
  const [header = [], ...lines] = text.split(/\r?\n/).filter(Boolean).map(fields);
  return lines.map(line => Object.fromEntries(header.map((key, i) => [key.trim(), line[i] ?? ''])));
}
const row = (r: Fields) =>
  ({ name: String(r.name ?? ''), value: r.value === '' ? null : Number(r.value) });

export default {
  async rows({ limit }: { limit?: number }, _principal: unknown, caps: Caps) {
    return (await records(caps)).slice(0, Math.min(limit ?? 1000, 1000)).map(row);
  },
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    return 'Read ' + (await records(caps)).length + ' rows from ' + URL;
  },
};
