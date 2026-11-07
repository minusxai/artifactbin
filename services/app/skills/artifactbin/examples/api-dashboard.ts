/**
 * Example resolver: examples/api-dashboard.html's items, a JSON list read from an HTTP API with a
 *   key that is a secret the host fills in, never in code.
 * Secrets: API_KEY = the API's key, set by the page owner in the page's Resolvers settings.
 * Usage: node scripts/new-app.mjs --kind api --url URL copies it as api.ts with HOST and PATH set
 *   from URL; the page reads it as api.items (each item's fields as the API sent them).
 * Gotchas: every reader of the page can read every field items returns: list in FIELDS only those
 *   the page shows when the API sends more (emails, private notes). One request, so a paged API
 *   gives its first page: put its page-size parameter in PATH. An API that takes its key in
 *   another header: change HEADERS (e.g. { 'X-API-Key': '{{API_KEY}}' }). Errors are left to
 *   throw: an unset key is reported as such, never as an empty list.
 */
const HOST = 'api.example.com';
const PATH = '/v1/items';
const HEADERS = { Authorization: 'Bearer {{API_KEY}}', Accept: 'application/json' };
/** The fields readers may see; empty: every text, number and true/false field of an item. */
const FIELDS: string[] = [];
export const secrets = { API_KEY: HOST };
export const typeDefs = `
  "One item as the API sent it: its text, number and true/false fields."
  scalar Item
  type Query {
    items: [Item!]!
    test: String! @auth(role: owner)
  }
`;
type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
type Caps = { fetch(url: string, init?: { headers?: Record<string, string> }): Promise<Res> };
type Row = Record<string, unknown>;

/** The API's list: the body itself, or the first list in it ({data: [...]}, {deals: [...]}). */
async function read(caps: Caps): Promise<Row[]> {
  const res = await caps.fetch('https://' + HOST + PATH, { headers: HEADERS });
  if (!res.ok)
    throw Error(HOST + ' answered ' + res.status + ': ' + (await res.text()).slice(0, 120));
  const body = await res.json();
  const list = Array.isArray(body) ? body : body && typeof body === 'object' ?
    Object.values(body).find(Array.isArray) : undefined;
  if (!Array.isArray(list)) throw Error(HOST + PATH + ' sent no list');
  return list.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row));
}
const shown = (row: Row) => Object.fromEntries(Object.entries(row).filter(([name, value]) =>
  (!FIELDS.length || FIELDS.includes(name)) &&
  ['string', 'number', 'boolean'].includes(typeof value)));

export default {
  async items(_args: unknown, _principal: unknown, caps: Caps) {
    return (await read(caps)).slice(0, 5000).map(shown);
  },
  // Test connection: the count and the field names, which APP.fields in the page names.
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    const rows = await read(caps);
    return 'Read ' + rows.length + ' items from ' + HOST + PATH + '; fields: ' +
      Object.keys(shown(rows[0] ?? {})).join(', ');
  },
};
