import { createHash } from 'node:crypto';
import { z } from 'zod';
import { declarationsOf } from './helmet';
import { isEmptyDataflow, scalarMatches } from './dataflow';
import { EMPTY_COMPILED_DATAFLOW, type CompiledDataflow } from './compiled-dataflow';
import { compileWithLoader, type SchemaLoader } from './compile-dataflow';

/**
 * A MARKUP DOCUMENT'S COMPILED DATAFLOW, stored in `meta.parsedArtifact` beside
 * the source it was compiled from. Compiling needs the imported artifacts in
 * hand (lib/story/compile-dataflow), so it happens at the publish door, before
 * any transaction opens; the commit only re-binds the record to the FINAL
 * source (node ids are stamped after the door) and stores it. A reader whose
 * record is missing or stale recompiles with the document owner's loader.
 *
 * Bump the revision when compiled semantics change: every stored record then
 * reads as stale and recompiles.
 */
const PARSED_ARTIFACT_COMPILER_REVISION = 'sqlite-compiled-1';

/**
 * The door's compiled record rides on the prepared meta under this SYMBOL:
 * JSON cannot carry it, so no request body can hand the commit a record the
 * compiler did not produce. `finalizeArtifactMetadata` consumes it.
 */
export const COMPILED_DATAFLOW = Symbol('compiled dataflow');

const columnType = z.enum(['string', 'number', 'boolean', 'date', 'timestamp', 'user']);
const constraints = z.object({ memberOf: z.array(z.string()).optional(), self: z.boolean().optional() }).strict();
const column = z.object({ name: z.string(), type: columnType, constraints: constraints.optional() }).strict();
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const span = { start: z.number().int().nonnegative(), end: z.number().int().nonnegative() };
const reads = z.object({ imports: z.array(z.string()), queries: z.array(z.string()), values: z.array(z.string()), builtins: z.array(z.string()) }).strict();
// Strict nested schemas: a record holds compiled declarations, never runtime state or ACL.
const compiledSchema = z.object({
  imports: z.array(z.object({ name, ref: z.string(), tables: z.array(z.object({ name: z.string(), columns: z.array(column) }).strict()) }).strict()),
  values: z.array(z.object({
    name, kind: z.enum(['scalar', 'table']), type: z.union([columnType, z.literal('table')]), default: scalar,
    rows: z.array(z.record(z.string(), scalar)).optional(), columns: z.array(column).optional(), url: z.literal(false).optional(),
    source: z.string().optional(), column: z.string().optional(), constraints: constraints.optional(),
  }).strict().refine((v) => v.kind === 'table' || (v.type !== 'table' && scalarMatches(v.default, v.type)))),
  queries: z.array(z.object({
    ...span, name, engine: z.enum(['sqlite', 'postgres']), source: z.string().optional(), sql: z.string(), params: z.array(z.string()), reads,
    columns: z.array(z.object({ name: z.string(), type: columnType.nullable() }).strict()),
  }).strict()),
  mutations: z.array(z.object({
    ...span, name, sql: z.string(),
    target: z.union([z.object({ import: z.string(), table: z.string() }).strict(), z.object({ local: z.string() }).strict()]),
    args: z.array(z.object({ name: z.string(), type: columnType.nullable() }).strict()), reads,
    expectedAffected: z.number().int().nonnegative().optional(), reset: z.array(z.string()).optional(),
  }).strict()),
}).strict() as unknown as z.ZodType<CompiledDataflow>;

interface ParsedArtifactMetadataV2 {
  schemaVersion: 2;
  compilerRevision: string;
  sourceHash: string;
  compiled: CompiledDataflow;
}

const metadataSchema: z.ZodType<ParsedArtifactMetadataV2> = z.object({
  schemaVersion: z.literal(2), compilerRevision: z.literal(PARSED_ARTIFACT_COMPILER_REVISION),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), compiled: compiledSchema,
}).strict();
const hash = (source: string) => createHash('sha256').update(source).digest('hex');

/**
 * The same compiled record, its spans moved onto `source`'s own declarations —
 * or null when `source` does not declare exactly what was compiled (then the
 * record is not this document's, and it is recompiled instead).
 */
function rebind(compiled: CompiledDataflow, source: string): CompiledDataflow | null {
  const flow = declarationsOf(source);
  if (!flow) return null;
  const spans = new Map<string, { start: number; end: number; sql: string }>([...flow.queries, ...flow.mutations].map((d) => [d.name, d]));
  const same = flow.imports.length === compiled.imports.length && flow.imports.every((i, n) => compiled.imports[n]?.name === i.name && compiled.imports[n]?.ref === i.ref)
    && flow.values.length === compiled.values.length && flow.queries.length === compiled.queries.length && flow.mutations.length === compiled.mutations.length
    && [...compiled.queries, ...compiled.mutations].every((d) => spans.has(d.name));
  if (!same) return null;
  const at = <T extends { name: string; start: number; end: number }>(d: T): T => ({ ...d, start: spans.get(d.name)!.start, end: spans.get(d.name)!.end });
  return { ...compiled, queries: compiled.queries.map(at), mutations: compiled.mutations.map(at) };
}

/** The stored record, when it is current for this source; null otherwise. */
export function storedCompiledDataflow(meta: unknown, source: string): CompiledDataflow | null {
  const raw = meta && typeof meta === 'object' && Object.hasOwn(meta, 'parsedArtifact') ? (meta as { parsedArtifact: unknown }).parsedArtifact : null;
  const parsed = metadataSchema.safeParse(raw);
  if (!parsed.success || parsed.data.sourceHash !== hash(source)) return null;
  const { compiled } = parsed.data;
  const declarations = [...compiled.queries, ...compiled.mutations];
  const names = [...compiled.imports, ...compiled.values, ...declarations].map((d) => d.name);
  if (!declarations.every((d) => d.start <= d.end && d.end <= source.length) || new Set(names).size !== names.length) return null;
  return compiled;
}

/**
 * A document's compiled dataflow: the stored record, or — missing, stale, or
 * from an older compiler — a fresh compile with `load` (the document owner's
 * reach). Null when the source does not compile (publish refused it, or what
 * it imports has changed shape since); EMPTY when it declares nothing.
 */
export async function readCompiledDataflow(meta: unknown, source: string, load: SchemaLoader): Promise<CompiledDataflow | null> {
  const stored = storedCompiledDataflow(meta, source);
  if (stored) return stored;
  const flow = declarationsOf(source);
  if (!flow) return null;
  if (isEmptyDataflow(flow)) return EMPTY_COMPILED_DATAFLOW;
  const result = await compileWithLoader(flow, load);
  return result.ok ? result.compiled : null;
}

/**
 * Called only at commit boundaries, after every source normalizer/stamper:
 * binds the door's compiled record (COMPILED_DATAFLOW) to the final source,
 * or drops a record that is not this source's so the next read recompiles.
 */
export function finalizeArtifactMetadata(format: string, source: string | null, meta: Record<string, unknown>): Record<string, unknown> {
  const { [COMPILED_DATAFLOW]: pending, ...rest } = meta as Record<string | symbol, unknown>;
  const { parsedArtifact: _, ...clean } = rest as Record<string, unknown>;
  if (format !== 'markup' || source === null) return clean;
  const compiled = pending ? rebind(pending as CompiledDataflow, source) : storedCompiledDataflow(meta, source);
  if (!compiled) return clean;
  const record: ParsedArtifactMetadataV2 = { schemaVersion: 2, compilerRevision: PARSED_ARTIFACT_COMPILER_REVISION, sourceHash: hash(source), compiled };
  return { ...clean, parsedArtifact: record };
}
