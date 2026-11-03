/**
 * Example resolver: rows from a Supabase table over its REST API (PostgREST), read-only.
 * Secrets: SUPABASE_KEY = the project's anon key (with row level security) or a dedicated key,
 *   set by the page owner in the page's Resolvers panel. Prefer the anon key: never the service
 *   role key unless the page is private.
 * Usage: cp examples/resolver-supabase.ts tasks.ts; link it with
 *   <link rel="af-resolver" data-af-name="tasks" href="./tasks.ts">; publish, then send the owner
 *   to the Resolvers panel to set SUPABASE_KEY and press Test connection.
 * Next: set PROJECT (the subdomain of your project URL) and TABLE; rename Task's fields.
 * Gotchas: filters use PostgREST syntax (?status=eq.open); encode reader input with
 *   encodeURIComponent. Writes from readers belong in an artifactbin dataset, not here.
 */
const PROJECT = 'abcdefghijklmnop';
const TABLE = 'tasks';
const HOST = PROJECT + '.supabase.co';
export const secrets = { SUPABASE_KEY: HOST };
export const typeDefs = `
  type Task { id: ID! title: String! status: String due: String }
  type Query {
    tasks(status: String, limit: Int): [Task!]!
    test: String! @auth(role: owner)
  }
`;
type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
type Caps = { fetch(url: string, init?: { headers?: Record<string, string> }): Promise<Res> };

async function select(caps: Caps, query: string): Promise<Array<Record<string, unknown>>> {
  const res = await caps.fetch('https://' + HOST + '/rest/v1/' + TABLE + '?' + query, {
    headers: { apikey: '{{SUPABASE_KEY}}', Authorization: 'Bearer {{SUPABASE_KEY}}' },
  });
  if (!res.ok)
    throw Error('Supabase answered ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return (await res.json()) as Array<Record<string, unknown>>;
}

export default {
  async tasks(args: { status?: string; limit?: number }, _principal: unknown, caps: Caps) {
    const { status, limit } = args;
    const filter = status ? '&status=eq.' + encodeURIComponent(status) : '';
    const rows = await select(caps, 'select=id,title,status,due&order=due.asc&limit=' +
      Math.min(limit ?? 500, 1000) + filter);
    return rows.map(r => ({ id: String(r.id), title: String(r.title ?? ''),
      status: r.status ?? null, due: r.due ?? null }));
  },
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    return 'Read ' + (await select(caps, 'select=id&limit=5')).length + ' rows from ' + TABLE;
  },
};
