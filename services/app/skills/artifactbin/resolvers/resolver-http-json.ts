/**
 * Example backend functions: a JSON API behind a bearer key; the key is a secret the host fills
 *   in, never in code.
 * Secrets: API_KEY = the provider's key, set by the page owner in the page's Resolvers panel.
 * Usage: cp resolvers/resolver-http-json.ts deals.ts; link it with
 *   <link rel="af-resolver" data-af-name="deals" href="./deals.ts">; the page calls
 *   fetch('/fn/items?status=open'); publish, then send the owner to the Resolvers panel to set
 *   API_KEY and press Test connection (it runs test).
 * Next: set HOST and PATH; rename the fields items() maps to the API's JSON.
 * Gotchas: {{API_KEY}} is filled only in requests to HOST (the secrets map binds it). Never return
 *   the key or echo it into rows. Every status comes back: check res.ok and read 4xx bodies.
 */
const HOST = 'api.example.com';
const PATH = '/v1/items';
export const secrets = { API_KEY: HOST };
export const roles = { test: 'owner' };
type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
type Init = { method?: string; headers?: Record<string, string>; body?: string };
type Caps = { fetch(url: string, init?: Init): Promise<Res> };

async function get(caps: Caps, query = ''): Promise<Array<Record<string, unknown>>> {
  const res = await caps.fetch('https://' + HOST + PATH + query, {
    headers: { Authorization: 'Bearer {{API_KEY}}', Accept: 'application/json' },
  });
  if (!res.ok)
    throw Error(HOST + ' answered ' + res.status);
  const body = await res.json() as { data?: unknown } | unknown[];
  const list = Array.isArray(body) ? body : body?.data;
  return Array.isArray(list) ? list : [];
}

export default {
  async items({ status }: { status?: string }, _principal: unknown, caps: Caps) {
    const rows = await get(caps, status ? '?status=' + encodeURIComponent(status) : '');
    return rows.map(r => ({ id: String(r.id), name: String(r.name ?? ''),
      amount: Number(r.amount) || null }));
  },
  async test(_input: unknown, _principal: unknown, caps: Caps) {
    return 'Read ' + (await get(caps)).length + ' items from ' + HOST + PATH;
  },
};
