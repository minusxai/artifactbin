/** Schema-only SQL dependency selection. SQLite is the sole SQL parser; no dataset rows enter planning. */
import { loadSqlite, TimedOut, type Relation } from '@artifactbin/sql/core';
import { SQL_READ_LIMITS, type DryRunInput } from '@artifactbin/contracts';

interface SqlLinkRelation extends Relation { link: string }
interface SqlLinkSelection { selected: Set<string>; errors: Record<string, { error: string; timedOut?: boolean }> }
/** SQLite identifiers fold ASCII only (Unicode-distinct identifiers remain distinct). */
const identifier = (name: string): string => name.replace(/[A-Z]/g, (c) => c.toLowerCase());
const same = (a: Pick<Relation, 'schema' | 'table'>, b: Pick<Relation, 'schema' | 'table'>) => identifier(a.schema) === identifier(b.schema) && identifier(a.table) === identifier(b.table);

export async function selectSqlLinks(relations: readonly SqlLinkRelation[], input: Omit<DryRunInput, 'imports'>, scope?: { signal: AbortSignal; deadline: number }): Promise<SqlLinkSelection> {
  const check = () => {
    scope?.signal.throwIfAborted();
    if (scope && performance.now() >= scope.deadline) throw new Error('sql_deadline');
  };
  check();
  const engine = await loadSqlite();
  check();
  let schema: Array<Relation & { link?: string }> = [...relations];
  for (const [table, shape] of Object.entries(input.tables)) {
    const inline = { schema: 'main', table, columns: shape.columns, link: relations.find((r) => identifier(r.link) === identifier(table))?.link };
    schema = schema.filter((r) => !same(r, inline));
    schema.push(inline);
  }
  const selected = new Set<string>();
  const errors: SqlLinkSelection['errors'] = {};
  for (const query of input.queries) {
    check();
    try {
      const analysis = engine.analyze(query.sql, schema);
      if (analysis.kind !== 'select' || analysis.writes.length) throw new Error('SQL requires a SELECT statement');
      const referenced = schema.filter((r) => analysis.reads.some((read) => same(read, r)));
      for (const relation of referenced) if (relation.link !== undefined) selected.add(relation.link);
      // Use the engine's existing guarded preparation/bind/rows path (as dryRun does), on empty shapes.
      // Its interrupt is bounded by the caller's remaining wall time as well as the statement deadline.
      const db = engine.open();
      let columns;
      try {
        for (const relation of referenced) db.createTable(relation);
        const prepared = db.prepare(query.sql, 'read');
        try {
          check();
          columns = prepared.bind(Object.fromEntries(input.paramNames.map((name) => [name, null])), input.paramTypes)
            .rows(SQL_READ_LIMITS.rows, Math.min(SQL_READ_LIMITS.timeoutMs, scope ? Math.max(1, scope.deadline - performance.now()) : SQL_READ_LIMITS.timeoutMs)).columns;
        } finally { prepared.finalize(); }
      } finally { db.close(); }
      const output = { schema: 'main', table: query.name, columns };
      schema = schema.filter((r) => !same(r, output));
      schema.push(output);
    } catch (e) {
      check();
      // No engine execution or raw metadata-bearing diagnostic for a statement that could not be planned.
      errors[query.name] = e instanceof TimedOut ? { error: 'SQL statement timed out', timedOut: true } : { error: 'SQL statement could not be prepared' };
    }
  }
  check();
  return { selected, errors };
}
