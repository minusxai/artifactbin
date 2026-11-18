/**
 * RAW ROWS: the database state a test sets up directly, past the doors (no events, revisions, audit or notifications).
 * Each call is one statement writing exactly the columns given, so a test keeps its explicit ids and timestamps and the
 * database supplies every default; `db` is whichever connection the test holds (the harness's, or a transaction's).
 *
 * A value is bound as a parameter, so `meta: '{}'` or `meta: JSON.stringify(x)` reaches a jsonb column as it would in
 * SQL text. `{ sql: "now() - interval '2 days'" }` is written into the statement as SQL instead.
 */
/** Any connection: the harness's `Db`, a transaction, a raw PGlite. */
type Queryable = { query(sql: string, params?: unknown[]): Promise<unknown> };

type Value = unknown;
type Row = Record<string, Value>;
const isSql = (value: Value): value is { sql: string } =>
  typeof value === 'object' && value !== null && Object.keys(value).length === 1 && typeof (value as { sql?: unknown }).sql === 'string';

function insert(db: Queryable, table: string, rows: Row[]) {
  const columns = Object.keys(rows[0] ?? {});
  if (!columns.length || rows.some((row) => Object.keys(row).join() !== columns.join())) throw new Error(`${table}: every row names the same columns`);
  const params: Value[] = [];
  const bind = (value: Value) => isSql(value) ? value.sql : `$${params.push(value)}`;
  const values = rows.map((row) => `(${columns.map((column) => bind(row[column])).join(', ')})`).join(', ');
  return db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`, params);
}

/** INSERT INTO artifacts: one row per argument, all naming the same columns. */
export const seedArtifacts = async (db: Queryable, ...rows: Row[]) => { await insert(db, 'artifacts', rows); };
/** INSERT INTO artifact_shares: one row per argument, all naming the same columns. */
export const seedShares = async (db: Queryable, ...rows: Row[]) => { await insert(db, 'artifact_shares', rows); };

/** UPDATE artifacts SET the given columns WHERE id is `id` (or any of the ids given). */
export async function setArtifact(db: Queryable, id: string | string[], set: Row) {
  const params: Value[] = [id];
  const assignments = Object.entries(set).map(([column, value]) => `${column} = ${isSql(value) ? value.sql : `$${params.push(value)}`}`);
  if (!assignments.length) throw new Error('setArtifact: nothing to set');
  await db.query(`UPDATE artifacts SET ${assignments.join(', ')} WHERE ${Array.isArray(id) ? 'id = ANY($1::text[])' : 'id = $1'}`, params);
}

/** DELETE FROM artifact_shares of the artifact (or any of the artifacts given), narrowed to the columns given. */
export async function dropShares(db: Queryable, artifactId: string | string[], where: Row = {}) {
  const params: Value[] = [artifactId];
  const narrowed = Object.entries(where).map(([column, value]) => ` AND ${column} = $${params.push(value)}`).join('');
  await db.query(`DELETE FROM artifact_shares WHERE ${Array.isArray(artifactId) ? 'artifact_id = ANY($1::text[])' : 'artifact_id = $1'}${narrowed}`, params);
}
