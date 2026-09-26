/**
 * A COMPILED DATAFLOW FOR A TEST, made the way publish makes one: the real
 * compiler (lib/story/compile-dataflow) over the Helmet children given, with
 * each imported artifact's shape supplied here instead of loaded. A test that
 * needs a store, a runtime or a server run starts from what the compiler
 * would have stored, never from a hand-built record.
 */
import type { DatasetColumn } from '@artifactbin/contracts';
import { parseJsx } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '@/lib/story/helmet';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/story/compile-dataflow';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';

/** An import's shape: its `rows` columns, or a full source (a folder, a catalog, a connected database). */
export type TestSource = DatasetColumn[] | ImportSource;

const sourceOf = (s: TestSource): ImportSource => (Array.isArray(s) ? { kind: 'dataset', tables: [{ name: 'rows', columns: s }] } : s);

/** Compile a whole markup source (Helmet and body); throws the compiler's own messages. */
export async function compiledSource(source: string, sources: Record<string, TestSource> = {}): Promise<CompiledDataflow> {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`the test document does not parse: ${parsed.error}`);
  const { content, body } = splitHelmet(parsed.nodes);
  const flow = dataflowOf(content);
  const ctx = await prepareCompile(flow, async (ref) => (Object.hasOwn(sources, ref) ? sourceOf(sources[ref]!) : null));
  const result = compileDataflow(flow, { ...ctx, now: '2026-09-30T10:00:00.000Z' }, body);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'));
  return result.compiled;
}

/** Compile `<Helmet>` children alone. */
export const compiledOf = (helmetChildren: string, sources: Record<string, TestSource> = {}): Promise<CompiledDataflow> =>
  compiledSource(`<Helmet>${helmetChildren}</Helmet>`, sources);
