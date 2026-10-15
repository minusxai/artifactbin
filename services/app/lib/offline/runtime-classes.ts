/**
 * THE CLASSES AN OFFLINE FILE'S ROWS BRING (lib/data/story/story-css RUNTIME CLASSES). A file has no server to ask
 * for its sheet again (lib/islands/runtime-css), so its Tailwind is compiled — at export, and again when the file
 * rebuilds its sheet after an edit — with the class-shaped words of every row it carries: the downloaded run, every
 * precomputed variant and the imports its own engine queries. Browser safe: the file's editor runs it too.
 */
import { hasRuntimeClasses, offlineRuntimeClasses } from '@/lib/data/story/story-css';
import type { DataflowState } from '@/lib/dataflow';
import type { ArtifactFileSnapshot } from './file-format';

type Rows = readonly Readonly<Record<string, unknown>>[];
type Carried = { state: Pick<DataflowState, 'tables'> } & Partial<Pick<ArtifactFileSnapshot, 'variants' | 'held'>>;

function* rowsOf(snapshot: Carried): Generator<Rows> {
  for (const table of Object.values(snapshot.state.tables ?? {})) if (table?.rows) yield table.rows as Rows;
  for (const variant of snapshot.variants ?? []) for (const table of Object.values(variant.tables)) if (table?.rows) yield table.rows as Rows;
  for (const tables of Object.values(snapshot.held ?? {})) for (const table of Object.values(tables ?? {})) {
    const rows = (table as { rows?: unknown } | null)?.rows;
    if (Array.isArray(rows)) yield rows as Rows;
  }
}

/** The runtime classes `source`'s file compiles in, from the rows it carries; none for a document that fills no class at runtime. */
export function fileRuntimeClasses(source: string, snapshot: Carried): string[] {
  return hasRuntimeClasses(source) ? offlineRuntimeClasses(source, rowsOf(snapshot)) : [];
}
