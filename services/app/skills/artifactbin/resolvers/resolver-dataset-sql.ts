/**
 * Example resolver: totals per group over a linked dataset with read-only SQL (caps.sql), as the
 * caller.
 * Usage: cp resolvers/resolver-dataset-sql.ts totals.ts; link it beside the dataset with
 *   <link rel="af-dataset" data-af-name="orders" href="ref:DATASET_ID">
 *   <link rel="af-resolver" data-af-name="totals" href="./totals.ts"> and query
 *   {totals{byRegion(since:"2026-01-01"){region orders revenue}}}.
 * Next: rename orders, region, amount and day to your link and columns; pass values as $params.
 * Gotchas: reads only (write through caps.query mutations); the caller's rule for every dataset
 *   the SQL names must allow aggregations; 10,000 input rows, 5 s per query, 1 MiB answer.
 */
export const typeDefs = `
  type Total { region: String! orders: Int! revenue: Float! }
  type Query {
    byRegion(since: String): [Total!]!
    test: String! @auth(role: owner)
  }
`;
type Scalar = string | number | boolean | null;
type Rows = { rows: Record<string, Scalar>[] };
type Caps = { sql(sql: string, params?: Record<string, Scalar>): Promise<Rows> };
const BY_REGION = `SELECT region, count(*) AS orders, coalesce(sum(amount), 0) AS revenue
  FROM orders WHERE $since IS NULL OR day >= $since GROUP BY region ORDER BY revenue DESC`;

export default {
  async byRegion({since}: {since?: string | null}, _principal: unknown, caps: Caps) {
    return (await caps.sql(BY_REGION, {since: since ?? null})).rows;
  },
  async test(_args: unknown, _principal: unknown, caps: Caps) {
    const {rows} = await caps.sql('SELECT count(*) AS n FROM orders');
    return `Read ${rows[0]?.n ?? 0} rows from orders`;
  },
};
