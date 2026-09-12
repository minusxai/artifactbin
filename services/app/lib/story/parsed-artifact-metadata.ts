import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from './helmet';
import { queryDeps, scalarMatches, type Dataflow } from './dataflow';

/** Bump when declaration parsing or dependency semantics change. */
const PARSED_ARTIFACT_COMPILER_REVISION = 'dataflow-2';
const columnType = z.enum(['string', 'number', 'boolean', 'date']);
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).refine(v => !v.startsWith('ref_'));
const span = { start: z.number().int().nonnegative(), end: z.number().int().nonnegative() };
const query = { ...span, name, sql: z.string(), params: z.array(z.string()), refs: z.array(z.string()), source: z.string().optional() };
// Strict nested schemas intentionally admit declarations, never runtime state or ACL.
const flowSchema: z.ZodType<Dataflow> = z.object({
  values: z.array(z.union([
    z.object({ ...span, kind: z.literal('scalar'), name, type: columnType, default: scalar }).strict().refine(v => scalarMatches(v.default, v.type)),
    z.object({ ...span, kind: z.literal('table'), name, rows: z.array(z.record(z.string(), scalar)), columns: z.array(z.object({ name: z.string(), type: columnType }).strict()) }).strict(),
  ])),
  queries: z.array(z.object(query).strict()),
  mutations: z.array(z.object({ ...query, scope: z.literal('local').optional(), target: z.string(), expectedAffected: z.number().int().nonnegative().optional() }).strict()).optional(),
}).strict();

/** Derived only from final stored source. Never contains viewer capabilities. */
interface ParsedArtifactMetadataV1 {
  schemaVersion: 1;
  compilerRevision: string;
  sourceHash: string;
  flow: Dataflow;
  queryDependencies: Record<string, string[]>;
}

const metadataSchema: z.ZodType<ParsedArtifactMetadataV1> = z.object({
  schemaVersion: z.literal(1), compilerRevision: z.literal(PARSED_ARTIFACT_COMPILER_REVISION),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), flow: flowSchema,
  queryDependencies: z.record(z.string(), z.array(z.string())),
}).strict();
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const dependencies = (flow: Dataflow) => {
  const tables = [...flow.values.filter(v => v.kind === 'table').map(v => v.name), ...flow.queries.map(q => q.name)];
  return Object.fromEntries(flow.queries.map(q => [q.name, q.source ? [] : queryDeps(q.sql, tables)]));
};

/** Pure final-source compilation; no queries, imports, or permissions. */
export function compileParsedArtifactMetadata(source: string): ParsedArtifactMetadataV1 {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('Cannot compile metadata for invalid markup');
  const { content } = splitHelmet(parsed.nodes);
  // The parser accepts extra authored column properties; persist only the
  // actual DatasetColumn contract so valid metadata never reparses forever.
  const values=content.values.map(value=>value.kind==='table'?{...value,columns:value.columns.map(({name,type})=>({name,type}))}:value);
  const flow: Dataflow = { values, queries: content.queries, ...(content.mutations.length ? { mutations: content.mutations } : {}) };
  return { schemaVersion: 1, compilerRevision: PARSED_ARTIFACT_COMPILER_REVISION, sourceHash: hash(source), flow, queryDependencies: dependencies(flow) };
}

/** Runtime-validates persisted metadata, falling back to canonical source. */
export function readParsedArtifactMetadata(meta: unknown, source: string): ParsedArtifactMetadataV1 {
  const raw = meta && typeof meta === 'object' && Object.hasOwn(meta, 'parsedArtifact') ? (meta as { parsedArtifact: unknown }).parsedArtifact : null;
  const parsed = metadataSchema.safeParse(raw);
  if (parsed.success && parsed.data.sourceHash === hash(source)) {
    const { flow, queryDependencies } = parsed.data;
    const declarations = [...flow.values, ...flow.queries, ...(flow.mutations ?? [])];
    const spansValid = declarations.every(d => d.start <= d.end && d.end <= source.length);
    const namesUnique = new Set(declarations.map(d => d.name)).size === declarations.length;
    const edges = dependencies(flow);
    const edgesValid = Object.keys(queryDependencies).length === Object.keys(edges).length && Object.entries(edges).every(([key, refs]) => Object.hasOwn(queryDependencies, key) && JSON.stringify(queryDependencies[key]) === JSON.stringify(refs));
    if (spansValid && namesUnique && edgesValid) return parsed.data;
  }
  return compileParsedArtifactMetadata(source);
}

/** Called only at commit boundaries, after every source normalizer/stamper. */
export function finalizeArtifactMetadata(format: string, source: string | null, meta: Record<string, unknown>): Record<string, unknown> {
  if (format !== 'markup' || source === null) return meta;
  return { ...meta, parsedArtifact: compileParsedArtifactMetadata(source) };
}
