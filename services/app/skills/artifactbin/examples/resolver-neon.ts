/**
 * Example resolver: a Postgres query on Neon over its HTTP SQL endpoint (no raw TCP needed).
 * Secrets: NEON_PASSWORD = the database role's password, set by the page owner in the page's
 *   Resolvers panel. Use a read-only role.
 * Usage: cp examples/resolver-neon.ts orders.ts; link it with
 *   <link rel="af-resolver" data-af-name="orders" href="./orders.ts">; publish, then send the owner
 *   to the Resolvers panel to set NEON_PASSWORD and press Test connection.
 * Next: set HOST, ROLE and DATABASE from the connection string (postgresql://ROLE:…@HOST/DATABASE)
 *   and SQL; rename Order's fields to the query's columns.
 * Gotchas: pass reader input as $1, $2 params, never by string concatenation. A Postgres host
 *   without an HTTP SQL endpoint is out of reach (no raw TCP): import its rows as a dataset.
 */
const HOST = 'ep-example-123456.us-east-2.aws.neon.tech';
const ROLE = 'reader';
const DATABASE = 'neondb';
const SQL = 'SELECT id, customer, total, placed_at FROM orders WHERE status = $1 ' +
  'ORDER BY placed_at DESC LIMIT 200';
export const secrets = { NEON_PASSWORD: HOST };
export const typeDefs = `
  type Order { id: ID! customer: String total: Float placed_at: String }
  type Query {
    orders(status: String!): [Order!]!
    test: String! @auth(role: owner)
  }
`;
type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
type Init = { method?: string; headers?: Record<string, string>; body?: string };
type Caps = { fetch(url: string, init?: Init): Promise<Res> };
type Row = Record<string, unknown>;

async function sql(caps: Caps, query: string, params: unknown[] = []): Promise<Row[]> {
  const res = await caps.fetch('https://' + HOST + '/sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
      'Neon-Connection-String': 'postgresql://' + ROLE + ':{{NEON_PASSWORD}}@' + HOST + '/' +
        DATABASE + '?sslmode=require' },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok)
    throw Error('Neon answered ' + res.status);
  return ((await res.json()) as { rows?: Row[] }).rows ?? [];
}

export default {
  async orders({ status }: { status: string }, _principal: unknown, caps: Caps) {
    return (await sql(caps, SQL, [status])).map(r => ({ id: String(r.id),
      customer: r.customer ?? null, total: r.total === null ? null : Number(r.total),
      placed_at: r.placed_at == null ? null : String(r.placed_at) }));
  },
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    await sql(caps, 'SELECT 1');
    return 'Neon database ' + DATABASE + ' answered';
  },
};
