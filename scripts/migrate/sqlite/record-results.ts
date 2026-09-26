/**
 * RECORD WHAT EVERY DOCUMENT'S QUERIES RETURN, to prove the SQLite data-syntax
 * migration did not change results. Rehearsal only, on a restored copy:
 *
 *   npx tsx scripts/migrate/sqlite/record-results.ts --db <database url> --objects <object dir> --out <file.jsonl>
 *
 * From the repository root (the `@/` imports resolve through its tsconfig).
 * Run it at the pre-compiler commit (DuckDB, the previous syntax) and again on
 * the migrated tree (SQLite), then compare the two files with
 * compare-results.ts. It runs unchanged at both: copy this directory's
 * record-results.ts and local-services.ts into the older checkout. It depends
 * only on getDb, getArtifactById and dataflowForRow, which both trees have.
 *
 * For every live markup document it runs the data with default values, read
 * by the document's owner (so `$_me` and folder listings are the same person on
 * both runs), under the product's row cap. One JSON line per result table:
 * `{document, query, columns, rows}` or `{document, query, error}`, and
 * `{document, error}` when the whole document fails to run.
 */
import { createWriteStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Queryable } from '@/lib/db';
import { useLocalServices } from './local-services';

type Artifacts = typeof import('@/lib/artifacts');

export type RecordedResult =
  /** `truncated`: the engine cut the result short (a cap, or the previous engine's first page of a `source=` query). */
  | { document: string; query: string; columns: string[]; rows: unknown[][]; truncated?: true }
  | { document: string; query: string; error: string }
  | { document: string; error: string };

/** One document's run may not hold the rehearsal up. */
const DOCUMENT_TIMEOUT_MS = 60_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Wide integers from the engine, as the JSON the wire would carry. */
const plain = (value: unknown) => (typeof value === 'bigint' ? Number(value) : value);

export async function recordResults(
  deps: { db: Queryable; getArtifactById: Artifacts['getArtifactById']; dataflowForRow: Artifacts['dataflowForRow'] },
  write: (result: RecordedResult) => void,
): Promise<{ documents: number; results: number }> {
  const ids = (await deps.db.query<{ id: string }>("SELECT id FROM artifacts WHERE format='markup' AND deleted_at IS NULL ORDER BY id")).rows;
  let results = 0;
  for (const { id } of ids) {
    const emit = (result: RecordedResult) => { results++; write(result); };
    try {
      const row = await deps.getArtifactById(id);
      if (!row) continue;
      const ran = await deps.dataflowForRow(row, { viewer: { userId: row.user_id, tokenId: row.token_id }, signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS) });
      if (!ran) continue;
      for (const [query, table] of Object.entries(ran.state.tables)) {
        const columns = table.columns.map((column) => column.name);
        emit({ document: id, query, columns, rows: table.rows.map((r) => columns.map((name) => plain(r[name]))), ...(table.truncated ? { truncated: true as const } : {}) });
      }
      for (const [query, error] of Object.entries(ran.state.errors)) emit({ document: id, query, error });
    } catch (error) {
      emit({ document: id, error: message(error) });
    }
  }
  return { documents: ids.length, results };
}

async function main() {
  const { values } = parseArgs({ options: { db: { type: 'string' }, objects: { type: 'string' }, out: { type: 'string' } } });
  if (!values.db || !values.objects || !values.out) throw new Error('usage: record-results.ts --db <url> --objects <dir> --out <file.jsonl>');
  await useLocalServices({ db: values.db, objects: values.objects });
  // After the environment is set: lib/config reads it on first import.
  const [{ getDb }, artifacts] = await Promise.all([import('@/lib/db'), import('@/lib/artifacts')]);
  const db = await getDb();
  const out = createWriteStream(values.out);
  const summary = await recordResults({ db, getArtifactById: artifacts.getArtifactById, dataflowForRow: artifacts.dataflowForRow }, (result) => out.write(`${JSON.stringify(result, (_, value) => plain(value))}\n`));
  await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
  await db.close();
  console.log(`recorded ${summary.results} results from ${summary.documents} documents → ${values.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
