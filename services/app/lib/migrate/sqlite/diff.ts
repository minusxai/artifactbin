/**
 * THE DIFFERENTIAL CHECK for translated statements: run the original on
 * DuckDB and the translation on the target engine over the same data, and
 * compare what comes back — column names, and rows as a multiset of values.
 * A document's queries read each other by name, so the cases go to each
 * engine as ONE run, in dependency order, the way the document runs them.
 *
 * Coded against `SqlService`, not an engine. Each side brings its own tables
 * and parameters: that is the seam for the SQLite engine, which registers a
 * document's imports under their schema names (`bookings.rows`) and binds the
 * built-ins (`_now`, `_tz`, `_me__id`) where DuckDB read `ref_<id>` tables and
 * its own clock.
 *
 * Values are compared as the two engines' representations of the same
 * meaning: booleans as 0/1, lists as arrays whether they arrive as arrays or
 * JSON text, dates and timestamps as instants (so a DuckDB midnight timestamp
 * equals the date the library returns), numbers to 12 significant digits.
 */
import { isQueryFailure, type Row, type RunInput, type Scalar, type SqlService, type TableResult } from '@artifactbin/contracts';
import { normalizeTimestamp } from '@artifactbin/utils/shape';

export interface DiffSide {
  service: SqlService;
  /** The tables as this engine names them. */
  tables: RunInput['tables'];
  /** Parameters every case binds on this side (the built-ins, for the SQLite side). */
  params?: Record<string, Scalar>;
  paramTypes?: RunInput['paramTypes'];
}

export interface DiffCase {
  name: string;
  original: string;
  translated: string;
}

export interface DiffInput {
  /** In dependency order: a case may read an earlier one by name. */
  cases: DiffCase[];
  /** Page values both sides bind. */
  params?: Record<string, Scalar>;
}

export type DiffVerdict =
  | { name: string; status: 'same' }
  | {
      name: string;
      status: 'different';
      /** Present when the output column names differ (in order). */
      columns?: { original: string[]; translated: string[] };
      /** Present when the rows differ; at most a few of each. */
      rows?: { missing: unknown[][]; extra: unknown[][] };
    }
  | { name: string; status: 'failed'; original?: string; translated?: string };

const SAMPLE = 5;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/** One value as a comparable, engine-neutral form. */
export function comparable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number(value.toPrecision(12));
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === 'string') {
    if (value.startsWith('[')) {
      try { const list: unknown = JSON.parse(value); if (Array.isArray(list)) return list.map(comparable); } catch { /* text that starts with a bracket */ }
    }
    if (DATE_LIKE.test(value)) {
      try { return { instant: normalizeTimestamp(value) }; } catch { /* not a real calendar date: compare as text */ }
    }
    return value;
  }
  return JSON.stringify(value);
}

const rowsOf = (result: TableResult): unknown[][] => {
  const names = result.columns.map((c) => c.name);
  return result.rows.map((row: Row) => names.map((name) => comparable(row[name])));
};

/** Rows present in `a` more often than in `b`, by value. */
function surplus(a: unknown[][], b: unknown[][]): unknown[][] {
  const counts = new Map<string, number>();
  for (const row of b) { const key = JSON.stringify(row); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const out: unknown[][] = [];
  for (const row of a) {
    const key = JSON.stringify(row);
    const left = counts.get(key) ?? 0;
    if (left > 0) counts.set(key, left - 1);
    else out.push(row);
  }
  return out;
}

/** Each case's result on one side, or its error. */
async function runAll(side: DiffSide, queries: Array<{ name: string; sql: string }>, params: Record<string, Scalar> | undefined): Promise<Record<string, TableResult | string>> {
  let results: Awaited<ReturnType<SqlService['run']>>;
  try {
    results = await side.service.run({ tables: side.tables, queries, params: { ...side.params, ...params }, ...(side.paramTypes ? { paramTypes: side.paramTypes } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.fromEntries(queries.map((q) => [q.name, message]));
  }
  return Object.fromEntries(queries.map((q) => {
    const outcome = results[q.name];
    return [q.name, !outcome ? 'no result' : isQueryFailure(outcome) ? outcome.error : outcome];
  }));
}

/** Run every case on both sides and say, per case, whether the translation gives the same answer. */
export async function diffStatements(input: DiffInput, sides: { original: DiffSide; translated: DiffSide }): Promise<DiffVerdict[]> {
  const [originals, translations] = await Promise.all([
    runAll(sides.original, input.cases.map((c) => ({ name: c.name, sql: c.original })), input.params),
    runAll(sides.translated, input.cases.map((c) => ({ name: c.name, sql: c.translated })), input.params),
  ]);
  const verdicts: DiffVerdict[] = [];
  for (const c of input.cases) {
    const original = originals[c.name];
    const translated = translations[c.name];
    if (typeof original === 'string' || typeof translated === 'string') {
      verdicts.push({ name: c.name, status: 'failed', ...(typeof original === 'string' ? { original } : {}), ...(typeof translated === 'string' ? { translated } : {}) });
      continue;
    }
    const names = { original: original.columns.map((col) => col.name), translated: translated.columns.map((col) => col.name) };
    const columnsDiffer = JSON.stringify(names.original) !== JSON.stringify(names.translated);
    const a = rowsOf(original);
    const b = rowsOf(translated);
    const missing = surplus(a, b);
    const extra = surplus(b, a);
    const rowsDiffer = missing.length > 0 || extra.length > 0;
    if (!columnsDiffer && !rowsDiffer) { verdicts.push({ name: c.name, status: 'same' }); continue; }
    verdicts.push({
      name: c.name,
      status: 'different',
      ...(columnsDiffer ? { columns: names } : {}),
      ...(rowsDiffer ? { rows: { missing: missing.slice(0, SAMPLE), extra: extra.slice(0, SAMPLE) } } : {}),
    });
  }
  return verdicts;
}
