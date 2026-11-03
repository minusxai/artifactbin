/**
 * Example resolver: a BigQuery SQL query, run with a Google service account (jobs.query REST API).
 * Secrets: GOOGLE_SA = the service account's JSON key (roles BigQuery Job User and Data Viewer),
 *   set by the page owner in the page's Resolvers panel.
 * Usage: cp examples/resolver-bigquery.ts revenue.ts; link it with
 *   <link rel="af-resolver" data-af-name="revenue" href="./revenue.ts">; publish, then send the
 *   owner to the Resolvers panel to set GOOGLE_SA and press Test connection.
 * Next: set PROJECT and SQL; rename Point's fields to the query's columns.
 * Gotchas: pass reader input as query parameters (never by string concatenation). A slow query
 *   returns jobComplete:false: aggregate in SQL so it finishes within 10 s.
 */
const PROJECT = 'my-project';
const SQL = `SELECT FORMAT_DATE('%Y-%m', day) AS month, SUM(revenue) AS revenue
  FROM \`my-project.sales.daily\` WHERE region = @region GROUP BY month ORDER BY month`;
export const secrets = { GOOGLE_SA: 'bigquery.googleapis.com' };
export const typeDefs = `
  type Point { month: String! revenue: Float }
  type Query {
    revenue(region: String!): [Point!]!
    test: String! @auth(role: owner)
  }
`;
type Auth = { type: 'google'; secret: string; scopes: string[] };
type Res = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
type Init = { method?: string; headers?: Record<string, string>; body?: string; auth?: Auth };
type Caps = { fetch(url: string, init?: Init): Promise<Res> };
type Result = { jobComplete?: boolean; schema?: { fields: Array<{ name: string }> };
  rows?: Array<{ f: Array<{ v: string | null }> }> };
const auth: Auth = { type: 'google', secret: 'GOOGLE_SA',
  scopes: ['https://www.googleapis.com/auth/bigquery.readonly'] };

async function query(caps: Caps, sql: string, params: Record<string, string> = {}) {
  const url = 'https://bigquery.googleapis.com/bigquery/v2/projects/' + PROJECT + '/queries';
  const res = await caps.fetch(url, {
    method: 'POST', auth, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 8000, parameterMode: 'NAMED',
      queryParameters: Object.entries(params).map(([name, value]) => ({ name,
        parameterType: { type: 'STRING' }, parameterValue: { value } })) }),
  });
  if (!res.ok)
    throw Error('BigQuery answered ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const body = (await res.json()) as Result;
  if (!body.jobComplete) throw Error('BigQuery did not finish in time');
  const names = body.schema?.fields.map(f => f.name) ?? [];
  return (body.rows ?? [])
    .map(r => Object.fromEntries(names.map((n, i) => [n, r.f[i]?.v ?? null])));
}

export default {
  async revenue({ region }: { region: string }, _principal: unknown, caps: Caps) {
    return (await query(caps, SQL, { region }))
      .map(r => ({ month: String(r.month),
        revenue: r.revenue === null ? null : Number(r.revenue) }));
  },
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    await query(caps, 'SELECT 1');
    return 'BigQuery project ' + PROJECT + ' answered';
  },
};
