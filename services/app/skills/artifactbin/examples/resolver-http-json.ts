/**
 * Resolver: a JSON API behind a bearer key; the key is a secret the host fills in, never in code.
 * Secrets: API_KEY = the provider's key, set by the page owner in the page's Resolvers panel.
 * Usage: cp examples/resolver-http-json.ts deals.ts; link it with
 *   <link rel="af-resolver" data-af-name="deals" href="./deals.ts">; publish, then send the owner to
 *   the Resolvers panel to set API_KEY and press Test connection.
 * Next: set HOST and PATH; rename Item's fields and the mapping to the API's JSON.
 * Gotchas: {{API_KEY}} is filled only in requests to HOST (the secrets map binds it). Never return
 *   the key or echo it into rows. Every status comes back: check res.ok and read 4xx bodies.
 */
const HOST = 'api.example.com';
const PATH = '/v1/items';
export const secrets = { API_KEY: HOST };
export const typeDefs = `
  type Item { id: ID! name: String! amount: Float }
  type Query {
    items(status: String): [Item!]!
    test: String! @auth(role: owner)
  }
`;
type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
type Caps = { fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Res> };

async function get(caps: Caps, query = ''): Promise<Array<Record<string, unknown>>> {
  const res = await caps.fetch('https://' + HOST + PATH + query, {
    headers: { Authorization: 'Bearer {{API_KEY}}', Accept: 'application/json' },
  });
  if (!res.ok) throw Error(HOST + ' answered ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const body = await res.json() as { data?: unknown } | unknown[];
  const list = Array.isArray(body) ? body : body?.data;
  return Array.isArray(list) ? list : [];
}

export default {
  async items({ status }: { status?: string }, _principal: unknown, caps: Caps) {
    const rows = await get(caps, status ? '?status=' + encodeURIComponent(status) : '');
    return rows.map(r => ({ id: String(r.id), name: String(r.name ?? ''), amount: Number(r.amount) || null }));
  },
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    return 'Read ' + (await get(caps)).length + ' items from ' + HOST + PATH;
  },
};
